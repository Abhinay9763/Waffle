from fastapi import APIRouter, Depends, HTTPException
from starlette.status import HTTP_201_CREATED, HTTP_404_NOT_FOUND, HTTP_409_CONFLICT

from deps import get_current_user
from models import QuestionPaper
from supa import db

router = APIRouter()


@router.post("/paper/create", status_code=HTTP_201_CREATED)
async def createPaper(paper: QuestionPaper, user=Depends(get_current_user)):
    data = paper.model_dump(exclude={"id"})
    data["creator_id"] = user["id"]
    response = await db.client.table("QuestionPapers").insert(data).execute()
    return {"msg": "Paper created", "id": response.data[0]["id"]}


@router.get("/paper/list")
async def listPapers(user=Depends(get_current_user)):
    response = await db.client.table("QuestionPapers") \
        .select("id,questions") \
        .eq("creator_id", user["id"]) \
        .execute()

    papers = []
    for p in response.data:
        q = p["questions"]
        meta = q.get("meta", {})
        total_marks = meta.get("total_marks") or sum(
            question.get("marks", 0)
            for section in q.get("sections", [])
            for question in section.get("questions", [])
        )
        papers.append({
            "id": p["id"],
            "name": meta.get("exam_name") or f"Paper #{p['id']}",
            "total_marks": total_marks,
        })

    return {"papers": papers}


@router.get("/paper/{paper_id}")
async def getPaper(paper_id: int, user=Depends(get_current_user)):
    paper_res = await db.client.table("QuestionPapers") \
        .select("*") \
        .eq("id", paper_id) \
        .eq("creator_id", user["id"]) \
        .execute()

    if not paper_res.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Paper not found.")

    paper = paper_res.data[0]
    exam_res = await db.client.table("Exams") \
        .select("id") \
        .eq("questionpaper_id", paper_id) \
        .limit(1) \
        .execute()
    paper["in_use"] = len(exam_res.data) > 0
    return paper


@router.put("/paper/{paper_id}")
async def updatePaper(paper_id: int, paper: QuestionPaper, user=Depends(get_current_user)):
    existing = await db.client.table("QuestionPapers") \
        .select("id") \
        .eq("id", paper_id) \
        .eq("creator_id", user["id"]) \
        .execute()
    if not existing.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Paper not found.")

    exam_res = await db.client.table("Exams") \
        .select("id") \
        .eq("questionpaper_id", paper_id) \
        .limit(1) \
        .execute()
    if exam_res.data:
        raise HTTPException(status_code=HTTP_409_CONFLICT, detail="Paper is in use by an exam.")

    data = paper.model_dump(exclude={"id", "creator_id"})
    await db.client.table("QuestionPapers").update(data).eq("id", paper_id).execute()
    return {"msg": "Paper updated"}


@router.post("/paper/{paper_id}/clone", status_code=HTTP_201_CREATED)
async def clonePaper(paper_id: int, user=Depends(get_current_user)):
    original = await db.client.table("QuestionPapers") \
        .select("questions,answers") \
        .eq("id", paper_id) \
        .eq("creator_id", user["id"]) \
        .execute()
    if not original.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Paper not found.")

    src = original.data[0]
    questions = dict(src["questions"])
    meta = dict(questions.get("meta", {}))
    meta["exam_name"] = meta.get("exam_name", "Paper") + " (Copy)"
    questions["meta"] = meta

    result = await db.client.table("QuestionPapers").insert({
        "questions": questions,
        "answers": src["answers"],
        "creator_id": user["id"],
    }).execute()
    return {"msg": "Paper cloned", "id": result.data[0]["id"]}
