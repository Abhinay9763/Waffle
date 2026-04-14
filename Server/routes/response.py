from datetime import datetime, timezone, timedelta
import asyncio
import os
import logging

from fastapi import APIRouter, Depends, HTTPException
from starlette.status import HTTP_200_OK, HTTP_404_NOT_FOUND

from deps import get_current_user
from models import Heartbeat, Submit, FlagQuestionRequest, AnswerFlaggedQuestionRequest
from supa import db
from temp_invite_cache import get_invite_record, upsert_invite_record

router = APIRouter()
logger = logging.getLogger(__name__)

HEARTBEAT_BATCH_WINDOW_SECONDS = max(1, int(os.getenv("HEARTBEAT_BATCH_WINDOW_SECONDS", "2")))
_pending_heartbeats: dict[tuple[int, int], dict] = {}
_pending_lock = asyncio.Lock()
_batch_stop_event: asyncio.Event | None = None
_batch_task: asyncio.Task | None = None

ALLOWED_POLICY_EVENTS = {
    "normal_mode_selected",
    "focus_lost",
    "tab_hidden",
    "fullscreen_exit",
    "copy_attempt",
    "paste_attempt",
    "screenshot_suspected",
    "warning_issued",
    "lock_started",
    "lock_ended",
    "auto_submitted_policy",
    "blind_mode_enabled",
    "blind_mode_disabled",
}


def _extract_policy_events(payload: list[dict] | None) -> list[str]:
    if not payload:
        return []
    events: list[str] = []
    for item in payload[:30]:
        if not isinstance(item, dict):
            continue
        ev = item.get("event")
        if isinstance(ev, str) and ev in ALLOWED_POLICY_EVENTS:
            events.append(ev)
    return events


def _merge_response_delta(base_response: dict, delta: list[dict] | None) -> dict:
    merged = {
        "student_roll": base_response.get("student_roll", ""),
        "responses": list(base_response.get("responses", [])),
    }
    if not delta:
        return merged

    idx_by_qid: dict[int, int] = {}
    for i, item in enumerate(merged["responses"]):
        qid = item.get("question_id")
        if isinstance(qid, int):
            idx_by_qid[qid] = i

    for d in delta:
        if not isinstance(d, dict):
            continue
        qid = d.get("question_id")
        if not isinstance(qid, int):
            continue
        record = {
            "question_id": qid,
            "option": d.get("option"),
            "marked": bool(d.get("marked", False)),
        }
        if qid in idx_by_qid:
            merged["responses"][idx_by_qid[qid]] = record
        else:
            idx_by_qid[qid] = len(merged["responses"])
            merged["responses"].append(record)

    return merged


def _merge_pending_item(existing: dict | None, incoming: dict) -> dict:
    if existing is None:
        existing = {
            "response": None,
            "response_delta": [],
            "events": [],
            "last_seen_at": datetime.now(timezone.utc).isoformat(),
        }

    if incoming.get("response") is not None:
        existing["response"] = incoming["response"]
        existing["response_delta"] = []
    elif incoming.get("response_delta"):
        existing["response_delta"].extend(incoming["response_delta"])
        existing["response_delta"] = existing["response_delta"][-500:]

    if incoming.get("events"):
        existing["events"].extend(incoming["events"])
        existing["events"] = existing["events"][-100:]

    existing["last_seen_at"] = incoming.get("last_seen_at") or datetime.now(timezone.utc).isoformat()
    return existing


def _merge_queued_heartbeat(existing: dict | None, hb: Heartbeat) -> dict:
    if existing is None:
        existing = {
            "response": None,
            "response_delta": [],
            "events": [],
            "last_seen_at": datetime.now(timezone.utc).isoformat(),
        }

    if hb.response is not None:
        existing["response"] = hb.response
        existing["response_delta"] = []
    elif hb.response_delta:
        existing["response_delta"].extend(hb.response_delta[:200])
        existing["response_delta"] = existing["response_delta"][-500:]

    if hb.events:
        existing["events"].extend(hb.events[:30])
        existing["events"] = existing["events"][-100:]

    existing["last_seen_at"] = datetime.now(timezone.utc).isoformat()
    return existing


async def _drain_pending_snapshot() -> dict[tuple[int, int], dict]:
    async with _pending_lock:
        if not _pending_heartbeats:
            return {}
        snapshot = dict(_pending_heartbeats)
        _pending_heartbeats.clear()
        return snapshot


async def _pop_single_pending(exam_id: int, user_id: int) -> dict | None:
    async with _pending_lock:
        return _pending_heartbeats.pop((exam_id, user_id), None)


async def _requeue_snapshot(snapshot: dict[tuple[int, int], dict]) -> None:
    if not snapshot:
        return
    async with _pending_lock:
        for key, item in snapshot.items():
            _pending_heartbeats[key] = _merge_pending_item(_pending_heartbeats.get(key), item)


async def _flush_pending_snapshot(snapshot: dict[tuple[int, int], dict]) -> None:
    if not snapshot:
        return

    grouped: dict[int, list[int]] = {}
    for exam_id, user_id in snapshot.keys():
        grouped.setdefault(exam_id, []).append(user_id)

    for exam_id, users in grouped.items():
        unique_users = sorted(set(users))
        existing_res = await db.client.table("Responses") \
            .select("id,exam_id,user_id,status,response") \
            .eq("exam_id", exam_id) \
            .in_("user_id", unique_users) \
            .execute()
        existing_by_user = {int(row["user_id"]): row for row in (existing_res.data or [])}

        rows_to_upsert: list[dict] = []
        logs_to_insert: list[dict] = []
        submitted_touches: list[int] = []

        for user_id in unique_users:
            item = snapshot.get((exam_id, user_id))
            if not item:
                continue

            existing_row = existing_by_user.get(user_id)
            base_response = existing_row.get("response") if existing_row else {"student_roll": "", "responses": []}

            if item.get("response") is not None:
                next_response = item["response"]
            elif item.get("response_delta"):
                next_response = _merge_response_delta(base_response or {"student_roll": "", "responses": []}, item["response_delta"])
            else:
                next_response = base_response or {"student_roll": "", "responses": []}

            if existing_row and existing_row.get("status") == "submitted":
                submitted_touches.append(user_id)
            else:
                rows_to_upsert.append({
                    "exam_id": exam_id,
                    "user_id": user_id,
                    "response": next_response,
                    "status": "in_progress",
                    "last_seen_at": item.get("last_seen_at") or datetime.now(timezone.utc).isoformat(),
                })
                if not existing_row:
                    logs_to_insert.append({
                        "exam_id": exam_id,
                        "user_id": user_id,
                        "event": "joined",
                    })

            policy_events = _extract_policy_events(item.get("events"))
            for ev in policy_events:
                logs_to_insert.append({
                    "exam_id": exam_id,
                    "user_id": user_id,
                    "event": ev,
                })

        if rows_to_upsert:
            await db.client.table("Responses").upsert(rows_to_upsert, on_conflict="exam_id,user_id").execute()

        for user_id in submitted_touches:
            await db.client.table("Responses") \
                .update({"last_seen_at": datetime.now(timezone.utc).isoformat()}) \
                .eq("exam_id", exam_id) \
                .eq("user_id", user_id) \
                .execute()

        if logs_to_insert:
            await db.client.table("ExamLogs").insert(logs_to_insert).execute()


async def _heartbeat_batch_worker() -> None:
    while _batch_stop_event is not None and not _batch_stop_event.is_set():
        await asyncio.sleep(HEARTBEAT_BATCH_WINDOW_SECONDS)
        snapshot = await _drain_pending_snapshot()
        if snapshot:
            try:
                await _flush_pending_snapshot(snapshot)
            except Exception:
                logger.exception("Heartbeat batch flush failed; re-queueing pending items")
                await _requeue_snapshot(snapshot)

    snapshot = await _drain_pending_snapshot()
    if snapshot:
        try:
            await _flush_pending_snapshot(snapshot)
        except Exception:
            logger.exception("Final heartbeat batch flush failed; re-queueing pending items")
            await _requeue_snapshot(snapshot)


async def start_heartbeat_batch_worker() -> None:
    global _batch_stop_event, _batch_task
    if _batch_task is not None and not _batch_task.done():
        return
    _batch_stop_event = asyncio.Event()
    _batch_task = asyncio.create_task(_heartbeat_batch_worker())


async def stop_heartbeat_batch_worker() -> None:
    global _batch_stop_event, _batch_task
    if _batch_stop_event is not None:
        _batch_stop_event.set()
    if _batch_task is not None:
        await _batch_task
    _batch_task = None
    _batch_stop_event = None


def _compute_score(response: dict, answers: dict, questions_data: dict) -> int:
    scope_ids_raw = response.get("grading_scope_question_ids")
    scope_ids: set[int] | None = None
    if isinstance(scope_ids_raw, list):
        parsed_scope = {qid for qid in scope_ids_raw if isinstance(qid, int)}
        scope_ids = parsed_scope if parsed_scope else set()

    q_map: dict = {}
    for section in questions_data.get("sections", []):
        for q in section.get("questions", []):
            q_map[str(q["question_id"])] = q

    total = 0

    def _norm_text(v) -> str:
        return " ".join(str(v or "").strip().lower().split())

    for r in response.get("responses", []):
        qid_raw = r.get("question_id")
        if not isinstance(qid_raw, int):
            continue
        if scope_ids is not None and qid_raw not in scope_ids:
            continue
        qid = str(qid_raw)
        if qid not in q_map:
            continue
        correct = answers.get(str(qid)) if str(qid) in answers else answers.get(int(qid))
        q = q_map.get(qid, {})
        q_type = str(q.get("question_type") or "MCQ").upper()
        marks = int(q.get("marks", 1) or 0)
        negative_marks = int(q.get("negative_marks", 0) or 0)
        if marks == 0 and negative_marks == 0:
            continue
        is_correct = False
        if q_type == "FIB":
            chosen_text = _norm_text(r.get("answer_text"))
            correct_text = _norm_text(correct)
            if not chosen_text:
                continue
            is_correct = chosen_text == correct_text
        else:
            chosen = r.get("option")
            if chosen is None:
                continue
            is_correct = chosen == correct

        if is_correct:
            total += marks
        else:
            total -= negative_marks

    return max(0, total)


def _compute_total_marks_for_submission(response: dict, questions_data: dict, fallback_total: int) -> int:
    scope_ids_raw = response.get("grading_scope_question_ids")
    scope_ids: set[int] | None = None
    if isinstance(scope_ids_raw, list):
        scope_ids = {qid for qid in scope_ids_raw if isinstance(qid, int)}
        if not scope_ids:
            scope_ids = set()

    total = 0
    saw_countable = False
    for section in questions_data.get("sections", []):
        for q in section.get("questions", []):
            qid = q.get("question_id")
            if not isinstance(qid, int):
                continue
            if scope_ids is not None and qid not in scope_ids:
                continue
            marks = int(q.get("marks", 1) or 0)
            negative_marks = int(q.get("negative_marks", 0) or 0)
            if marks == 0 and negative_marks == 0:
                continue
            saw_countable = True
            total += marks

    if saw_countable:
        return total
    return fallback_total


def _option_idx_to_letter(idx: int | None) -> str | None:
    if not isinstance(idx, int):
        return None
    if 0 <= idx <= 3:
        return chr(ord("A") + idx)
    return None


def _option_letter_to_idx(letter: str | None) -> int | None:
    if not isinstance(letter, str):
        return None
    raw = letter.strip().upper()
    if raw in {"A", "B", "C", "D"}:
        return ord(raw) - ord("A")
    return None


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


def _filter_questions_by_scope(questions_data: dict, scope_ids: set[int] | None) -> dict:
    if not scope_ids:
        return questions_data

    filtered_sections = []
    for section in questions_data.get("sections", []):
        kept_questions = []
        for q in section.get("questions", []):
            qid = q.get("question_id")
            if isinstance(qid, int) and qid in scope_ids:
                kept_questions.append(q)
        if kept_questions:
            filtered_sections.append({
                **section,
                "questions": kept_questions,
            })

    return {
        **questions_data,
        "sections": filtered_sections,
    }


@router.post("/response/heartbeat", status_code=HTTP_200_OK)
async def heartbeat(hb: Heartbeat, user=Depends(get_current_user)):
    """Queue heartbeats and persist in short batches to reduce write pressure."""
    if user.get("auth_mode") == "invite_temp":
        invite_exam_id = int(user.get("invite_exam_id") or -1)
        if invite_exam_id != hb.exam_id:
            raise HTTPException(status_code=403, detail="Invite session is valid only for its assigned exam.")

        invite_expiry = str(user.get("invite_expires_at") or "")
        if not invite_expiry:
            raise HTTPException(status_code=401, detail="Invite session expired.")

        roll = str(user.get("roll", ""))
        existing = await get_invite_record(hb.exam_id, roll)
        base_response = (existing or {}).get("response") or {"student_roll": roll, "responses": []}

        if hb.response is not None:
            next_response = hb.response
        elif hb.response_delta:
            next_response = _merge_response_delta(base_response, hb.response_delta)
        else:
            next_response = base_response

        last_seen_at = datetime.now(timezone.utc).isoformat()
        event_payload = [
            {"event": ev, "created_at": last_seen_at}
            for ev in _extract_policy_events(hb.events)
        ]
        await upsert_invite_record(
            exam_id=hb.exam_id,
            roll=roll,
            response=next_response,
            status="submitted" if (existing or {}).get("status") == "submitted" else "in_progress",
            expiry_iso=invite_expiry,
            submitted_at=(existing or {}).get("submitted_at"),
            last_seen_at=last_seen_at,
            append_events=event_payload,
        )
        return {"msg": "queued"}

    key = (hb.exam_id, int(user["id"]))
    async with _pending_lock:
        _pending_heartbeats[key] = _merge_queued_heartbeat(_pending_heartbeats.get(key), hb)
    return {"msg": "queued"}


@router.post("/response/submit", status_code=HTTP_200_OK)
async def submitResponse(sub: Submit, user=Depends(get_current_user)):
    """Finalise the exam — called once on submit or when time runs out."""
    if user.get("auth_mode") == "invite_temp":
        invite_exam_id = int(user.get("invite_exam_id") or -1)
        if invite_exam_id != sub.exam_id:
            raise HTTPException(status_code=403, detail="Invite session is valid only for its assigned exam.")

        invite_expiry = str(user.get("invite_expires_at") or "")
        if not invite_expiry:
            raise HTTPException(status_code=401, detail="Invite session expired.")

        roll = str(user.get("roll", ""))
        existing = await get_invite_record(sub.exam_id, roll)
        if existing and existing.get("status") == "submitted":
            return {"msg": "Response already submitted."}

        now = datetime.now(timezone.utc).isoformat()
        await upsert_invite_record(
            exam_id=sub.exam_id,
            roll=roll,
            response=sub.response,
            status="submitted",
            expiry_iso=invite_expiry,
            submitted_at=now,
            last_seen_at=now,
            append_events=[{"event": "submitted", "created_at": now}],
        )
        return {"msg": "Response submitted."}

    pending = await _pop_single_pending(sub.exam_id, int(user["id"]))
    if pending:
        try:
            await _flush_pending_snapshot({(sub.exam_id, int(user["id"])): pending})
        except Exception:
            logger.exception("Pending heartbeat pre-flush failed before submit; continuing with direct submit")
            await _requeue_snapshot({(sub.exam_id, int(user["id"])): pending})

    existing = await db.client.table("Responses") \
        .select("status") \
        .eq("exam_id", sub.exam_id) \
        .eq("user_id", user["id"]) \
        .execute()
    if existing.data and existing.data[0].get("status") == "submitted":
        return {"msg": "Response already submitted."}

    now = datetime.now(timezone.utc).isoformat()
    await db.client.table("Responses").upsert(
        {
            "exam_id":      sub.exam_id,
            "user_id":      user["id"],
            "response":     sub.response,
            "status":       "submitted",
            "submitted_at": now,
            "last_seen_at": now,
        },
        on_conflict="exam_id,user_id",
    ).execute()
    await db.client.table("ExamLogs").insert({
        "exam_id": sub.exam_id,
        "user_id": user["id"],
        "event":   "submitted",
    }).execute()
    return {"msg": "Response submitted."}


@router.get("/response/my", status_code=HTTP_200_OK)
async def getMyResponses(user=Depends(get_current_user)):
    """All finalised submissions by the current student, with computed scores."""
    if user.get("auth_mode") == "invite_temp":
        exam_id = int(user.get("invite_exam_id") or -1)
        roll = str(user.get("roll", ""))
        rec = await get_invite_record(exam_id, roll)
        if not rec or rec.get("status") != "submitted":
            return {"responses": []}

        exam_res = await db.client.table("Exams") \
            .select("id,name,total_marks,start,end,questionpaper_id") \
            .eq("id", exam_id) \
            .limit(1) \
            .execute()
        exam = exam_res.data[0] if exam_res.data else None
        if not exam:
            return {"responses": []}

        paper_res = await db.client.table("QuestionPapers") \
            .select("id,questions,answers") \
            .eq("id", exam.get("questionpaper_id")) \
            .limit(1) \
            .execute()
        paper = paper_res.data[0] if paper_res.data else {}

        response_payload = rec.get("response") or {}
        score = _compute_score(
            response_payload,
            paper.get("answers", {}),
            paper.get("questions", {}),
        ) if paper else 0
        effective_total = _compute_total_marks_for_submission(
            response_payload,
            paper.get("questions", {}),
            exam.get("total_marks") or 1,
        ) if paper else (exam.get("total_marks") or 1)
        total_for_pct = effective_total or 1

        return {
            "responses": [
                {
                    "id": 900000000 + exam_id,
                    "submitted_at": rec.get("submitted_at"),
                    "exam_id": exam_id,
                    "exam_name": exam.get("name"),
                    "exam_start": exam.get("start"),
                    "exam_end": exam.get("end"),
                    "score": score,
                    "total_marks": effective_total,
                    "percentage": round(score / total_for_pct * 100, 1),
                    "responses_released": True,
                    "release_after_exam": False,
                }
            ]
        }

    resp_res = await db.client.table("Responses") \
        .select("id,submitted_at,response,Exams(id,name,total_marks,start,end,questionpaper_id)") \
        .eq("user_id", user["id"]) \
        .eq("status", "submitted") \
        .order("submitted_at", desc=True) \
        .execute()

    exam_ids = [r["Exams"].get("id") for r in resp_res.data if isinstance(r.get("Exams", {}).get("id"), int)]
    release_state_map = await _get_release_state_by_exam_ids(exam_ids)

    paper_ids = list({r["Exams"]["questionpaper_id"] for r in resp_res.data})
    papers: dict = {}
    if paper_ids:
        paper_res = await db.client.table("QuestionPapers") \
            .select("id,questions,answers") \
            .in_("id", paper_ids) \
            .execute()
        papers = {p["id"]: p for p in paper_res.data}

    result = []
    for r in resp_res.data:
        exam  = r["Exams"]
        release_state = release_state_map.get(exam.get("id"), {"auto_release": False, "released_manually": False})
        is_released = _is_exam_response_released(exam, release_state)
        paper = papers.get(exam["questionpaper_id"], {})
        score = _compute_score(
            r["response"],
            paper.get("answers", {}),
            paper.get("questions", {}),
        ) if paper else 0
        effective_total = _compute_total_marks_for_submission(
            r["response"],
            paper.get("questions", {}),
            exam["total_marks"] or 1,
        ) if paper else (exam["total_marks"] or 1)
        total_for_pct = effective_total or 1
        result.append({
            "id":           r["id"],
            "submitted_at": r["submitted_at"],
            "exam_id":      exam["id"],
            "exam_name":    exam["name"],
            "exam_start":   exam["start"],
            "exam_end":     exam["end"],
            "score":        score,
            "total_marks":  effective_total,
            "percentage":   round(score / total_for_pct * 100, 1),
            "responses_released": is_released,
            "release_after_exam": bool(release_state.get("auto_release")),
        })

    return {"responses": result}


@router.get("/response/my/{response_id}", status_code=HTTP_200_OK)
async def getMyResponseDetail(response_id: int, user=Depends(get_current_user)):
    """Detailed submission view for a student, including correct vs chosen options."""
    if user.get("auth_mode") == "invite_temp":
        exam_id = int(user.get("invite_exam_id") or -1)
        expected_id = 900000000 + exam_id
        if response_id != expected_id:
            raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Response not found.")

        rec = await get_invite_record(exam_id, str(user.get("roll", "")))
        if not rec or rec.get("status") != "submitted":
            raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Response not found.")

        exam_res = await db.client.table("Exams") \
            .select("id,name,total_marks,start,end,questionpaper_id") \
            .eq("id", exam_id) \
            .limit(1) \
            .execute()
        if not exam_res.data:
            raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Exam not found.")
        exam = exam_res.data[0]

        question_paper_id = exam.get("questionpaper_id")
        if not question_paper_id:
            raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Question paper not found for this response.")

        paper_res = await db.client.table("QuestionPapers") \
            .select("id,questions,answers") \
            .eq("id", question_paper_id) \
            .limit(1) \
            .execute()
        if not paper_res.data:
            raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Question paper not found.")

        paper = paper_res.data[0]
        questions_data = paper.get("questions") or {}
        answers = paper.get("answers") or {}
        submission = rec.get("response") or {}

        scope_raw = submission.get("grading_scope_question_ids")
        scope_ids: set[int] | None = None
        if isinstance(scope_raw, list):
            scope_ids = {qid for qid in scope_raw if isinstance(qid, int)}

        display_questions = _filter_questions_by_scope(questions_data, scope_ids)
        submitted_map: dict[int, dict] = {}
        for item in submission.get("responses", []):
            qid = item.get("question_id") if isinstance(item, dict) else None
            if isinstance(qid, int):
                submitted_map[qid] = {
                    "question_id": qid,
                    "option": item.get("option"),
                    "answer_text": item.get("answer_text"),
                    "marked": bool(item.get("marked", False)),
                }

        review_sections = []
        for section in display_questions.get("sections", []):
            questions = []
            for q in section.get("questions", []):
                qid = q.get("question_id")
                if not isinstance(qid, int):
                    continue
                correct = answers.get(str(qid)) if str(qid) in answers else answers.get(qid)
                chosen = submitted_map.get(qid, {}).get("option")
                chosen_text = submitted_map.get(qid, {}).get("answer_text")
                q_type = str(q.get("question_type") or "MCQ").upper()
                is_correct = False
                if q_type == "FIB":
                    norm_chosen = " ".join(str(chosen_text or "").strip().lower().split())
                    norm_correct = " ".join(str(correct or "").strip().lower().split())
                    is_correct = bool(norm_chosen) and norm_chosen == norm_correct
                else:
                    is_correct = chosen is not None and correct is not None and chosen == correct
                questions.append({
                    **q,
                    "correct_option": correct,
                    "chosen_option": chosen,
                    "correct_answer_text": correct if q_type == "FIB" else None,
                    "chosen_answer_text": chosen_text if q_type == "FIB" else None,
                    "marked": bool(submitted_map.get(qid, {}).get("marked", False)),
                    "is_correct": is_correct,
                })

            review_sections.append({
                **section,
                "questions": questions,
            })

        score = _compute_score(submission, answers, display_questions)
        total_marks = _compute_total_marks_for_submission(
            submission,
            display_questions,
            exam.get("total_marks") or 1,
        )
        pct_base = total_marks or 1

        return {
            "response": {
                "id": response_id,
                "submitted_at": rec.get("submitted_at"),
                "exam_id": exam.get("id"),
                "exam_name": exam.get("name"),
                "exam_start": exam.get("start"),
                "exam_end": exam.get("end"),
                "score": score,
                "total_marks": total_marks,
                "percentage": round(score / pct_base * 100, 1),
                "sections": review_sections,
            }
        }

    resp_res = await db.client.table("Responses") \
        .select("id,submitted_at,response,exam_id,Exams(id,name,total_marks,start,end,questionpaper_id)") \
        .eq("id", response_id) \
        .eq("user_id", user["id"]) \
        .eq("status", "submitted") \
        .limit(1) \
        .execute()

    if not resp_res.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Response not found.")

    row = resp_res.data[0]
    exam = row.get("Exams") or {}

    release_state_map = await _get_release_state_by_exam_ids([exam.get("id")] if isinstance(exam.get("id"), int) else [])
    release_state = release_state_map.get(exam.get("id"), {"auto_release": False, "released_manually": False})
    if not _is_exam_response_released(exam, release_state):
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Response review is not released by faculty yet.")

    question_paper_id = exam.get("questionpaper_id")
    if not question_paper_id:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Question paper not found for this response.")

    paper_res = await db.client.table("QuestionPapers") \
        .select("id,questions,answers") \
        .eq("id", question_paper_id) \
        .limit(1) \
        .execute()
    if not paper_res.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Question paper not found.")

    paper = paper_res.data[0]
    questions_data = paper.get("questions") or {}
    answers = paper.get("answers") or {}
    submission = row.get("response") or {}

    scope_raw = submission.get("grading_scope_question_ids")
    scope_ids: set[int] | None = None
    if isinstance(scope_raw, list):
        scope_ids = {qid for qid in scope_raw if isinstance(qid, int)}

    display_questions = _filter_questions_by_scope(questions_data, scope_ids)
    submitted_map: dict[int, dict] = {}
    for item in submission.get("responses", []):
        qid = item.get("question_id") if isinstance(item, dict) else None
        if isinstance(qid, int):
            submitted_map[qid] = {
                "question_id": qid,
                "option": item.get("option"),
                "answer_text": item.get("answer_text"),
                "marked": bool(item.get("marked", False)),
            }

    review_sections = []
    for section in display_questions.get("sections", []):
        questions = []
        for q in section.get("questions", []):
            qid = q.get("question_id")
            if not isinstance(qid, int):
                continue
            correct = answers.get(str(qid)) if str(qid) in answers else answers.get(qid)
            chosen = submitted_map.get(qid, {}).get("option")
            chosen_text = submitted_map.get(qid, {}).get("answer_text")
            q_type = str(q.get("question_type") or "MCQ").upper()
            is_correct = False
            if q_type == "FIB":
                norm_chosen = " ".join(str(chosen_text or "").strip().lower().split())
                norm_correct = " ".join(str(correct or "").strip().lower().split())
                is_correct = bool(norm_chosen) and norm_chosen == norm_correct
            else:
                is_correct = chosen is not None and correct is not None and chosen == correct
            questions.append({
                **q,
                "correct_option": correct,
                "chosen_option": chosen,
                "correct_answer_text": correct if q_type == "FIB" else None,
                "chosen_answer_text": chosen_text if q_type == "FIB" else None,
                "marked": bool(submitted_map.get(qid, {}).get("marked", False)),
                "is_correct": is_correct,
            })

        review_sections.append({
            **section,
            "questions": questions,
        })

    score = _compute_score(submission, answers, display_questions)
    total_marks = _compute_total_marks_for_submission(
        submission,
        display_questions,
        exam.get("total_marks") or 1,
    )
    pct_base = total_marks or 1

    return {
        "response": {
            "id": row["id"],
            "submitted_at": row.get("submitted_at"),
            "exam_id": exam.get("id"),
            "exam_name": exam.get("name"),
            "exam_start": exam.get("start"),
            "exam_end": exam.get("end"),
            "score": score,
            "total_marks": total_marks,
            "percentage": round(score / pct_base * 100, 1),
            "sections": review_sections,
        }
    }


@router.post("/response/my/{response_id}/flag-question", status_code=HTTP_200_OK)
async def flagMyQuestion(response_id: int, body: FlagQuestionRequest, user=Depends(get_current_user)):
    """Allow students to flag a specific reviewed question for faculty follow-up."""
    why_wrong = (body.why_wrong or "").strip()
    expected_answer = (body.expected_answer or "").strip()
    correct_option = (body.correct_option or "").strip().upper()

    if not why_wrong:
                raise HTTPException(status_code=400, detail="Why is this wrong? is required.")
    if not expected_answer:
                raise HTTPException(status_code=400, detail="What would the correct answer be? is required.")
    if correct_option not in {"A", "B", "C", "D"}:
                raise HTTPException(status_code=400, detail="Correct option must be one of A, B, C, D.")

    resp_res = await db.client.table("Responses") \
        .select("id,response,Exams(id,name,creator_id,questionpaper_id)") \
        .eq("id", response_id) \
        .eq("user_id", user["id"]) \
        .eq("status", "submitted") \
        .limit(1) \
        .execute()
    if not resp_res.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Response not found.")

    row = resp_res.data[0]
    exam = row.get("Exams") or {}

    release_state_map = await _get_release_state_by_exam_ids([exam.get("id")] if isinstance(exam.get("id"), int) else [])
    release_state = release_state_map.get(exam.get("id"), {"auto_release": False, "released_manually": False})
    if not _is_exam_response_released(exam, release_state):
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Response review is not released by faculty yet.")

    faculty_id = exam.get("creator_id")
    paper_id = exam.get("questionpaper_id")
    if not isinstance(faculty_id, int):
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Faculty owner not found for this exam.")
    if not isinstance(paper_id, int):
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Question paper not found for this response.")

    paper_res = await db.client.table("QuestionPapers") \
        .select("questions") \
        .eq("id", paper_id) \
        .limit(1) \
        .execute()
    if not paper_res.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Question paper not found.")

    questions_data = paper_res.data[0].get("questions") or {}
    submission = row.get("response") or {}
    scope_raw = submission.get("grading_scope_question_ids")
    scope_ids: set[int] | None = None
    if isinstance(scope_raw, list):
        scope_ids = {qid for qid in scope_raw if isinstance(qid, int)}
    display_questions = _filter_questions_by_scope(questions_data, scope_ids)

    valid_qids = {
        q.get("question_id")
        for section in display_questions.get("sections", [])
        for q in section.get("questions", [])
        if isinstance(q.get("question_id"), int)
    }
    if body.question_id not in valid_qids:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Question not found in this response.")

    chosen_option_idx = None
    for item in submission.get("responses", []):
        if not isinstance(item, dict):
            continue
        if item.get("question_id") == body.question_id:
            opt = item.get("option")
            if isinstance(opt, int):
                chosen_option_idx = opt
            break

    chosen_option_letter = _option_idx_to_letter(chosen_option_idx)

    payload = {
        "response_id": response_id,
        "exam_id": exam.get("id"),
        "exam_name": exam.get("name"),
        "question_id": body.question_id,
        "why_is_this_wrong": why_wrong,
        "what_should_be_correct": expected_answer,
        "correct_option": correct_option,
        "student_marked_option": chosen_option_letter,
    }

    row_to_insert = {
        "student_id": user["id"],
        "faculty_id": faculty_id,
        "payload": payload,
    }
    try:
        await db.client.table("FlaggedQuestions").insert(row_to_insert).execute()
    except Exception:
        try:
            await db.client.table("flagged_questions").insert(row_to_insert).execute()
        except Exception:
            raise HTTPException(status_code=400, detail="Flag table not found or schema mismatch. Create FlaggedQuestions/flagged_questions with student_id, faculty_id, payload.")

    return {"msg": "Question flagged successfully."}


@router.get("/response/queries/my-faculty", status_code=HTTP_200_OK)
async def getFacultyQuestionQueries(user=Depends(get_current_user)):
    """Faculty inbox of student flagged-question queries."""
    if user.get("role") not in {"Faculty", "HOD", "Admin"}:
        raise HTTPException(status_code=403, detail="Only faculty can view question queries.")

    rows = []
    try:
        res = await db.client.table("FlaggedQuestions") \
            .select("id,student_id,payload,created_at") \
            .eq("faculty_id", user["id"]) \
            .order("created_at", desc=True) \
            .execute()
        rows = res.data or []
    except Exception:
        try:
            res = await db.client.table("flagged_questions") \
                .select("id,student_id,payload,created_at") \
                .eq("faculty_id", user["id"]) \
                .order("created_at", desc=True) \
                .execute()
            rows = res.data or []
        except Exception:
            rows = []

    student_ids = sorted({r.get("student_id") for r in rows if isinstance(r.get("student_id"), int)})
    user_by_id: dict[int, dict] = {}
    if student_ids:
        users_res = await db.client.table("Users") \
            .select("id,name,roll") \
            .in_("id", student_ids) \
            .execute()
        user_by_id = {u["id"]: u for u in (users_res.data or []) if isinstance(u.get("id"), int)}

    items = []
    for row in rows:
        payload = row.get("payload") or {}
        if not isinstance(payload, dict):
            payload = {}
        student_id = row.get("student_id") if isinstance(row.get("student_id"), int) else None
        student = user_by_id.get(student_id or -1, {})
        faculty_answer = str(payload.get("faculty_response") or "").strip()

        items.append({
            "id": row.get("id"),
            "response_id": payload.get("response_id"),
            "exam_id": payload.get("exam_id"),
            "exam_name": payload.get("exam_name") or "",
            "question_id": payload.get("question_id"),
            "why_wrong": payload.get("why_is_this_wrong") or "",
            "expected_answer": payload.get("what_should_be_correct") or "",
            "student_correct_option": payload.get("correct_option") or "",
            "student_marked_option": payload.get("student_marked_option") or "",
            "faculty_response": faculty_answer,
            "status": "answered" if faculty_answer else "pending",
            "answered_at": payload.get("answered_at"),
            "answer_key_corrected": bool(payload.get("answer_key_corrected")),
            "corrected_option": payload.get("corrected_option") or "",
            "created_at": row.get("created_at"),
            "student_name": student.get("name") or "",
            "student_roll": student.get("roll") or "",
        })

    pending = sum(1 for i in items if i.get("status") == "pending")
    answered = len(items) - pending
    return {
        "queries": items,
        "summary": {
            "total": len(items),
            "pending": pending,
            "answered": answered,
        },
    }


@router.post("/response/queries/{query_id}/answer", status_code=HTTP_200_OK)
async def answerFacultyQuestionQuery(query_id: int, body: AnswerFlaggedQuestionRequest, user=Depends(get_current_user)):
    """Faculty answers a student flagged-question query."""
    if user.get("role") not in {"Faculty", "HOD", "Admin"}:
        raise HTTPException(status_code=403, detail="Only faculty can answer question queries.")

    answer = (body.answer or "").strip()
    if not answer:
        raise HTTPException(status_code=400, detail="Answer is required.")

    row = None
    table_name = "FlaggedQuestions"
    try:
        res = await db.client.table("FlaggedQuestions") \
            .select("id,payload") \
            .eq("id", query_id) \
            .eq("faculty_id", user["id"]) \
            .limit(1) \
            .execute()
        row = res.data[0] if res.data else None
    except Exception:
        table_name = "flagged_questions"
        res = await db.client.table("flagged_questions") \
            .select("id,payload") \
            .eq("id", query_id) \
            .eq("faculty_id", user["id"]) \
            .limit(1) \
            .execute()
        row = res.data[0] if res.data else None

    if not row:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Query not found.")

    payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
    payload["faculty_response"] = answer
    payload["answered_at"] = datetime.now(timezone.utc).isoformat()
    payload["answered_by"] = user.get("name") or "Faculty"

    should_apply_correction = bool(body.apply_key_correction)
    if should_apply_correction:
        chosen = _option_letter_to_idx(body.corrected_option)

        if bool(body.use_student_marked_option):
            student_marked_letter = payload.get("student_marked_option") or payload.get("correct_option")
            chosen = _option_letter_to_idx(str(student_marked_letter) if student_marked_letter is not None else None)

        if chosen is None:
            raise HTTPException(status_code=400, detail="Choose a valid corrected option (A-D) or use student's marked option.")

        exam_id = payload.get("exam_id")
        question_id = payload.get("question_id")
        if not isinstance(exam_id, int) or not isinstance(question_id, int):
            raise HTTPException(status_code=400, detail="Query payload is missing exam/question reference.")

        exam_res = await db.client.table("Exams") \
            .select("id,questionpaper_id,creator_id") \
            .eq("id", exam_id) \
            .eq("creator_id", user["id"]) \
            .limit(1) \
            .execute()
        if not exam_res.data:
            raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Exam not found for this query.")

        paper_id = exam_res.data[0].get("questionpaper_id")
        if not isinstance(paper_id, int):
            raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Question paper not found for this query.")

        paper_res = await db.client.table("QuestionPapers") \
            .select("id,answers") \
            .eq("id", paper_id) \
            .limit(1) \
            .execute()
        if not paper_res.data:
            raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Question paper not found.")

        answers = paper_res.data[0].get("answers") or {}
        if not isinstance(answers, dict):
            answers = {}
        answers[str(question_id)] = chosen

        await db.client.table("QuestionPapers") \
            .update({"answers": answers}) \
            .eq("id", paper_id) \
            .execute()

        payload["answer_key_corrected"] = True
        payload["corrected_option"] = _option_idx_to_letter(chosen)
        payload["corrected_questionpaper_id"] = paper_id

        await db.client.table("ExamLogs").insert({
            "exam_id": exam_id,
            "user_id": user["id"],
            "event": "answer_key_corrected",
        }).execute()

    await db.client.table(table_name) \
        .update({"payload": payload}) \
        .eq("id", query_id) \
        .eq("faculty_id", user["id"]) \
        .execute()

    return {"msg": "Query answered successfully."}


@router.get("/response/queries/my", status_code=HTTP_200_OK)
async def getMyQuestionQueries(user=Depends(get_current_user)):
    """Student view of their flagged-question queries and faculty responses."""
    if user.get("role") != "Student":
        raise HTTPException(status_code=403, detail="Only students can view their queries.")

    rows = []
    try:
        res = await db.client.table("FlaggedQuestions") \
            .select("id,student_id,payload,created_at") \
            .eq("student_id", user["id"]) \
            .order("created_at", desc=True) \
            .execute()
        rows = res.data or []
    except Exception:
        try:
            res = await db.client.table("flagged_questions") \
                .select("id,student_id,payload,created_at") \
                .eq("student_id", user["id"]) \
                .order("created_at", desc=True) \
                .execute()
            rows = res.data or []
        except Exception:
            rows = []

    items = []
    for row in rows:
        payload = row.get("payload") or {}
        if not isinstance(payload, dict):
            payload = {}

        faculty_answer = str(payload.get("faculty_response") or "").strip()
        items.append({
            "id": row.get("id"),
            "response_id": payload.get("response_id"),
            "exam_id": payload.get("exam_id"),
            "exam_name": payload.get("exam_name") or "",
            "question_id": payload.get("question_id"),
            "why_wrong": payload.get("why_is_this_wrong") or "",
            "expected_answer": payload.get("what_should_be_correct") or "",
            "student_correct_option": payload.get("correct_option") or "",
            "student_marked_option": payload.get("student_marked_option") or "",
            "faculty_response": faculty_answer,
            "status": "answered" if faculty_answer else "pending",
            "answered_at": payload.get("answered_at"),
            "answer_key_corrected": bool(payload.get("answer_key_corrected")),
            "corrected_option": payload.get("corrected_option") or "",
            "created_at": row.get("created_at"),
        })

    pending = sum(1 for i in items if i.get("status") == "pending")
    answered = len(items) - pending

    return {
        "queries": items,
        "summary": {
            "total": len(items),
            "pending": pending,
            "answered": answered,
        },
    }


@router.get("/response/queries/hod-solved", status_code=HTTP_200_OK)
async def getHodSolvedQuestionQueries(user=Depends(get_current_user)):
    """HOD view of solved (answered) student question queries only."""
    if user.get("role") != "HOD":
        raise HTTPException(status_code=403, detail="Only HOD can view solved queries.")

    rows = []
    try:
        res = await db.client.table("FlaggedQuestions") \
            .select("id,student_id,faculty_id,payload,created_at") \
            .order("created_at", desc=True) \
            .execute()
        rows = res.data or []
    except Exception:
        try:
            res = await db.client.table("flagged_questions") \
                .select("id,student_id,faculty_id,payload,created_at") \
                .order("created_at", desc=True) \
                .execute()
            rows = res.data or []
        except Exception:
            rows = []

    rows = [
        r for r in rows
        if isinstance(r.get("payload"), dict) and str((r.get("payload") or {}).get("faculty_response") or "").strip()
    ]

    user_ids = set()
    for r in rows:
        sid = r.get("student_id")
        fid = r.get("faculty_id")
        if isinstance(sid, int):
            user_ids.add(sid)
        if isinstance(fid, int):
            user_ids.add(fid)

    user_by_id: dict[int, dict] = {}
    if user_ids:
        users_res = await db.client.table("Users") \
            .select("id,name,roll") \
            .in_("id", list(user_ids)) \
            .execute()
        user_by_id = {u["id"]: u for u in (users_res.data or []) if isinstance(u.get("id"), int)}

    items = []
    for row in rows:
        payload = row.get("payload") or {}
        if not isinstance(payload, dict):
            payload = {}

        student_id = row.get("student_id") if isinstance(row.get("student_id"), int) else None
        faculty_id = row.get("faculty_id") if isinstance(row.get("faculty_id"), int) else None
        student = user_by_id.get(student_id or -1, {})
        faculty = user_by_id.get(faculty_id or -1, {})

        items.append({
            "id": row.get("id"),
            "response_id": payload.get("response_id"),
            "exam_id": payload.get("exam_id"),
            "exam_name": payload.get("exam_name") or "",
            "question_id": payload.get("question_id"),
            "why_wrong": payload.get("why_is_this_wrong") or "",
            "expected_answer": payload.get("what_should_be_correct") or "",
            "student_correct_option": payload.get("correct_option") or "",
            "student_marked_option": payload.get("student_marked_option") or "",
            "faculty_response": payload.get("faculty_response") or "",
            "answered_at": payload.get("answered_at"),
            "answer_key_corrected": bool(payload.get("answer_key_corrected")),
            "corrected_option": payload.get("corrected_option") or "",
            "created_at": row.get("created_at"),
            "student_name": student.get("name") or "",
            "student_roll": student.get("roll") or "",
            "faculty_name": faculty.get("name") or "",
            "faculty_roll": faculty.get("roll") or "",
        })

    return {
        "queries": items,
        "summary": {
            "total": len(items),
        },
    }
