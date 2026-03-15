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

from models import Register, Login, Role, Session
from supa import db
from utils import hashPassword, verifyPassword, serializer, send_auth_mail, createSessionToken
from deps import get_current_user

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
            if split[0].lower() != user.roll.lower() or split[1].lower() != "smec.ac.in":
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
    await db.client.table("Users").insert(user.model_dump()).execute()
    return {"msg": "created User"}


@router.get("/user/session", status_code=HTTP_200_OK)
async def getSession(user=Depends(get_current_user)):
    return {"msg": "User Authentication Successful!", "user": user}


@router.post("/user/login",status_code=HTTP_200_OK)
async def loginUser(user : Login):
    response = await db.client.table("Users").select("id,password").eq("email",user.email).execute()
    if not response.data:
        raise HTTPException(
            status_code=HTTP_404_NOT_FOUND,
            detail="User/Email does not exist"
        )

    if verifyPassword(user.password,response.data[0]["password"]):
        token = createSessionToken()
        session = Session(
            user_id=response.data[0]["id"],
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
    raise HTTPException(
        status_code=HTTP_401_UNAUTHORIZED,
        detail="Invalid password"
    )
