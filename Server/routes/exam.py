from datetime import datetime, timezone, timedelta
import json
import os
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError
from starlette.status import HTTP_201_CREATED, HTTP_403_FORBIDDEN, HTTP_404_NOT_FOUND, HTTP_400_BAD_REQUEST

from deps import get_current_user
from memory_cache import delete_cache, get_cache, set_cache
from models import Exam, RetakeRequest
from supa import db

router = APIRouter()

EXAM_CACHE_TTL_SECONDS = 120
PAPER_CACHE_TTL_SECONDS = 600
EXAM_AVAILABLE_CACHE_TTL_SECONDS = 20
_exam_available_cache_version = 1


@lru_cache(maxsize=1)
def _resolve_section_mapping_path() -> Path | None:
    env_path = (os.getenv("SECTION_MAPPING_PATH") or "").strip()
    candidates = []
    if env_path:
        candidates.append(Path(env_path))

    candidates.extend([
        Path("/etc/secrets/section_mapping.json"),
        Path(__file__).resolve().parents[1] / "datasets" / "section_mapping.json",
    ])

    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


@lru_cache(maxsize=1)
def _load_section_mapping() -> dict:
    mapping_path = _resolve_section_mapping_path()
    if mapping_path is None:
        return {}
    try:
        with mapping_path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _token_to_rank(token: str) -> int | None:
    raw = (token or "").strip().upper()
    if len(raw) != 2:
        return None
    try:
        return int(raw, 36)
    except ValueError:
        return None


def _derive_student_section_from_roll(roll: str) -> str | None:
    raw_roll = (roll or "").strip().upper()
    if len(raw_roll) < 4:
        return None

    suffix = raw_roll[-4:]
    branch_code = suffix[:2]
    serial = suffix[2:]
    serial_rank = _token_to_rank(serial)
    if serial_rank is None:
        return None

    mapping = _load_section_mapping()
    section_ranges = mapping.get("section_ranges", {}) if isinstance(mapping, dict) else {}
    branch_ranges = section_ranges.get(branch_code, {}) if isinstance(section_ranges, dict) else {}
    if not isinstance(branch_ranges, dict):
        return None

    for section_name, bounds in branch_ranges.items():
        if not isinstance(bounds, list) or len(bounds) != 2:
            continue
        start_rank = _token_to_rank(str(bounds[0]))
        end_rank = _token_to_rank(str(bounds[1]))
        if start_rank is None or end_rank is None:
            continue
        if start_rank <= serial_rank <= end_rank:
            return str(section_name).strip().upper()

    return None


def _list_sections() -> list[str]:
    mapping = _load_section_mapping()
    section_ranges = mapping.get("section_ranges", {}) if isinstance(mapping, dict) else {}
    if not isinstance(section_ranges, dict):
        return []

    result: list[str] = []
    seen: set[str] = set()
    for branch_code in section_ranges:
        branch_data = section_ranges.get(branch_code, {})
        if not isinstance(branch_data, dict):
            continue
        for section_name in branch_data:
            normalized = str(section_name).strip().upper()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            result.append(normalized)
    return result


def _normalize_allowed_sections(items: list[str] | None) -> list[str]:
    if not items:
        return []
    normalized: list[str] = []
    seen: set[str] = set()
    for item in items:
        token = str(item).strip().upper()
        if not token or token in seen:
            continue
        seen.add(token)
        normalized.append(token)
    return normalized


def _is_section_allowed(allowed_sections: list[str] | None, student_section: str | None) -> bool:
    scoped = _normalize_allowed_sections(allowed_sections)
    if not scoped:
        return True
    if not student_section:
        return False
    return student_section.strip().upper() in set(scoped)


def _is_missing_column_error(err: Exception, column_name: str) -> bool:
    if not isinstance(err, APIError):
        return False
    payload = getattr(err, "args", [{}])[0]
    if not isinstance(payload, dict):
        return False
    msg = str(payload.get("message", ""))
    code = str(payload.get("code", ""))
    return code == "42703" and column_name in msg


def compute_score(response: dict, answers: dict, questions_data: dict) -> int:
    scope_ids_raw = response.get("grading_scope_question_ids")
    scope_ids: set[int] | None = None
    if isinstance(scope_ids_raw, list):
        parsed_scope = {qid for qid in scope_ids_raw if isinstance(qid, int)}
        scope_ids = parsed_scope if parsed_scope else set()

    # Build a flat question map: question_id → { marks, negative_marks }
    q_map: dict = {}
    for section in questions_data.get("sections", []):
        for q in section.get("questions", []):
            q_map[str(q["question_id"])] = q

    total = 0
    for r in response.get("responses", []):
        qid_raw = r.get("question_id")
        if not isinstance(qid_raw, int):
            continue
        if scope_ids is not None and qid_raw not in scope_ids:
            continue
        qid = str(qid_raw)
        chosen = r.get("option")
        if chosen is None or qid not in answers:
            continue
        correct = answers[str(qid)] if str(qid) in answers else answers.get(int(qid))
        q = q_map.get(qid, {})
        marks = int(q.get("marks", 1) or 0)
        negative_marks = int(q.get("negative_marks", 0) or 0)
        if marks == 0 and negative_marks == 0:
            continue
        if chosen == correct:
            total += marks
        else:
            total -= negative_marks

    return max(0, total)


def _countable_question_ids(questions: dict) -> set[int]:
    ids: set[int] = set()
    for section in questions.get("sections", []):
        for q in section.get("questions", []):
            qid = q.get("question_id")
            if not isinstance(qid, int):
                continue
            marks = int(q.get("marks", 1) or 0)
            negative_marks = int(q.get("negative_marks", 0) or 0)
            if marks == 0 and negative_marks == 0:
                continue
            ids.add(qid)
    return ids


def _build_live_buckets(rows: list[dict], total_questions: int, countable_qids: set[int] | None = None) -> tuple[list[dict], list[dict], list[dict]]:
    now = datetime.now(timezone.utc)
    active_threshold = timedelta(seconds=60)

    active: list[dict] = []
    idle: list[dict] = []
    submitted: list[dict] = []

    for r in rows:
        status = r.get("status")
        user_obj = r.get("Users") or {}

        if status == "submitted":
            submitted.append(
                {
                    "student_name": user_obj.get("name", ""),
                    "student_roll": user_obj.get("roll", ""),
                    "submitted_at": r.get("submitted_at"),
                    "user_id":      r.get("user_id"),
                }
            )
            continue

        last_seen_raw = r.get("last_seen_at")
        if not isinstance(last_seen_raw, str):
            continue

        answered = 0
        for q in (r.get("response") or {}).get("responses", []):
            if q.get("option") is None:
                continue
            if countable_qids is not None:
                qid = q.get("question_id")
                if not isinstance(qid, int) or qid not in countable_qids:
                    continue
            answered += 1
        entry = {
            "student_name": user_obj.get("name", ""),
            "student_roll": user_obj.get("roll", ""),
            "last_seen_at": last_seen_raw,
            "answered": answered,
            "total": total_questions,
        }

        last_seen = datetime.fromisoformat(last_seen_raw.replace("Z", "+00:00"))
        if now - last_seen <= active_threshold:
            active.append(entry)
        else:
            idle.append(entry)

    submitted.sort(key=lambda x: x.get("submitted_at") or "")
    return active, idle, submitted


def _count_questions(questions: dict) -> int:
    return len(_countable_question_ids(questions))


async def _get_release_state_by_exam_ids(exam_ids: list[int]) -> dict[int, dict]:
    if not exam_ids:
        return {}

    logs_res = await db.client.table("ExamLogs") \
        .select("exam_id,event") \
        .in_("exam_id", exam_ids) \
        .in_("event", ["responses_auto_release_enabled", "responses_released"]) \
        .execute()

    state = {
        exam_id: {
            "auto_release": False,
            "released_manually": False,
        }
        for exam_id in exam_ids
    }

    for row in logs_res.data or []:
        exam_id = row.get("exam_id")
        event = row.get("event")
        if not isinstance(exam_id, int) or exam_id not in state:
            continue
        if event == "responses_auto_release_enabled":
            state[exam_id]["auto_release"] = True
        elif event == "responses_released":
            state[exam_id]["released_manually"] = True

    return state


def _is_exam_response_released(exam: dict, release_state: dict) -> bool:
    if release_state.get("released_manually"):
        return True

    if not release_state.get("auto_release"):
        return False

    end_raw = exam.get("end")
    if not isinstance(end_raw, str):
        return False
    try:
        end_dt = datetime.fromisoformat(end_raw.replace("Z", "+00:00"))
    except Exception:
        return False
    return datetime.now(timezone.utc) >= end_dt


async def _get_exam_core(exam_id: int) -> dict | None:
    key = f"exam:core:{exam_id}"
    cached = await get_cache(key)
    if cached is not None:
        return cached

    try:
        exam_res = await db.client.table("Exams") \
            .select("id,name,total_marks,start,end,creator_id,questionpaper_id,join_window,max_warnings,allowed_sections") \
            .eq("id", exam_id) \
            .execute()
    except APIError as err:
        if _is_missing_column_error(err, "allowed_sections"):
            try:
                exam_res = await db.client.table("Exams") \
                    .select("id,name,total_marks,start,end,creator_id,questionpaper_id,join_window,max_warnings") \
                    .eq("id", exam_id) \
                    .execute()
            except APIError as err2:
                if _is_missing_column_error(err2, "max_warnings"):
                    exam_res = await db.client.table("Exams") \
                        .select("id,name,total_marks,start,end,creator_id,questionpaper_id,join_window") \
                        .eq("id", exam_id) \
                        .execute()
                else:
                    raise
        elif _is_missing_column_error(err, "max_warnings"):
            exam_res = await db.client.table("Exams") \
                .select("id,name,total_marks,start,end,creator_id,questionpaper_id,join_window,allowed_sections") \
                .eq("id", exam_id) \
                .execute()
        else:
            raise

    exam = exam_res.data[0] if exam_res.data else None
    if exam is not None:
        exam["allowed_sections"] = _normalize_allowed_sections(exam.get("allowed_sections"))
        await set_cache(key, exam, EXAM_CACHE_TTL_SECONDS)
    return exam


async def _get_paper_questions(paper_id: int) -> dict | None:
    key = f"paper:questions:{paper_id}"
    cached = await get_cache(key)
    if cached is not None:
        return cached

    paper_res = await db.client.table("QuestionPapers") \
        .select("questions") \
        .eq("id", paper_id) \
        .execute()
    paper = paper_res.data[0] if paper_res.data else None
    if paper is not None:
        await set_cache(key, paper, PAPER_CACHE_TTL_SECONDS)
    return paper


async def _get_paper_full(paper_id: int) -> dict | None:
    key = f"paper:full:{paper_id}"
    cached = await get_cache(key)
    if cached is not None:
        return cached

    paper_res = await db.client.table("QuestionPapers") \
        .select("questions,answers") \
        .eq("id", paper_id) \
        .execute()
    paper = paper_res.data[0] if paper_res.data else None
    if paper is not None:
        await set_cache(key, paper, PAPER_CACHE_TTL_SECONDS)
    return paper


async def _invalidate_exam_cache(exam_id: int) -> None:
    global _exam_available_cache_version
    await delete_cache(f"exam:core:{exam_id}")
    _exam_available_cache_version += 1


@router.post("/exam/create", status_code=HTTP_201_CREATED)
async def createExam(exam: Exam, user=Depends(get_current_user)):
    data = exam.model_dump(exclude={"id", "created_at"})
    release_after_exam = bool(data.pop("release_after_exam", False))
    data["allowed_sections"] = _normalize_allowed_sections(data.get("allowed_sections"))
    data["creator_id"] = user["id"]
    data["start"] = data["start"].isoformat()
    data["end"] = data["end"].isoformat()
    try:
        response = await db.client.table("Exams").insert(data).execute()
    except APIError as err:
        if _is_missing_column_error(err, "allowed_sections"):
            legacy_data = {k: v for k, v in data.items() if k != "allowed_sections"}
            try:
                response = await db.client.table("Exams").insert(legacy_data).execute()
            except APIError as err2:
                if _is_missing_column_error(err2, "max_warnings"):
                    legacy_data = {k: v for k, v in legacy_data.items() if k != "max_warnings"}
                    response = await db.client.table("Exams").insert(legacy_data).execute()
                else:
                    raise
        elif _is_missing_column_error(err, "max_warnings"):
            legacy_data = {k: v for k, v in data.items() if k != "max_warnings"}
            response = await db.client.table("Exams").insert(legacy_data).execute()
        else:
            raise
    exam_id = response.data[0]["id"]
    if release_after_exam:
        await db.client.table("ExamLogs").insert({
            "exam_id": exam_id,
            "user_id": user["id"],
            "event": "responses_auto_release_enabled",
        }).execute()

    await _invalidate_exam_cache(exam_id)
    return {"msg": "Exam created", "id": exam_id}


@router.delete("/exam/{exam_id}")
async def deleteExam(exam_id: int, user=Depends(get_current_user)):
    exam = await _get_exam_core(exam_id)
    if not exam or exam.get("creator_id") != user["id"]:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Exam not found.")

    now = datetime.now(timezone.utc)
    start = datetime.fromisoformat(exam["start"].replace("Z", "+00:00"))
    end   = datetime.fromisoformat(exam["end"].replace("Z", "+00:00"))
    if start <= now <= end:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="Cannot delete a live exam. Stop it first.")

    await db.client.table("Exams").delete().eq("id", exam_id).execute()
    await _invalidate_exam_cache(exam_id)
    return {"msg": "Exam deleted."}


@router.get("/exam/sections")
async def listExamSections(user=Depends(get_current_user)):
    if user.get("role") not in {"Faculty", "HOD", "Admin"}:
        raise HTTPException(status_code=HTTP_403_FORBIDDEN, detail="Only faculty can access section presets.")
    return {"sections": _list_sections()}


@router.get("/exam/available")
async def availableExams(user=Depends(get_current_user)):
    """All exams visible to students — no creator filter."""
    should_filter_by_section = user.get("role") == "Student"
    student_section = _derive_student_section_from_roll(str(user.get("roll", ""))) if should_filter_by_section else None
    role = str(user.get("role", ""))
    section_key = student_section or "-"
    cache_key = f"exam:available:v{_exam_available_cache_version}:role:{role}:section:{section_key}"

    cached = await get_cache(cache_key)
    if cached is not None:
        return {"exams": cached}

    try:
        response = await db.client.table("Exams") \
            .select("id,name,total_marks,start,end,allowed_sections,Users!creator_id(name)") \
            .order("start") \
            .execute()
    except APIError as err:
        if _is_missing_column_error(err, "allowed_sections"):
            response = await db.client.table("Exams") \
                .select("id,name,total_marks,start,end,Users!creator_id(name)") \
                .order("start") \
                .execute()
        else:
            raise

    exams = []
    for e in response.data:
        allowed_sections = _normalize_allowed_sections(e.get("allowed_sections"))
        if should_filter_by_section and not _is_section_allowed(allowed_sections, student_section):
            continue
        faculty = e.pop("Users", None)
        e["allowed_sections"] = allowed_sections
        e["faculty_name"] = faculty["name"] if faculty else ""
        exams.append(e)

    await set_cache(cache_key, exams, EXAM_AVAILABLE_CACHE_TTL_SECONDS)
    return {"exams": exams}


@router.get("/exam/{exam_id}/take")
async def takeExam(exam_id: int, user=Depends(get_current_user)):
    """Return full exam + paper data for a student to take."""
    if user.get("role") != "Student":
        raise HTTPException(status_code=HTTP_403_FORBIDDEN, detail="Only students can take exams.")

    exam = await _get_exam_core(exam_id)
    if not exam:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Exam not found.")

    student_section = _derive_student_section_from_roll(str(user.get("roll", "")))
    if not _is_section_allowed(exam.get("allowed_sections"), student_section):
        raise HTTPException(
            status_code=HTTP_403_FORBIDDEN,
            detail="This exam is not available for your section.",
        )

    # Join-window check: reject late joiners
    join_window = exam.get("join_window")
    if join_window is not None:
        now = datetime.now(timezone.utc)
        start = datetime.fromisoformat(exam["start"].replace("Z", "+00:00"))
        cutoff = start + timedelta(minutes=join_window)
        if now > cutoff:
            raise HTTPException(
                status_code=HTTP_403_FORBIDDEN,
                detail=f"Join window closed. Students could only join within {join_window} minute(s) of the exam starting.",
            )

    submitted = await db.client.table("Responses") \
        .select("id") \
        .eq("exam_id", exam_id) \
        .eq("user_id", user["id"]) \
        .eq("status", "submitted") \
        .execute()
    if submitted.data:
        raise HTTPException(status_code=HTTP_403_FORBIDDEN, detail="You have already submitted this exam.")

    paper = await _get_paper_questions(exam["questionpaper_id"])
    if not paper:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Paper not found.")

    return {
        "meta": {
            "exam_id": exam_id,
            "exam_name": exam["name"],
            "start_time": exam["start"],
            "end_time": exam["end"],
            "total_marks": exam["total_marks"],
            "max_warnings": exam.get("max_warnings") or 3,
        },
        "sections": paper["questions"].get("sections", []),
    }


@router.get("/exam/list")
async def listExams(user=Depends(get_current_user)):
    query = db.client.table("Exams") \
        .select("id,name,total_marks,start,end,created_at,creator_id") \
        .order("created_at", desc=True)
    if user.get("role") != "HOD":
        query = query.eq("creator_id", user["id"])
    response = await query.execute()
    exams = response.data or []

    exam_ids = [e.get("id") for e in exams if isinstance(e.get("id"), int)]
    release_state_map = await _get_release_state_by_exam_ids(exam_ids)

    for exam in exams:
        exam_id = exam.get("id")
        release_state = release_state_map.get(exam_id, {"auto_release": False, "released_manually": False})
        exam["can_manage"] = exam.get("creator_id") == user["id"]
        exam["release_after_exam"] = bool(release_state.get("auto_release"))
        exam["responses_released"] = _is_exam_response_released(exam, release_state)
    return {"exams": exams}


@router.post("/exam/{exam_id}/release-responses")
async def releaseExamResponses(exam_id: int, user=Depends(get_current_user)):
    exam = await _get_exam_core(exam_id)
    if not exam or exam.get("creator_id") != user["id"]:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Exam not found.")

    try:
        end_dt = datetime.fromisoformat(str(exam.get("end", "")).replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="Exam end time is invalid.")

    if datetime.now(timezone.utc) < end_dt:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="You can release responses only after the exam ends.")

    existing_release = await db.client.table("ExamLogs") \
        .select("id") \
        .eq("exam_id", exam_id) \
        .eq("event", "responses_released") \
        .limit(1) \
        .execute()

    if existing_release.data:
        return {"msg": "Responses already released."}

    await db.client.table("ExamLogs").insert({
        "exam_id": exam_id,
        "user_id": user["id"],
        "event": "responses_released",
    }).execute()

    return {"msg": "Responses released."}


@router.get("/exam/faculty-dashboard")
async def facultyDashboard(user=Depends(get_current_user)):
    if user.get("role") not in {"Faculty", "HOD", "Admin"}:
        raise HTTPException(status_code=HTTP_403_FORBIDDEN, detail="Only faculty can access dashboard analytics.")

    owner_id = user["id"]

    exams_res = await db.client.table("Exams") \
        .select("id,name,total_marks,start,end,created_at,questionpaper_id") \
        .eq("creator_id", owner_id) \
        .order("created_at", desc=True) \
        .execute()
    exams = exams_res.data or []

    exam_ids = [e["id"] for e in exams if isinstance(e.get("id"), int)]
    responses_count = 0
    if exam_ids:
        resp_res = await db.client.table("Responses") \
            .select("id") \
            .in_("exam_id", exam_ids) \
            .eq("status", "submitted") \
            .execute()
        responses_count = len(resp_res.data or [])

    papers_res = await db.client.table("QuestionPapers") \
        .select("id,questions,created_at") \
        .eq("creator_id", owner_id) \
        .order("created_at", desc=True) \
        .execute()
    papers = papers_res.data or []

    paper_name_by_id: dict[int, str] = {}
    recent_papers = []
    for paper in papers:
        pid = paper.get("id")
        questions = paper.get("questions") or {}
        meta = questions.get("meta", {}) if isinstance(questions, dict) else {}
        name = meta.get("exam_name") or f"Paper #{pid}"
        total_marks = meta.get("total_marks") or sum(
            q.get("marks", 0)
            for s in questions.get("sections", [])
            for q in s.get("questions", [])
        )

        if isinstance(pid, int):
            paper_name_by_id[pid] = str(name)

        recent_papers.append({
            "id": pid,
            "name": name,
            "total_marks": total_marks,
            "created_at": paper.get("created_at"),
        })

    flagged_count = 0
    query_rows = []
    try:
        flags_res = await db.client.table("FlaggedQuestions") \
            .select("id,payload,created_at") \
            .eq("faculty_id", owner_id) \
            .execute()
        query_rows = flags_res.data or []
        flagged_count = len(query_rows)
    except Exception:
        try:
            flags_res = await db.client.table("flagged_questions") \
                .select("id,payload,created_at") \
                .eq("faculty_id", owner_id) \
                .execute()
            query_rows = flags_res.data or []
            flagged_count = len(query_rows)
        except Exception:
            flagged_count = 0
            query_rows = []

    recent_queries = []
    pending_queries = 0
    for row in query_rows:
        payload = row.get("payload") or {}
        if not isinstance(payload, dict):
            payload = {}
        answered = bool(str(payload.get("faculty_response") or "").strip())
        if not answered:
            pending_queries += 1
        recent_queries.append({
            "id": row.get("id"),
            "exam_name": payload.get("exam_name") or "",
            "question_id": payload.get("question_id"),
            "status": "answered" if answered else "pending",
            "created_at": row.get("created_at"),
        })

    recent_exams = []
    for exam in exams[:6]:
        recent_exams.append({
            "id": exam.get("id"),
            "name": exam.get("name"),
            "total_marks": exam.get("total_marks"),
            "start": exam.get("start"),
            "end": exam.get("end"),
            "created_at": exam.get("created_at"),
            "questionpaper_id": exam.get("questionpaper_id"),
            "paper_name": paper_name_by_id.get(exam.get("questionpaper_id"), ""),
        })

    return {
        "faculty_name": user.get("name") or "Faculty",
        "stats": {
            "question_papers_created": len(papers),
            "exams_created": len(exams),
            "student_submissions": responses_count,
            "flagged_questions": flagged_count,
            "pending_queries": pending_queries,
        },
        "recent_exams": recent_exams,
        "recent_papers": recent_papers[:6],
        "recent_queries": recent_queries[:6],
    }


@router.get("/exam/hod-dashboard")
async def hodDashboard(user=Depends(get_current_user)):
    if user.get("role") != "HOD":
        raise HTTPException(status_code=HTTP_403_FORBIDDEN, detail="Only HOD can access dashboard analytics.")

    pending_res = await db.client.table("Users") \
        .select("id") \
        .eq("role", "Faculty") \
        .eq("approval_status", "pending") \
        .execute()
    approved_res = await db.client.table("Users") \
        .select("id") \
        .eq("role", "Faculty") \
        .eq("approval_status", "approved") \
        .execute()

    exams_res = await db.client.table("Exams") \
        .select("id,name,total_marks,start,end,created_at,creator_id,questionpaper_id") \
        .order("created_at", desc=True) \
        .execute()
    exams = exams_res.data or []

    papers_res = await db.client.table("QuestionPapers") \
        .select("id,questions,created_at") \
        .order("created_at", desc=True) \
        .execute()
    papers = papers_res.data or []

    paper_name_by_id: dict[int, str] = {}
    recent_papers = []
    for paper in papers:
        pid = paper.get("id")
        questions = paper.get("questions") or {}
        meta = questions.get("meta", {}) if isinstance(questions, dict) else {}
        name = meta.get("exam_name") or f"Paper #{pid}"
        total_marks = meta.get("total_marks") or sum(
            q.get("marks", 0)
            for s in questions.get("sections", [])
            for q in s.get("questions", [])
        )

        if isinstance(pid, int):
            paper_name_by_id[pid] = str(name)

        recent_papers.append({
            "id": pid,
            "name": name,
            "total_marks": total_marks,
            "created_at": paper.get("created_at"),
        })

    responses_res = await db.client.table("Responses") \
        .select("id") \
        .eq("status", "submitted") \
        .execute()
    responses_count = len(responses_res.data or [])

    flagged_count = 0
    try:
        flags_res = await db.client.table("FlaggedQuestions") \
            .select("id") \
            .execute()
        flagged_count = len(flags_res.data or [])
    except Exception:
        try:
            flags_res = await db.client.table("flagged_questions") \
                .select("id") \
                .execute()
            flagged_count = len(flags_res.data or [])
        except Exception:
            flagged_count = 0

    now = datetime.now(timezone.utc)
    live_exams = 0
    for exam in exams:
        end_raw = exam.get("end")
        if isinstance(end_raw, str):
            try:
                end_dt = datetime.fromisoformat(end_raw.replace("Z", "+00:00"))
                if end_dt >= now:
                    start_raw = exam.get("start")
                    if isinstance(start_raw, str):
                        start_dt = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
                        if start_dt <= now:
                            live_exams += 1
            except Exception:
                continue

    recent_exams = []
    for exam in exams[:6]:
        recent_exams.append({
            "id": exam.get("id"),
            "name": exam.get("name"),
            "total_marks": exam.get("total_marks"),
            "start": exam.get("start"),
            "end": exam.get("end"),
            "created_at": exam.get("created_at"),
            "questionpaper_id": exam.get("questionpaper_id"),
            "paper_name": paper_name_by_id.get(exam.get("questionpaper_id"), ""),
            "can_manage": exam.get("creator_id") == user["id"],
        })

    return {
        "hod_name": user.get("name") or "HOD",
        "stats": {
            "pending_faculty": len(pending_res.data or []),
            "approved_faculty": len(approved_res.data or []),
            "question_papers": len(papers),
            "exams": len(exams),
            "live_exams": live_exams,
            "student_submissions": responses_count,
            "flagged_questions": flagged_count,
        },
        "recent_exams": recent_exams,
        "recent_papers": recent_papers[:6],
    }


@router.get("/exam/{exam_id}/responses")
async def getExamResponses(exam_id: int, user=Depends(get_current_user)):
    # 1. Verify exam ownership
    exam = await _get_exam_core(exam_id)
    if not exam or (user.get("role") != "HOD" and exam.get("creator_id") != user["id"]):
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Exam not found.")

    # 2. Fetch question paper for scoring
    paper = await _get_paper_full(exam["questionpaper_id"])
    if not paper:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Question paper not found.")

    # 3. Fetch submitted responses with student info
    resp_res = await db.client.table("Responses") \
        .select("id,submitted_at,response,Users(name,roll)") \
        .eq("exam_id", exam_id) \
        .eq("status", "submitted") \
        .order("submitted_at") \
        .execute()

    # 4. Compute score per response
    scored = []
    for r in resp_res.data:
        score = compute_score(r["response"], paper["answers"], paper["questions"])
        scored.append({
            "id": r["id"],
            "submitted_at": r["submitted_at"],
            "student_name": r["Users"]["name"],
            "student_roll": r["Users"]["roll"],
            "score": score,
        })

    scores = [s["score"] for s in scored]
    summary = {
        "submitted": len(scored),
        "avg": round(sum(scores) / len(scores), 1) if scores else 0,
        "high": max(scores) if scores else 0,
        "low": min(scores) if scores else 0,
        "total_marks": exam["total_marks"],
    }

    return {"exam": exam, "responses": scored, "summary": summary}


@router.get("/exam/{exam_id}/live")
async def getExamLive(exam_id: int, user=Depends(get_current_user)):
    """Faculty live-tracker: in-progress students split into active / idle."""
    # 1. Verify exam ownership
    exam = await _get_exam_core(exam_id)
    if not exam or (user.get("role") != "HOD" and exam.get("creator_id") != user["id"]):
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Exam not found.")

    paper = await _get_paper_questions(exam["questionpaper_id"])
    countable_qids = _countable_question_ids(paper["questions"]) if paper else set()
    total_questions = len(countable_qids)

    resp_res = await db.client.table("Responses") \
        .select("status,last_seen_at,submitted_at,user_id,response,Users(name,roll)") \
        .eq("exam_id", exam_id) \
        .in_("status", ["in_progress", "submitted"]) \
        .execute()

    active, idle, submitted = _build_live_buckets(resp_res.data, total_questions, countable_qids)

    exam_payload = {
        **exam,
        "can_manage": exam.get("creator_id") == user["id"],
    }

    return JSONResponse(
        content={"exam": exam_payload, "active": active, "idle": idle, "submitted": submitted},
        headers={"Cache-Control": "no-store"},
    )


@router.get("/exam/{exam_id}/logs")
async def getExamLogs(
    exam_id: int,
    since: str | None = Query(default=None, description="Return logs newer than this ISO timestamp."),
    user=Depends(get_current_user),
):
    """Recent event log for a live exam — faculty only."""
    exam = await _get_exam_core(exam_id)
    if not exam or (user.get("role") != "HOD" and exam.get("creator_id") != user["id"]):
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Exam not found.")

    query = db.client.table("ExamLogs") \
        .select("event,created_at,Users(name,roll)") \
        .eq("exam_id", exam_id)
    if since:
        query = query.gt("created_at", since)
        logs = await query.order("created_at", desc=False).limit(200).execute()
    else:
        logs = await query.order("created_at", desc=True).limit(100).execute()
    return JSONResponse(
        content={"logs": logs.data},
        headers={"Cache-Control": "no-store"},
    )


@router.get("/exam/{exam_id}/snapshot")
async def getExamSnapshot(
    exam_id: int,
    since: str | None = Query(default=None, description="Return logs newer than this ISO timestamp."),
    user=Depends(get_current_user),
):
    """Combined faculty snapshot: live state + logs in one request."""
    exam = await _get_exam_core(exam_id)
    if not exam or (user.get("role") != "HOD" and exam.get("creator_id") != user["id"]):
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Exam not found.")

    paper = await _get_paper_questions(exam["questionpaper_id"])
    countable_qids = _countable_question_ids(paper["questions"]) if paper else set()
    total_questions = len(countable_qids)

    resp_res = await db.client.table("Responses") \
        .select("status,last_seen_at,submitted_at,user_id,response,Users(name,roll)") \
        .eq("exam_id", exam_id) \
        .in_("status", ["in_progress", "submitted"]) \
        .execute()

    active, idle, submitted = _build_live_buckets(resp_res.data, total_questions, countable_qids)

    log_query = db.client.table("ExamLogs") \
        .select("event,created_at,Users(name,roll)") \
        .eq("exam_id", exam_id)
    if since:
        log_query = log_query.gt("created_at", since)
        logs_res = await log_query.order("created_at", desc=False).limit(200).execute()
    else:
        logs_res = await log_query.order("created_at", desc=True).limit(100).execute()

    logs = logs_res.data or []
    last_log_at = logs[-1]["created_at"] if logs and since else (logs[0]["created_at"] if logs else None)

    exam_payload = {
        **exam,
        "can_manage": exam.get("creator_id") == user["id"],
    }

    return JSONResponse(
        content={
            "exam": exam_payload,
            "active": active,
            "idle": idle,
            "submitted": submitted,
            "logs": logs,
            "last_log_at": last_log_at,
        },
        headers={"Cache-Control": "no-store"},
    )


@router.post("/exam/{exam_id}/retake")
async def grantRetake(exam_id: int, body: RetakeRequest, user=Depends(get_current_user)):
    """Faculty: revert a submitted response back to in_progress so student can retake."""
    exam = await _get_exam_core(exam_id)
    if not exam or exam.get("creator_id") != user["id"]:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Exam not found.")

    existing = await db.client.table("Responses") \
        .select("id") \
        .eq("exam_id", exam_id) \
        .eq("user_id", body.user_id) \
        .eq("status", "submitted") \
        .limit(1) \
        .execute()

    if not existing.data:
        raise HTTPException(
            status_code=HTTP_404_NOT_FOUND,
            detail="No submitted response found for this student in this exam.",
        )

    await db.client.table("Responses") \
        .update({"status": "in_progress", "submitted_at": None}) \
        .eq("exam_id", exam_id) \
        .eq("user_id", body.user_id) \
        .eq("status", "submitted") \
        .execute()

    await db.client.table("ExamLogs").insert({
        "exam_id": exam_id,
        "user_id": body.user_id,
        "event":   "retake_granted",
    }).execute()
    return {"msg": "Retake granted."}


@router.post("/exam/{exam_id}/stop")
async def stopExam(exam_id: int, user=Depends(get_current_user)):
    """Faculty: end the exam immediately by setting end time to now."""
    exam = await _get_exam_core(exam_id)
    if not exam or exam.get("creator_id") != user["id"]:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Exam not found.")

    now = datetime.now(timezone.utc).isoformat()
    await db.client.table("Exams").update({"end": now}).eq("id", exam_id).execute()
    await _invalidate_exam_cache(exam_id)
    return {"msg": "Exam stopped."}
