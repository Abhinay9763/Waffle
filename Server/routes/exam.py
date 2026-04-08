from datetime import datetime, timezone, timedelta
import json
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
SECTION_MAPPING_PATH = Path(__file__).resolve().parents[1] / "datasets" / "section_mapping.json"
_exam_available_cache_version = 1


@lru_cache(maxsize=1)
def _load_section_mapping() -> dict:
    if not SECTION_MAPPING_PATH.exists():
        return {}
    try:
        with SECTION_MAPPING_PATH.open("r", encoding="utf-8") as f:
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
        if chosen == correct:
            total += q.get("marks", 1)
        else:
            total -= q.get("negative_marks", 0)

    return max(0, total)


def _build_live_buckets(rows: list[dict], total_questions: int) -> tuple[list[dict], list[dict], list[dict]]:
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

        answered = sum(
            1 for q in (r.get("response") or {}).get("responses", [])
            if q.get("option") is not None
        )
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
    total = 0
    for section in questions.get("sections", []):
        total += len(section.get("questions", []))
    return total


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
    await _invalidate_exam_cache(response.data[0]["id"])
    return {"msg": "Exam created", "id": response.data[0]["id"]}


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
    return {"exams": response.data}


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
    total_questions = _count_questions(paper["questions"]) if paper else 0

    resp_res = await db.client.table("Responses") \
        .select("status,last_seen_at,submitted_at,user_id,response,Users(name,roll)") \
        .eq("exam_id", exam_id) \
        .in_("status", ["in_progress", "submitted"]) \
        .execute()

    active, idle, submitted = _build_live_buckets(resp_res.data, total_questions)

    return JSONResponse(
        content={"exam": exam, "active": active, "idle": idle, "submitted": submitted},
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
    total_questions = _count_questions(paper["questions"]) if paper else 0

    resp_res = await db.client.table("Responses") \
        .select("status,last_seen_at,submitted_at,user_id,response,Users(name,roll)") \
        .eq("exam_id", exam_id) \
        .in_("status", ["in_progress", "submitted"]) \
        .execute()

    active, idle, submitted = _build_live_buckets(resp_res.data, total_questions)

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

    return JSONResponse(
        content={
            "exam": exam,
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
