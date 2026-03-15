from datetime import datetime, timezone

from fastapi import Header, HTTPException
from starlette.status import HTTP_401_UNAUTHORIZED

from supa import db


async def get_current_user(x_session_token: str = Header()):
    response = await db.client.table("Sessions") \
        .select("expiry,Users(id,name,roll,role)") \
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

    return response.data[0]["Users"]
