from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends
from starlette.status import HTTP_200_OK

from deps import get_current_user
from models import Heartbeat, Submit
from supa import db

router = APIRouter()


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

    # Detect first-ever join for this student+exam
    existing = await db.client.table("Responses") \
        .select("id") \
        .eq("exam_id", hb.exam_id) \
        .eq("user_id", user["id"]) \
        .execute()
    if not existing.data:
        await db.client.table("ExamLogs").insert({
            "exam_id": hb.exam_id,
            "user_id": user["id"],
            "event":   "joined",
        }).execute()

    await db.client.table("Responses").upsert(
        {
            "exam_id":      hb.exam_id,
            "user_id":      user["id"],
            "response":     hb.response,
            "status":       "in_progress",
            "last_seen_at": now,
        },
        on_conflict="exam_id,user_id",
    ).execute()
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
