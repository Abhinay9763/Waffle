from datetime import datetime, timezone, timedelta

from memory_cache import get_cache, set_cache
from supa import db

INVITE_SESSION_PREFIX = "invite:session"
INVITE_INDEX_PREFIX = "invite:index"
INVITE_RECORD_PREFIX = "invite:record"
INVITE_GRACE_SECONDS = 600


def _session_key(token: str) -> str:
    return f"{INVITE_SESSION_PREFIX}:{token}"


def _index_key(exam_id: int) -> str:
    return f"{INVITE_INDEX_PREFIX}:{exam_id}"


def _record_key(exam_id: int, roll: str) -> str:
    return f"{INVITE_RECORD_PREFIX}:{exam_id}:{(roll or '').strip().upper()}"


def _normalize_roll(roll: str) -> str:
    return (roll or "").strip().upper()


def _db_row_to_record(row: dict) -> dict:
    return {
        "exam_id": row.get("exam_id"),
        "student_roll": _normalize_roll(str(row.get("roll") or "")),
        "status": row.get("status") or "in_progress",
        "expiry_iso": row.get("expiry_iso") or "",
        "response": row.get("response") or {},
        "submitted_at": row.get("submitted_at"),
        "last_seen_at": row.get("last_seen_at"),
        "events": row.get("events") or [],
    }


async def _db_get_record(exam_id: int, roll: str) -> dict | None:
    try:
        res = await db.client.table("ResponseCache") \
            .select("exam_id,roll,status,expiry_iso,response,submitted_at,last_seen_at,events") \
            .eq("exam_id", exam_id) \
            .eq("roll", _normalize_roll(roll)) \
            .limit(1) \
            .execute()
    except Exception:
        return None

    if not res.data:
        return None
    return _db_row_to_record(res.data[0])


async def _db_list_records(exam_id: int) -> list[dict] | None:
    try:
        res = await db.client.table("ResponseCache") \
            .select("exam_id,roll,status,expiry_iso,response,submitted_at,last_seen_at,events") \
            .eq("exam_id", exam_id) \
            .execute()
    except Exception:
        return None

    return [_db_row_to_record(row) for row in (res.data or [])]


async def _db_upsert_record(record: dict) -> bool:
    try:
        payload = {
            "exam_id": int(record.get("exam_id") or 0),
            "roll": _normalize_roll(str(record.get("student_roll") or "")),
            "status": str(record.get("status") or "in_progress"),
            "expiry_iso": str(record.get("expiry_iso") or ""),
            "response": record.get("response") or {},
            "submitted_at": record.get("submitted_at"),
            "last_seen_at": record.get("last_seen_at"),
            "events": record.get("events") or [],
        }
        await db.client.table("ResponseCache").upsert(payload, on_conflict="exam_id,roll").execute()
        return True
    except Exception:
        return False


async def _db_finalize_records_after_end(exam_id: int, now_iso: str) -> bool:
    try:
        await db.client.table("ResponseCache") \
            .update({"status": "submitted", "submitted_at": now_iso}) \
            .eq("exam_id", exam_id) \
            .eq("status", "in_progress") \
            .execute()
        return True
    except Exception:
        return False


def expiry_for_exam(end_iso: str, grace_seconds: int = INVITE_GRACE_SECONDS) -> datetime:
    end = datetime.fromisoformat(str(end_iso).replace("Z", "+00:00"))
    return end + timedelta(seconds=max(1, int(grace_seconds)))


def ttl_from_expiry(expiry: datetime) -> int:
    now = datetime.now(timezone.utc)
    return max(1, int((expiry - now).total_seconds()))


def ttl_from_expiry_iso(expiry_iso: str) -> int:
    expiry = datetime.fromisoformat(str(expiry_iso).replace("Z", "+00:00"))
    return ttl_from_expiry(expiry)


async def set_invite_session(token: str, user: dict, expiry_iso: str) -> None:
    ttl = ttl_from_expiry_iso(expiry_iso)
    await set_cache(_session_key(token), {"expiry": expiry_iso, "user": user}, ttl)


async def get_invite_session(token: str) -> dict | None:
    return await get_cache(_session_key(token))


async def get_invite_record(exam_id: int, roll: str) -> dict | None:
    db_record = await _db_get_record(exam_id, roll)
    if db_record is not None:
        return db_record
    return await get_cache(_record_key(exam_id, roll))


async def list_invite_records(exam_id: int) -> list[dict]:
    db_rows = await _db_list_records(exam_id)
    if db_rows is not None:
        return db_rows

    rolls = await get_cache(_index_key(exam_id)) or []
    out: list[dict] = []
    live_rolls: list[str] = []
    for roll in rolls:
        rec = await get_cache(_record_key(exam_id, roll))
        if not rec:
            continue
        out.append(rec)
        live_rolls.append(str(roll).strip().upper())

    if live_rolls != rolls:
        # Keep index compact as records expire.
        await set_cache(_index_key(exam_id), live_rolls, 60)

    return out


async def upsert_invite_record(
    exam_id: int,
    roll: str,
    response: dict,
    status: str,
    expiry_iso: str,
    submitted_at: str | None = None,
    last_seen_at: str | None = None,
    append_events: list[dict] | None = None,
) -> dict:
    normalized_roll = _normalize_roll(roll)
    ttl = ttl_from_expiry_iso(expiry_iso)

    key = _record_key(exam_id, normalized_roll)
    existing = await get_cache(key) or {}
    events = list(existing.get("events") or [])
    if append_events:
        events.extend(append_events)
        events = events[-200:]

    record = {
        "exam_id": exam_id,
        "student_roll": normalized_roll,
        "status": status,
        "expiry_iso": expiry_iso,
        "response": response,
        "submitted_at": submitted_at,
        "last_seen_at": last_seen_at,
        "events": events,
    }

    await _db_upsert_record(record)
    await set_cache(key, record, ttl)

    idx_key = _index_key(exam_id)
    rolls = await get_cache(idx_key) or []
    if normalized_roll not in rolls:
        rolls.append(normalized_roll)
    await set_cache(idx_key, rolls, ttl)

    return record


async def finalize_invite_records_after_end(exam_id: int, fallback_ttl_seconds: int = INVITE_GRACE_SECONDS) -> int:
    now_iso = datetime.now(timezone.utc).isoformat()
    await _db_finalize_records_after_end(exam_id, now_iso)

    records = await list_invite_records(exam_id)
    changed = 0

    for rec in records:
        if rec.get("status") != "in_progress":
            continue
        roll = str(rec.get("student_roll") or "").strip().upper()
        if not roll:
            continue

        updated = {
            **rec,
            "status": "submitted",
            "submitted_at": rec.get("submitted_at") or now_iso,
            "last_seen_at": rec.get("last_seen_at") or now_iso,
        }
        expiry_iso = str(updated.get("expiry_iso") or "").strip()
        if expiry_iso:
            ttl = ttl_from_expiry_iso(expiry_iso)
        else:
            ttl = max(1, int(fallback_ttl_seconds))

        await _db_upsert_record(updated)
        await set_cache(_record_key(exam_id, roll), updated, ttl)
        changed += 1

    return changed
