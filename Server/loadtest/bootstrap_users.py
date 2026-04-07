import argparse
import csv
import json
import os
import re
from pathlib import Path

import httpx
from dotenv import load_dotenv
from itsdangerous import URLSafeTimedSerializer


def _load_rolls(dataset_path: Path) -> list[str]:
    if not dataset_path.exists():
        raise SystemExit(f"Dataset not found: {dataset_path}")

    with dataset_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    rolls: list[str] = []
    for row in data if isinstance(data, list) else []:
        if not isinstance(row, dict):
            continue
        roll = str(row.get("Roll", "")).strip()
        if not roll:
            continue
        # Keep only values that can safely become email local-part.
        if re.fullmatch(r"[A-Za-z0-9._-]+", roll):
            rolls.append(roll)
    # Preserve order, remove duplicates.
    seen: set[str] = set()
    unique: list[str] = []
    for roll in rolls:
        key = roll.upper()
        if key in seen:
            continue
        seen.add(key)
        unique.append(roll)
    return unique


def _activation_token(serializer: URLSafeTimedSerializer, email: str, password: str) -> str:
    payload = {
        "name": "",
        "email": email,
        "password": password,
        "roll": "",
        "role": "Student",
    }
    return serializer.dumps(json.dumps(payload), salt="email-auth")


def _activate_or_exists(client: httpx.Client, token: str) -> bool:
    res = client.get(f"/user/auth/{token}")
    return res.status_code in {201, 409}


def _can_login(client: httpx.Client, email: str, password: str) -> bool:
    res = client.post("/user/login", json={"email": email, "password": password})
    if not res.is_success:
        return False
    body = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
    return isinstance(body, dict) and bool(body.get("token"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap load-test student users through API (no direct DB edits).")
    parser.add_argument("--host", default=os.getenv("TARGET_HOST", "").strip(), help="Backend base URL, e.g. https://api.example.com")
    parser.add_argument("--count", type=int, default=int(os.getenv("BOOTSTRAP_USER_COUNT", "200")), help="Number of valid login users to generate")
    parser.add_argument("--password", default=os.getenv("BOOTSTRAP_PASSWORD", "ChangeMe123!"), help="Password to assign for created users")
    parser.add_argument("--out", default=os.getenv("USERS_CSV", "Server/loadtest/users.csv"), help="Output CSV path")
    parser.add_argument("--start", type=int, default=int(os.getenv("BOOTSTRAP_START_INDEX", "0")), help="Start index into dataset rolls")
    args = parser.parse_args()

    if not args.host:
        raise SystemExit("Missing --host (or TARGET_HOST in env)")

    root = Path(__file__).resolve().parents[1]
    load_dotenv(root / ".env")
    load_dotenv(Path(__file__).resolve().parent / ".env")

    secret_key = os.getenv("secret_key", "").strip()
    if not secret_key:
        raise SystemExit("Missing secret_key in env. Required to sign activation tokens.")

    domain = os.getenv("STUDENT_EMAIL_DOMAIN", "smec.ac.in").strip().lower()
    dataset_path = root / "datasets" / "NRPB.json"
    rolls = _load_rolls(dataset_path)
    if args.start < 0 or args.start >= len(rolls):
        raise SystemExit(f"--start out of range. Valid 0..{max(0, len(rolls)-1)}")

    serializer = URLSafeTimedSerializer(secret_key)
    collected: list[tuple[str, str]] = []
    stats = {
        "processed": 0,
        "activated_new": 0,
        "already_exists": 0,
        "activation_failed": 0,
        "login_verified": 0,
        "login_failed": 0,
    }

    host = args.host.rstrip("/")
    with httpx.Client(base_url=host, timeout=20.0) as client:
        for roll in rolls[args.start:]:
            if len(collected) >= args.count:
                break

            stats["processed"] += 1
            email = f"{roll.lower()}@{domain}"
            token = _activation_token(serializer, email=email, password=args.password)

            activation_res = client.get(f"/user/auth/{token}")
            if activation_res.status_code == 201:
                stats["activated_new"] += 1
            elif activation_res.status_code == 409:
                stats["already_exists"] += 1
            else:
                stats["activation_failed"] += 1
                continue

            if not _can_login(client, email, args.password):
                stats["login_failed"] += 1
                continue
            stats["login_verified"] += 1

            collected.append((email, args.password))
            if len(collected) % 25 == 0:
                print(f"Collected {len(collected)} users...")

    if len(collected) < args.count:
        raise SystemExit(f"Only {len(collected)} valid users could be prepared (requested {args.count}).")

    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = root.parent / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["email", "password"])
        writer.writerows(collected)

    print(f"Wrote {len(collected)} users to {out_path}")
    print("Bootstrap stats:")
    for key, value in stats.items():
        print(f"  - {key}: {value}")


if __name__ == "__main__":
    main()
