from datetime import datetime, timedelta, timezone
import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends
from starlette.background import BackgroundTasks
from starlette.exceptions import HTTPException
from starlette.status import (
    HTTP_200_OK, HTTP_201_CREATED, HTTP_202_ACCEPTED,
    HTTP_400_BAD_REQUEST, HTTP_401_UNAUTHORIZED,
    HTTP_404_NOT_FOUND, HTTP_409_CONFLICT,
    HTTP_500_INTERNAL_SERVER_ERROR,
)

from models import Register, Login, Role, Session, ApprovalStatus, ForgotPasswordRequest, ResetPasswordRequest, StudentPreviewRequest
from supa import db
from utils import hashPassword, verifyPassword, serializer, send_auth_mail_safe, send_password_reset_mail_safe, createSessionToken
from deps import get_current_user
from config import STUDENT_EMAIL_DOMAIN

router = APIRouter()

NRPB_DATASET_PATH = Path(__file__).resolve().parents[1] / "datasets" / "NRPB.json"


@lru_cache(maxsize=1)
def _load_nrpb_index() -> dict[str, dict]:
    if not NRPB_DATASET_PATH.exists():
        return {}
    try:
        with NRPB_DATASET_PATH.open("r", encoding="utf-8") as f:
            rows = json.load(f)
    except Exception:
        return {}

    index: dict[str, dict] = {}
    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            roll = str(row.get("Roll", "")).strip().upper()
            if roll:
                index[roll] = row
    return index


def _find_student_by_roll(roll: str) -> dict | None:
    key = (roll or "").strip().upper()
    if not key:
        return None
    return _load_nrpb_index().get(key)


def _derive_display_name_from_email(email: str) -> str:
    local = ((email or "").strip().split("@", 1)[0]).strip()
    if not local:
        return ""
    return local.replace(".", " ").replace("_", " ").replace("-", " ").strip().title()


def _derive_student_roll(email: str) -> str | None:
    raw = (email or "").strip().lower()
    if "@" not in raw:
        return None
    local, domain = raw.split("@", 1)
    if not local or domain != STUDENT_EMAIL_DOMAIN:
        return None
    return local


@router.post("/user/student-preview", status_code=HTTP_200_OK)
async def getStudentPreview(payload: StudentPreviewRequest):
    derived_roll = _derive_student_roll(payload.email)
    if not derived_roll:
        raise HTTPException(
            status_code=HTTP_400_BAD_REQUEST,
            detail=f"Students must use college email in format roll@{STUDENT_EMAIL_DOMAIN}."
        )

    student = _find_student_by_roll(derived_roll)
    if not student:
        raise HTTPException(
            status_code=HTTP_404_NOT_FOUND,
            detail="please enter correct roll number"
        )

    return {
        "student": {
            "Name": student.get("Name", ""),
            "Roll": student.get("Roll", ""),
            "Pic": student.get("Pic", ""),
            "Branch": student.get("Branch", ""),
        }
    }


@router.post("/user/register",status_code=HTTP_202_ACCEPTED)
async def register(user : Register,background_tasks : BackgroundTasks):
    print(user)
    try:
        if user.role == Role.student:
            derived_roll = _derive_student_roll(user.email)
            if not derived_roll:
                raise HTTPException(
                    status_code=HTTP_400_BAD_REQUEST,
                    detail=f"Students must register with college email (roll@{STUDENT_EMAIL_DOMAIN})."
                )
            user.roll = derived_roll
            student = _find_student_by_roll(user.roll)
            if not student:
                raise HTTPException(
                    status_code=HTTP_400_BAD_REQUEST,
                    detail="please enter correct roll number"
                )
            user.name = str(student.get("Name", "")).strip() or user.name
            user.roll = str(student.get("Roll", user.roll)).strip() or user.roll
        else:
            if not user.roll.strip() or not user.name.strip():
                raise HTTPException(
                    status_code=HTTP_400_BAD_REQUEST,
                    detail="Faculty registration requires full name and employee ID."
                )
        response = await db.client.table("Users").select("*").or_(f"email.eq.{user.email},roll.eq.{user.roll}").execute()
        # print(response)
        if response.data:
            print(response.data[0])
            # print(data[0])
            # print(data[0])
            # print(verifyPassword(user.password,data[0]["password"]))
            return HTTPException(
                status_code=HTTP_409_CONFLICT,
                detail="User With Same Email or Roll Number Already Exists"
            )
        background_tasks.add_task(send_auth_mail_safe, user)
        return {"msg" : "check your email for a verification link"}
    except HTTPException as e:
        raise e
    except Exception as e:
        print(e)
        raise HTTPException(
            status_code=HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )




@router.get("/user/auth/{token}",status_code=HTTP_201_CREATED)
async def activateMail(token : str):
    try:
        user = Register.model_validate_json(serializer.loads(
            token,
            salt= "email-auth",
            max_age= 10 * 60
        ))
    except Exception:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="Invalid or expired token.")

    existing = await db.client.table("Users").select("id").eq("email", user.email).execute()
    if existing.data:
        raise HTTPException(status_code=HTTP_409_CONFLICT, detail="Account already activated.")

    if user.role == Role.student:
        derived_roll = _derive_student_roll(user.email)
        if not derived_roll:
            raise HTTPException(
                status_code=HTTP_400_BAD_REQUEST,
                detail=f"Students must register with college email (roll@{STUDENT_EMAIL_DOMAIN})."
            )
        student = _find_student_by_roll(derived_roll)
        if not student:
            raise HTTPException(
                status_code=HTTP_400_BAD_REQUEST,
                detail="please enter correct roll number"
            )
        user.roll = str(student.get("Roll", derived_roll)).strip() or derived_roll
        user.name = str(student.get("Name", "")).strip() or user.name
    else:
        if not user.roll.strip() or not user.name.strip():
            raise HTTPException(
                status_code=HTTP_400_BAD_REQUEST,
                detail="Faculty registration requires full name and employee ID."
            )

    user.password = hashPassword(user.password)

    # Set approval status based on role
    user_data = user.model_dump()
    if user.role == Role.faculty:
        user_data["approval_status"] = ApprovalStatus.pending
    else:
        # Students, Admin, HOD are auto-approved
        user_data["approval_status"] = ApprovalStatus.approved

    await db.client.table("Users").insert(user_data).execute()
    return {
        "msg": "created User",
        "role": user.role.value if user.role else None,
        "approval_status": user_data["approval_status"]
    }


@router.get("/user/session", status_code=HTTP_200_OK)
async def getSession(user=Depends(get_current_user)):
    return {"msg": "User Authentication Successful!", "user": user}


@router.post("/user/login",status_code=HTTP_200_OK)
async def loginUser(user : Login):
    response = await db.client.table("Users").select("id,password,role,approval_status").eq("email",user.email).execute()
    if not response.data:
        raise HTTPException(
            status_code=HTTP_404_NOT_FOUND,
            detail="User/Email does not exist"
        )

    user_data = response.data[0]
    if not verifyPassword(user.password, user_data["password"]):
        raise HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Invalid password"
        )

    # Check approval status for faculty
    if user_data.get("approval_status") == "pending":
        raise HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Your account is pending approval by the Head of Department."
        )
    elif user_data.get("approval_status") == "rejected":
        raise HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Your account has been rejected. Please contact the Head of Department."
        )

    token = createSessionToken()
    session = Session(
        user_id=user_data["id"],
        expiry=datetime.now(timezone.utc) + timedelta(days=30),
        token= token,
        ).model_dump()
    session["expiry"] = session["expiry"].isoformat()
    res = await db.client.table("Sessions").upsert(session,on_conflict="user_id").execute()
    if res.data:
        return {"msg" : "User Authentication Successful!","token" : token}
    raise HTTPException(
        status_code=HTTP_500_INTERNAL_SERVER_ERROR,
        detail="session creation failed"
    )


@router.post("/user/forgot-password", status_code=HTTP_200_OK)
async def forgotPassword(payload: ForgotPasswordRequest, background_tasks: BackgroundTasks):
    email = payload.email.strip().lower()

    user_res = await db.client.table("Users").select("id").eq("email", email).limit(1).execute()
    if user_res.data:
        background_tasks.add_task(send_password_reset_mail_safe, email)

    # Always return the same message to avoid user enumeration.
    return {"msg": "If that email exists, a password reset link has been sent."}


@router.post("/user/reset-password/{token}", status_code=HTTP_200_OK)
async def resetPassword(token: str, payload: ResetPasswordRequest):
    try:
        data = serializer.loads(token, salt="password-reset", max_age=15 * 60)
    except Exception:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="Invalid or expired reset link.")

    email = str(data.get("email", "")).strip().lower()
    if not email:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="Invalid reset token payload.")

    user_res = await db.client.table("Users").select("id").eq("email", email).limit(1).execute()
    if not user_res.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="User not found.")

    await db.client.table("Users").update({"password": hashPassword(payload.password)}).eq("email", email).execute()
    return {"msg": "Password reset successful."}


# HOD-specific routes
@router.get("/hod/pending-faculty")
async def getPendingFaculty(user=Depends(get_current_user)):
    if user["role"] != "HOD":
        raise HTTPException(status_code=403, detail="Only HOD can access this resource")

    response = await db.client.table("Users").select("id,name,email,role,created_at").eq("role", "Faculty").eq("approval_status", "pending").execute()
    return {"pending_faculty": response.data}


@router.get("/hod/faculty")
async def listApprovedFaculty(user=Depends(get_current_user)):
    if user["role"] != "HOD":
        raise HTTPException(status_code=403, detail="Only HOD can access this resource")

    response = await db.client.table("Users") \
        .select("id,name,email,roll,role,created_at,approval_status") \
        .eq("role", "Faculty") \
        .eq("approval_status", "approved") \
        .order("created_at", desc=True) \
        .execute()
    return {"faculty": response.data}


@router.post("/hod/approve-faculty/{user_id}")
async def approveFaculty(user_id: int, user=Depends(get_current_user)):
    if user["role"] != "HOD":
        raise HTTPException(status_code=403, detail="Only HOD can perform this action")

    # Check if user exists and is faculty
    faculty_res = await db.client.table("Users").select("id,role").eq("id", user_id).eq("role", "Faculty").execute()
    if not faculty_res.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Faculty member not found")

    # Update approval status
    await db.client.table("Users").update({"approval_status": "approved"}).eq("id", user_id).execute()
    return {"msg": "Faculty approved successfully"}


@router.post("/hod/reject-faculty/{user_id}")
async def rejectFaculty(user_id: int, user=Depends(get_current_user)):
    if user["role"] != "HOD":
        raise HTTPException(status_code=403, detail="Only HOD can perform this action")

    # Check if user exists and is faculty
    faculty_res = await db.client.table("Users").select("id,role").eq("id", user_id).eq("role", "Faculty").execute()
    if not faculty_res.data:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Faculty member not found")

    # Update approval status
    await db.client.table("Users").update({"approval_status": "rejected"}).eq("id", user_id).execute()
    return {"msg": "Faculty rejected"}
