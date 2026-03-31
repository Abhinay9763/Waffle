from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends
from starlette.status import HTTP_200_OK

from deps import get_current_user
from models import Heartbeat, Submit
from supa import db

router = APIRouter()

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


def _compute_score(response: dict, answers: dict, questions_data: dict) -> int:
    q_map: dict = {}
    for section in questions_data.get("sections", []):
        for q in section.get("questions", []):
            q_map[str(q["question_id"])] = q

    total = 0
    for r in response.get("responses", []):
        qid = str(r.get("question_id"))
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


@router.post("/response/heartbeat", status_code=HTTP_200_OK)
async def heartbeat(hb: Heartbeat, user=Depends(get_current_user)):
    """PyQt client calls this every X seconds to autosave and signal presence."""
    now = datetime.now(timezone.utc).isoformat()

    # Detect first-ever join for this student+exam and read current status.
    existing = await db.client.table("Responses") \
        .select("id,status,response") \
        .eq("exam_id", hb.exam_id) \
        .eq("user_id", user["id"]) \
        .execute()

    existing_row = existing.data[0] if existing.data else None
    if not existing.data:
        await db.client.table("ExamLogs").insert({
            "exam_id": hb.exam_id,
            "user_id": user["id"],
            "event":   "joined",
        }).execute()

    base_response = existing_row.get("response") if existing_row else {"student_roll": "", "responses": []}
    next_response = None
    if hb.response is not None:
        next_response = hb.response
    elif hb.response_delta:
        next_response = _merge_response_delta(base_response or {"student_roll": "", "responses": []}, hb.response_delta)

    # Never downgrade submitted -> in_progress due to late heartbeat race.
    if existing_row and existing_row.get("status") == "submitted":
        await db.client.table("Responses") \
            .update({"last_seen_at": now}) \
            .eq("exam_id", hb.exam_id) \
            .eq("user_id", user["id"]) \
            .execute()
    elif existing_row:
        payload = {"last_seen_at": now, "status": "in_progress"}
        if next_response is not None:
            payload["response"] = next_response
        await db.client.table("Responses") \
            .update(payload) \
            .eq("exam_id", hb.exam_id) \
            .eq("user_id", user["id"]) \
            .execute()
    else:
        await db.client.table("Responses").upsert(
            {
                "exam_id":      hb.exam_id,
                "user_id":      user["id"],
                "response":     next_response or {"student_roll": "", "responses": []},
                "status":       "in_progress",
                "last_seen_at": now,
            },
            on_conflict="exam_id,user_id",
        ).execute()

    policy_events = _extract_policy_events(hb.events)
    if policy_events:
        await db.client.table("ExamLogs").insert([
            {
                "exam_id": hb.exam_id,
                "user_id": user["id"],
                "event": ev,
            }
            for ev in policy_events
        ]).execute()

    return {"msg": "ok"}


@router.post("/response/submit", status_code=HTTP_200_OK)
async def submitResponse(sub: Submit, user=Depends(get_current_user)):
    """Finalise the exam — called once on submit or when time runs out."""
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
        total = exam["total_marks"] or 1
        result.append({
            "id":           r["id"],
            "submitted_at": r["submitted_at"],
            "exam_id":      exam["id"],
            "exam_name":    exam["name"],
            "exam_start":   exam["start"],
            "exam_end":     exam["end"],
            "score":        score,
            "total_marks":  exam["total_marks"],
            "percentage":   round(score / total * 100, 1),
        })

    return {"responses": result}
