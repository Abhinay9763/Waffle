from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from starlette.background import BackgroundTasks
from starlette.exceptions import HTTPException
from starlette.status import (
    HTTP_200_OK, HTTP_201_CREATED, HTTP_202_ACCEPTED,
    HTTP_400_BAD_REQUEST, HTTP_401_UNAUTHORIZED,
    HTTP_404_NOT_FOUND, HTTP_409_CONFLICT,
    HTTP_500_INTERNAL_SERVER_ERROR,
)

from models import Register, Login, Role, Session, ApprovalStatus
from supa import db
from utils import hashPassword, verifyPassword, serializer, send_auth_mail, createSessionToken
from deps import get_current_user
from config import STUDENT_EMAIL_DOMAIN

router = APIRouter()


@router.post("/user/register",status_code=HTTP_202_ACCEPTED)
async def register(user : Register,background_tasks : BackgroundTasks):
    print(user)
    try:
        # link = generateLink(user.email)
        if user.email.find("@") == -1: #WHY TF DOES THIS RETURN -1. JUST RETURN NONE BRO
            return {"malformed mail"}
        split = user.email.split("@")
        # print(split)
        # print(split.lower())
        # print(user.roll.lower())
        if  user.role == Role.student:
            if split[0].lower() != user.roll.lower() or split[1].lower() != STUDENT_EMAIL_DOMAIN:
                return {"please sign in with your college email id"}
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
        background_tasks.add_task(send_auth_mail,user)
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
