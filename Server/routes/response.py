from datetime import datetime, timezone, timedelta
import asyncio
import os

from fastapi import APIRouter, Depends
from starlette.status import HTTP_200_OK

from deps import get_current_user
from models import Heartbeat, Submit
from supa import db

router = APIRouter()

HEARTBEAT_BATCH_WINDOW_SECONDS = max(1, int(os.getenv("HEARTBEAT_BATCH_WINDOW_SECONDS", "2")))
_pending_heartbeats: dict[tuple[int, int], dict] = {}
_pending_lock = asyncio.Lock()
_batch_stop_event: asyncio.Event | None = None
_batch_task: asyncio.Task | None = None

ALLOWED_POLICY_EVENTS = {
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

    for d in delta[:200]:
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
            await _flush_pending_snapshot(snapshot)

    snapshot = await _drain_pending_snapshot()
    if snapshot:
        await _flush_pending_snapshot(snapshot)


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
    for r in response.get("responses", []):
        qid_raw = r.get("question_id")
        if not isinstance(qid_raw, int):
            continue
        if scope_ids is not None and qid_raw not in scope_ids:
            continue
        qid = str(qid_raw)
        chosen = r.get("option")
        if chosen is None or qid not in q_map:
            continue
        correct = answers.get(str(qid)) if str(qid) in answers else answers.get(int(qid))
        q = q_map.get(qid, {})
        if chosen == correct:
            total += q.get("marks", 1)
        else:
            total -= q.get("negative_marks", 0)

    return max(0, total)


def _compute_total_marks_for_submission(response: dict, questions_data: dict, fallback_total: int) -> int:
    scope_ids_raw = response.get("grading_scope_question_ids")
    if not isinstance(scope_ids_raw, list):
        return fallback_total

    scope_ids = {qid for qid in scope_ids_raw if isinstance(qid, int)}
    if not scope_ids:
        return fallback_total

    total = 0
    for section in questions_data.get("sections", []):
        for q in section.get("questions", []):
            qid = q.get("question_id")
            if not isinstance(qid, int) or qid not in scope_ids:
                continue
            total += q.get("marks", 1)

    return total if total > 0 else fallback_total


@router.post("/response/heartbeat", status_code=HTTP_200_OK)
async def heartbeat(hb: Heartbeat, user=Depends(get_current_user)):
    """Queue heartbeats and persist in short batches to reduce write pressure."""
    key = (hb.exam_id, int(user["id"]))
    async with _pending_lock:
        _pending_heartbeats[key] = _merge_queued_heartbeat(_pending_heartbeats.get(key), hb)
    return {"msg": "queued"}


@router.post("/response/submit", status_code=HTTP_200_OK)
async def submitResponse(sub: Submit, user=Depends(get_current_user)):
    """Finalise the exam — called once on submit or when time runs out."""
    pending = await _pop_single_pending(sub.exam_id, int(user["id"]))
    if pending:
        await _flush_pending_snapshot({(sub.exam_id, int(user["id"])): pending})

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
    resp_res = await db.client.table("Responses") \
        .select("id,submitted_at,response,Exams(id,name,total_marks,start,end,questionpaper_id)") \
        .eq("user_id", user["id"]) \
        .eq("status", "submitted") \
        .order("submitted_at", desc=True) \
        .execute()

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
        })

    return {"responses": result}
