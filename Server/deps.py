from datetime import datetime, timezone
import logging

from fastapi import Header, HTTPException
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_503_SERVICE_UNAVAILABLE

from memory_cache import get_cache, set_cache
from supa import db
from temp_invite_cache import get_invite_session

logger = logging.getLogger(__name__)

SESSION_CACHE_TTL_SECONDS = 30
INVALID_SESSION_CACHE_TTL_SECONDS = 5


def _cache_key_for_token(token: str) -> str:
    return f"auth:session:{token}"


def _to_unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail=detail)


def _validate_cached_or_db_payload(payload: dict) -> dict:
    expiry_raw = payload.get("expiry")
    if not isinstance(expiry_raw, str):
        raise _to_unauthorized("Invalid session.")

    try:
        expiry = datetime.fromisoformat(expiry_raw)
    except Exception:
        raise _to_unauthorized("Invalid session.")

    if expiry < datetime.now(timezone.utc):
        raise _to_unauthorized("Session expired. Please sign in again.")

    user = payload.get("user") if "user" in payload else payload.get("Users")
    if not isinstance(user, dict):
        raise _to_unauthorized("Invalid session.")

    if user.get("approval_status") == "pending":
        raise _to_unauthorized("Your account is pending approval by the Head of Department.")
    if user.get("approval_status") == "rejected":
        raise _to_unauthorized("Your account has been rejected. Please contact the Head of Department.")

    return user


async def get_current_user(x_session_token: str = Header()):
    invite_session = await get_invite_session(x_session_token)
    if isinstance(invite_session, dict):
        return _validate_cached_or_db_payload(invite_session)

    cache_key = _cache_key_for_token(x_session_token)

    cached = await get_cache(cache_key)
    if isinstance(cached, dict):
        if cached.get("invalid") is True:
            raise _to_unauthorized(str(cached.get("detail") or "Invalid session."))
        return _validate_cached_or_db_payload(cached)

    try:
        response = await db.client.table("Sessions") \
            .select("expiry,Users(id,name,roll,role,approval_status)") \
            .eq("token", x_session_token) \
            .execute()
    except Exception:
        logger.exception("Session lookup failed")
        raise HTTPException(
            status_code=HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication backend unavailable. Please retry.",
        )

    if not response.data:
        await set_cache(
            cache_key,
            {"invalid": True, "detail": "Invalid session."},
            INVALID_SESSION_CACHE_TTL_SECONDS,
        )
        raise _to_unauthorized("Invalid session.")

    row = response.data[0]
    try:
        user = _validate_cached_or_db_payload(row)
    except HTTPException as auth_error:
        await set_cache(
            cache_key,
            {"invalid": True, "detail": auth_error.detail},
            INVALID_SESSION_CACHE_TTL_SECONDS,
        )
        raise

    await set_cache(
        cache_key,
        {
            "expiry": row["expiry"],
            "user": user,
        },
        SESSION_CACHE_TTL_SECONDS,
    )
    return user
