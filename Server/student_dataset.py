import json
import os
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def resolve_nrpb_dataset_path() -> Path | None:
    env_path = (os.getenv("NRPB_DATASET_PATH") or "").strip()
    candidates = []
    if env_path:
        candidates.append(Path(env_path))

    candidates.extend([
        Path("/etc/secrets/NRPB.json"),
        Path(__file__).resolve().parent / "datasets" / "NRPB.json",
    ])

    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


@lru_cache(maxsize=1)
def load_nrpb_index() -> dict[str, dict]:
    dataset_path = resolve_nrpb_dataset_path()
    if dataset_path is None:
        return {}
    try:
        with dataset_path.open("r", encoding="utf-8") as f:
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


def find_student_by_roll(roll: str) -> dict | None:
    key = (roll or "").strip().upper()
    if not key:
        return None
    return load_nrpb_index().get(key)


def student_public_profile(roll: str) -> dict | None:
    student = find_student_by_roll(roll)
    if not student:
        return None
    return {
        "Name": student.get("Name", ""),
        "Roll": student.get("Roll", ""),
        "Pic": student.get("Pic", ""),
        "Branch": student.get("Branch", ""),
    }
