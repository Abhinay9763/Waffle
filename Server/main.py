import contextlib
import os
import smtplib
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from functools import lru_cache
from fastapi import FastAPI,background
from postgrest import APIError
from starlette.background import BackgroundTasks
from starlette.exceptions import HTTPException
from starlette.status import HTTP_409_CONFLICT, HTTP_202_ACCEPTED, HTTP_500_INTERNAL_SERVER_ERROR, HTTP_201_CREATED, \
    HTTP_400_BAD_REQUEST, HTTP_200_OK, HTTP_404_NOT_FOUND, HTTP_401_UNAUTHORIZED
from tenacity import retry

from models import Register
from supa import db
from utils import hashPassword, verifyPassword, serializer, send_auth_mail
from config import FRONTEND_URL, APP_NAME
from routes.exam import router as examRouter
from routes.auth import router as authRouter
from routes.paper import router as paperRouter
from routes.response import router as responseRouter

@contextlib.asynccontextmanager
async def apiStart(a : FastAPI):
    # await db.connect()
    await db.connect()
    print(db.client)
    yield
    # await db.disconnect()

app = FastAPI(lifespan=apiStart)
APP_STARTED_AT = datetime.now(timezone.utc)

from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "x-session-token"],
)

app.include_router(examRouter)
app.include_router(authRouter)
app.include_router(paperRouter)
app.include_router(responseRouter)


@lru_cache(maxsize=1)
def _resolve_commit_sha() -> str:
    env_commit = (
        os.getenv("GIT_COMMIT_SHA")
        or os.getenv("RENDER_GIT_COMMIT")
        or os.getenv("VERCEL_GIT_COMMIT_SHA")
        or os.getenv("COMMIT_SHA")
        or ""
    ).strip()
    if env_commit:
        return env_commit

    repo_root = Path(__file__).resolve().parents[1]
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_root,
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except Exception:
        return "unknown"

@app.get("/health-check")
async def home():
    now = datetime.now(timezone.utc)
    return {
        "status": "ok",
        "service": APP_NAME,
        "commit_sha": _resolve_commit_sha(),
        "timestamp_utc": now.isoformat(),
        "uptime_seconds": int((now - APP_STARTED_AT).total_seconds()),
        "checks": {
            "supabase_client_initialized": db.client is not None,
            "cors_frontend_url": FRONTEND_URL,
        },
    }
#
# @app.post("/user/register",status_code=HTTP_202_ACCEPTED)
# async def register(user : Register,background_tasks : BackgroundTasks):
#     print(user)
#     try:
#         # link = generateLink(user.email)
#         data = await db.findUserByEmail(user.email)
#         if data:
#             # print(verifyPassword(user.password,data[0]["password"]))
#             return HTTPException(
#                 status_code=HTTP_409_CONFLICT,
#                 detail="User With Same Email Already Exists"
#             )
#         background_tasks.add_task(send_auth_mail,user)
#         return {"msg" : "check your email for a verification link"}
#     except HTTPException as e:
#         raise
#     except Exception as e:
#         raise HTTPException(
#             status_code=HTTP_500_INTERNAL_SERVER_ERROR,
#             detail="Internal Server Error"
#         )
#
#
# @app.get("/user/auth/{token}",status_code=HTTP_201_CREATED)
# async def activateMail(token : str):
#     try:
#         user = Register.model_validate_json(serializer.loads(
#             token,
#             salt= "email-auth",
#             max_age= 10 * 60 #10 mins
#         ))
#
#         user.password = hashPassword(user.password)
#         response = await db.client.table("Users").upsert(user.model_dump()).execute()
#         return {"msg" : "created User"}
#         print(response)
#     except APIError as e:
#         print(e)
#         return HTTPException(
#             status_code=HTTP_409_CONFLICT,
#             detail="User With Email Already Exists"
#         )
#     except Exception as e:
#         raise HTTPException(
#             status_code=HTTP_400_BAD_REQUEST,
#             detail="Invalid or expired token"
#         )
#
# @app.post("/user/login",status_code=HTTP_200_OK)
# async def loginUser(user : Register):
#     response = await db.client.table("Users").select("*").eq("email",user.email).execute()
#     if not response.data:
#             status_code=HTTP_404_NOT_FOUND,
#             detail="User/Email does not exist"
#         )
#     if verifyPassword(user.password,response.data[0]["password"]):
#         return {"msg" : "User Authentication Successful!"}
#     raise HTTPException(
#         status_code=HTTP_401_UNAUTHORIZED,
#         detail="Invalid password"
#     )
#         raise HTTPException(


'''
STUFF ILL FORGET TO DO LATER ON:
- add a cleanup function: smartasses will bomb my DB with fake roll nums. have a cleanup that checks role 
and roll format. remove those that do not match : DONE
OR
let them be cus supabase is very generous with the space : NO BAD DESIGN NIGGER

'''