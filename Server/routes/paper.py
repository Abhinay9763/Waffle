from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from starlette.status import HTTP_201_CREATED, HTTP_404_NOT_FOUND, HTTP_409_CONFLICT
import httpx
from io import BytesIO

from deps import get_current_user
from models import QuestionPaper
from supa import db, db_url
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH

router = APIRouter()


def collect_image_urls(questions_dict: dict) -> set[str]:
    """Extract every image_url from a questions JSON blob."""
    urls: set[str] = set()
    for section in questions_dict.get("sections", []):
        for q in section.get("questions", []):
            if q.get("image_url"):
                urls.add(q["image_url"])
            for opt in q.get("options", []):
                if isinstance(opt, dict) and opt.get("image_url"):
                    urls.add(opt["image_url"])
    return urls


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

    paper_ids = [p["id"] for p in response.data]
    in_use_ids: set[int] = set()
    if paper_ids:
        exam_res = await db.client.table("Exams") \
            .select("questionpaper_id") \
            .in_("questionpaper_id", paper_ids) \
            .execute()
        in_use_ids = {row["questionpaper_id"] for row in exam_res.data}

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
            "in_use": p["id"] in in_use_ids,
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
        .select("id,questions") \
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

    # Delete images that were removed in this update
    old_urls = collect_image_urls(existing.data[0].get("questions") or {})
    new_urls = collect_image_urls(paper.questions)
    orphaned = old_urls - new_urls
    if orphaned:
        keys = [url.split("/question-images/", 1)[-1] for url in orphaned]
        try:
            await db.client.storage.from_("question-images").remove(keys)
        except Exception:
            pass  # tf should i do

    data = paper.model_dump(exclude={"id", "creator_id"})
    await db.client.table("QuestionPapers").update(data).eq("id", paper_id).execute()
    return {"msg": "Paper updated"}


@router.delete("/paper/{paper_id}")
async def deletePaper(paper_id: int, user=Depends(get_current_user)):
    existing = await (db.client.table("QuestionPapers").select("id,questions").eq("id", paper_id).eq("creator_id", user["id"])
                      .execute())
    if not existing.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Paper not found.")

    exam_res = await db.client.table("Exams").select("id").eq("questionpaper_id", paper_id).limit(1).execute()
    if exam_res.data:
        raise HTTPException(status_code=HTTP_409_CONFLICT, detail="Paper is in use by an exam and cannot be deleted.")

    # Delete all images belonging to this paper
    image_urls = collect_image_urls(existing.data[0].get("questions") or {})
    if image_urls:
        keys = [url.split("/question-images/", 1)[-1] for url in image_urls]
        try:
            await db.client.storage.from_("question-images").remove(keys)
        except Exception:
            pass  # just catch and pass. wtf am i supposed to do here

    await db.client.table("QuestionPapers").delete().eq("id", paper_id).execute()
    return {"msg": "Paper deleted"}


@router.post("/paper/{paper_id}/clone", status_code=HTTP_201_CREATED)
async def clonePaper(paper_id: int, user=Depends(get_current_user)):
    original = await (db.client.table("QuestionPapers").select("questions,answers").eq("id", paper_id).eq("creator_id", user["id"])
                      .execute())
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


ALLOWED_IMAGE_TYPES = {"png", "jpg", "jpeg", "gif", "webp"}
QUESTION_IMAGE_WIDTH = 1  # inches
OPTION_IMAGE_WIDTH = 1   # inches

@router.post("/paper/upload-image")
async def uploadImage(file: UploadFile = File(...), user=Depends(get_current_user)):
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid image type. Allowed: png, jpg, jpeg, gif, webp.")
    key = f"{uuid4()}.{ext}"
    data = await file.read()
    await db.client.storage.from_("question-images").upload(key, data, {"content-type": file.content_type})
    url = f"{db_url}/storage/v1/object/public/question-images/{key}"
    return {"url": url}


@router.get("/paper/{paper_id}/download")
async def downloadPaperDoc(paper_id: int, user=Depends(get_current_user)):
    """Generate and download a Word document for the question paper with embedded images."""
    # Get the paper
    paper_res = await db.client.table("QuestionPapers") \
        .select("*") \
        .eq("id", paper_id) \
        .eq("creator_id", user["id"]) \
        .execute()

    if not paper_res.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Paper not found.")

    paper_data = paper_res.data[0]
    questions_data = paper_data.get("questions") or {}
    sections = questions_data.get("sections", [])
    meta = questions_data.get("meta", {})
    paper_name = meta.get("exam_name") or f"Paper #{paper_id}"

    # Create Word document
    doc = Document()
    qnum = 0

    # Add title
    title = doc.add_paragraph()
    title_run = title.add_run(paper_name)
    title_run.font.size = Pt(16)
    title_run.font.bold = True
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    doc.add_paragraph()  # spacing

    # Fetch images in parallel for better performance
    async with httpx.AsyncClient(timeout=10) as client:
        image_cache = {}

        for section in sections:
            # Add section title if multiple sections
            if len(sections) > 1:
                section_para = doc.add_paragraph()
                section_run = section_para.add_run(section.get("name", "Section"))
                section_run.font.bold = True
                section_run.font.size = Pt(13)

            for q in section.get("questions", []):
                qnum += 1

                # Question text
                q_para = doc.add_paragraph()
                q_run = q_para.add_run(f"Q{qnum}. {q.get('text', '')}")
                q_run.font.bold = True

                # Question image
                if q.get("image_url"):
                    try:
                        if q["image_url"] not in image_cache:
                            resp = await client.get(q["image_url"])
                            if resp.status_code == 200:
                                image_cache[q["image_url"]] = resp.content

                        if q["image_url"] in image_cache:
                            img_bytes = BytesIO(image_cache[q["image_url"]])
                            doc.add_picture(img_bytes, width=Inches(QUESTION_IMAGE_WIDTH))
                    except Exception:
                        pass  # Skip images that fail to download

                # Options
                letters = ["A", "B", "C", "D"]
                for i, opt in enumerate(q.get("options", [])):
                    # Handle both string and OptionValue formats
                    opt_text = opt if isinstance(opt, str) else opt.get("text", "")
                    opt_image_url = None if isinstance(opt, str) else opt.get("image_url")

                    # Option text
                    opt_para = doc.add_paragraph(f"{letters[i]})  {opt_text}")
                    opt_para.paragraph_format.left_indent = Inches(0.3)

                    # Option image
                    if opt_image_url:
                        try:
                            if opt_image_url not in image_cache:
                                resp = await client.get(opt_image_url)
                                if resp.status_code == 200:
                                    image_cache[opt_image_url] = resp.content

                            if opt_image_url in image_cache:
                                img_bytes = BytesIO(image_cache[opt_image_url])
                                doc.add_picture(img_bytes, width=Inches(OPTION_IMAGE_WIDTH))
                        except Exception:
                            pass  # Skip images that fail to download

    # Write to BytesIO
    output = BytesIO()
    doc.save(output)
    output.seek(0)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename={paper_name}.docx"}
    )
