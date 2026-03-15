from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException
from starlette.status import HTTP_201_CREATED, HTTP_403_FORBIDDEN, HTTP_404_NOT_FOUND

from deps import get_current_user
from models import Exam, RetakeRequest
from supa import db

router = APIRouter()


def compute_score(response: dict, answers: dict, questions_data: dict) -> int:
    # Build a flat question map: question_id → { marks, negative_marks }
    q_map: dict = {}
    for section in questions_data.get("sections", []):
        for q in section.get("questions", []):
            q_map[str(q["question_id"])] = q

    total = 0
    for r in response.get("responses", []):
        qid = str(r.get("question_id"))
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


@router.post("/exam/create", status_code=HTTP_201_CREATED)
async def createExam(exam: Exam, user=Depends(get_current_user)):
    data = exam.model_dump(exclude={"id", "created_at"})
    data["creator_id"] = user["id"]
    data["start"] = data["start"].isoformat()
    data["end"] = data["end"].isoformat()
    response = await db.client.table("Exams").insert(data).execute()
    return {"msg": "Exam created", "id": response.data[0]["id"]}


@router.get("/exam/available")
async def availableExams(user=Depends(get_current_user)):
    """All exams visible to students — no creator filter."""
    response = await db.client.table("Exams") \
        .select("id,name,total_marks,start,end,Users!creator_id(name)") \
        .order("start") \
        .execute()
    exams = []
    for e in response.data:
        faculty = e.pop("Users", None)
        e["faculty_name"] = faculty["name"] if faculty else ""
        exams.append(e)
    return {"exams": exams}


@router.get("/exam/{exam_id}/take")
async def takeExam(exam_id: int, user=Depends(get_current_user)):
    """Return full exam + paper data for a student to take."""
    exam_res = await db.client.table("Exams") \
        .select("name,total_marks,start,end,questionpaper_id") \
        .eq("id", exam_id) \
        .execute()
    if not exam_res.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Exam not found.")
    exam = exam_res.data[0]

    submitted = await db.client.table("Responses") \
        .select("id") \
        .eq("exam_id", exam_id) \
        .eq("user_id", user["id"]) \
        .eq("status", "submitted") \
        .execute()
    if submitted.data:
        raise HTTPException(status_code=HTTP_403_FORBIDDEN, detail="You have already submitted this exam.")

    paper_res = await db.client.table("QuestionPapers") \
        .select("questions") \
        .eq("id", exam["questionpaper_id"]) \
        .execute()
    if not paper_res.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Paper not found.")

    return {
        "meta": {
            "exam_id": exam_id,
            "exam_name": exam["name"],
            "start_time": exam["start"],
            "end_time": exam["end"],
            "total_marks": exam["total_marks"],
        },
        "sections": paper_res.data[0]["questions"].get("sections", []),
    }


@router.get("/exam/list")
async def listExams(user=Depends(get_current_user)):
    response = await db.client.table("Exams") \
        .select("id,name,total_marks,start,end,created_at") \
        .eq("creator_id", user["id"]) \
        .order("created_at", desc=True) \
        .execute()
    return {"exams": response.data}


@router.get("/exam/{exam_id}/responses")
async def getExamResponses(exam_id: int, user=Depends(get_current_user)):
    # 1. Verify exam ownership
    exam_res = await db.client.table("Exams") \
        .select("*") \
        .eq("id", exam_id) \
        .eq("creator_id", user["id"]) \
        .execute()
    if not exam_res.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Exam not found.")
    exam = exam_res.data[0]

    # 2. Fetch question paper for scoring
    paper_res = await db.client.table("QuestionPapers") \
        .select("questions,answers") \
        .eq("id", exam["questionpaper_id"]) \
        .execute()
    if not paper_res.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Question paper not found.")
    paper = paper_res.data[0]

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
    exam_res = await db.client.table("Exams") \
        .select("id,name,total_marks,start,end,questionpaper_id") \
        .eq("id", exam_id) \
        .eq("creator_id", user["id"]) \
        .execute()
    if not exam_res.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Exam not found.")
    exam = exam_res.data[0]

    # 2. Total question count from paper
    paper_res = await db.client.table("QuestionPapers") \
        .select("questions") \
        .eq("id", exam["questionpaper_id"]) \
        .execute()
    total_questions = 0
    if paper_res.data:
        qs = paper_res.data[0]["questions"]
        for section in qs.get("sections", []):
            total_questions += len(section.get("questions", []))

    # 3. Fetch in-progress responses
    resp_res = await db.client.table("Responses") \
        .select("last_seen_at,response,Users(name,roll)") \
        .eq("exam_id", exam_id) \
        .eq("status", "in_progress") \
        .execute()

    now = datetime.now(timezone.utc)
    active_threshold = timedelta(seconds=60)

    active, idle = [], []
    for r in resp_res.data:
        answered = sum(
            1 for q in r["response"].get("responses", [])
            if q.get("option") is not None
        )
        entry = {
            "student_name": r["Users"]["name"],
            "student_roll": r["Users"]["roll"],
            "last_seen_at": r["last_seen_at"],
            "answered": answered,
            "total": total_questions,
        }
        last_seen = datetime.fromisoformat(r["last_seen_at"].replace("Z", "+00:00"))
        if now - last_seen <= active_threshold:
            active.append(entry)
        else:
            idle.append(entry)

    # 4. Fetch submitted responses
    submitted_res = await db.client.table("Responses") \
        .select("user_id,submitted_at,Users(name,roll)") \
        .eq("exam_id", exam_id) \
        .eq("status", "submitted") \
        .order("submitted_at") \
        .execute()

    submitted = [
        {
            "student_name": r["Users"]["name"],
            "student_roll": r["Users"]["roll"],
            "submitted_at": r["submitted_at"],
            "user_id":      r["user_id"],
        }
        for r in submitted_res.data
    ]

    return {"exam": exam, "active": active, "idle": idle, "submitted": submitted}


@router.get("/exam/{exam_id}/logs")
async def getExamLogs(exam_id: int, user=Depends(get_current_user)):
    """Recent event log for a live exam — faculty only."""
    exam_res = await db.client.table("Exams") \
        .select("id") \
        .eq("id", exam_id) \
        .eq("creator_id", user["id"]) \
        .execute()
    if not exam_res.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Exam not found.")

    logs = await db.client.table("ExamLogs") \
        .select("event,created_at,Users(name,roll)") \
        .eq("exam_id", exam_id) \
        .order("created_at", desc=True) \
        .limit(100) \
        .execute()
    return {"logs": logs.data}


@router.post("/exam/{exam_id}/retake")
async def grantRetake(exam_id: int, body: RetakeRequest, user=Depends(get_current_user)):
    """Faculty: revert a submitted response back to in_progress so student can retake."""
    exam_res = await db.client.table("Exams") \
        .select("id") \
        .eq("id", exam_id) \
        .eq("creator_id", user["id"]) \
        .execute()
    if not exam_res.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Exam not found.")

    await db.client.table("Responses") \
        .update({"status": "in_progress", "submitted_at": None}) \
        .eq("exam_id", exam_id) \
        .eq("user_id", body.user_id) \
        .execute()
    await db.client.table("ExamLogs").insert({
        "exam_id": exam_id,
        "user_id": body.user_id,
        "event":   "retake_granted",
    }).execute()
    return {"msg": "Retake granted."}
