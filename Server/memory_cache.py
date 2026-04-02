from time import time
from asyncio import Lock
from typing import Any


_store: dict[str, tuple[float, Any]] = {}
_lock = Lock()


async def get_cache(key: str) -> Any | None:
    now = time()
    async with _lock:
        item = _store.get(key)
        if not item:
            return None
        expires_at, value = item
        if expires_at < now:
            _store.pop(key, None)
            return None
        return value


async def set_cache(key: str, value: Any, ttl_seconds: int) -> None:
    expires_at = time() + max(1, ttl_seconds)
    async with _lock:
        _store[key] = (expires_at, value)


async def delete_cache(key: str) -> None:
    async with _lock:
        _store.pop(key, None)
