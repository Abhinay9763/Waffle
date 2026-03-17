from datetime import datetime, timezone

from fastapi import Header, HTTPException
from starlette.status import HTTP_401_UNAUTHORIZED

from supa import db


async def get_current_user(x_session_token: str = Header()):
    response = await db.client.table("Sessions") \
        .select("expiry,Users(id,name,roll,role,approval_status)") \
        .eq("token", x_session_token) \
        .execute()

    if not response.data:
        raise HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Invalid session.",
        )

    expiry = datetime.fromisoformat(response.data[0]["expiry"])
    if expiry < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please sign in again.",
        )

    user = response.data[0]["Users"]

    # Check if user is approved (faculty need approval, others are auto-approved)
    if user.get("approval_status") == "pending":
        raise HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Your account is pending approval by the Head of Department.",
        )
    elif user.get("approval_status") == "rejected":
        raise HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Your account has been rejected. Please contact the Head of Department.",
        )

    return user
