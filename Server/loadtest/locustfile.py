import csv
import os
import random
import threading
import time
from typing import Any
from pathlib import Path

from locust import HttpUser, between, events, task
from locust.exception import StopUser
from dotenv import load_dotenv

LOADTEST_DIR = Path(__file__).resolve().parent
load_dotenv(LOADTEST_DIR / ".env")

_USERS: list[dict[str, str]] = []
_USERS_LOCK = threading.Lock()
_USER_CURSOR = 0

EXAM_IDS = [int(x.strip()) for x in os.getenv("EXAM_IDS", "").split(",") if x.strip()]
USERS_CSV = os.getenv("USERS_CSV", "Server/loadtest/users.csv")
TARGET_HOST = os.getenv("TARGET_HOST", "").strip()
HEARTBEAT_SECONDS = max(1, int(os.getenv("HEARTBEAT_SECONDS", "30")))
FULL_SNAPSHOT_EVERY = max(1, int(os.getenv("FULL_SNAPSHOT_EVERY", "3")))
SUBMIT_AFTER_HEARTBEATS = max(1, int(os.getenv("SUBMIT_AFTER_HEARTBEATS", "8")))
REQUEST_TIMEOUT_SECONDS = max(1.0, float(os.getenv("REQUEST_TIMEOUT_SECONDS", "20")))


def _resolve_users_csv(path: str) -> Path:
    candidate = Path(path)
    if candidate.is_absolute():
        return candidate

    # First: relative to current working directory
    cwd_path = Path.cwd() / candidate
    if cwd_path.exists():
        return cwd_path

    # Fallback: relative to repo root (parent of Server/loadtest)
    repo_root = LOADTEST_DIR.parent.parent
    return repo_root / candidate


def _load_users(path: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    resolved = _resolve_users_csv(path)
    with resolved.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            email = (row.get("email") or "").strip()
            password = (row.get("password") or "").strip()
            if not email or not password:
                continue
            rows.append({"email": email, "password": password})
    return rows


@events.test_start.add_listener
def _on_test_start(environment, **kwargs):
    global _USERS
    _USERS = _load_users(USERS_CSV)
    if not _USERS:
        resolved = _resolve_users_csv(USERS_CSV)
        raise RuntimeError(f"No credentials found in {resolved}. Add email,password rows.")


class ExamUser(HttpUser):
    wait_time = between(1.0, 3.0)
    host = TARGET_HOST or None

    token: str
    email: str
    password: str
    exam_id: int | None
    user_index: int
    submitted: bool
    heartbeat_count: int
    last_heartbeat_at: float
    question_bank: list[dict[str, Any]]
    responses: dict[int, dict[str, Any]]

    def _headers(self) -> dict[str, str]:
        return {
            "x-session-token": self.token,
            "Content-Type": "application/json",
        }

    def _pick_user(self) -> dict[str, str]:
        global _USER_CURSOR
        if not _USERS:
            raise StopUser("No load-test users available. Check USERS_CSV path and file content.")
        with _USERS_LOCK:
            idx = _USER_CURSOR % len(_USERS)
            _USER_CURSOR += 1
        self.user_index = idx
        return _USERS[idx]

    def _login(self) -> None:
        with self.client.post(
            "/user/login",
            json={"email": self.email, "password": self.password},
            name="POST /user/login",
            catch_response=True,
            timeout=REQUEST_TIMEOUT_SECONDS,
        ) as res:
            if not res.ok:
                res.failure(f"login failed: {res.status_code} {res.text[:120]}")
                raise StopUser()
            data = res.json()
            token = data.get("token")
            if not token:
                res.failure("login response missing token")
                raise StopUser()
            self.token = token
            res.success()

    def _check_session(self) -> None:
        with self.client.get(
            "/user/session",
            headers={"x-session-token": self.token},
            name="GET /user/session",
            catch_response=True,
            timeout=REQUEST_TIMEOUT_SECONDS,
        ) as res:
            if not res.ok:
                res.failure(f"session failed: {res.status_code}")
                raise StopUser()
            res.success()

    def _pick_exam(self) -> int:
        if EXAM_IDS:
            return EXAM_IDS[self.user_index % len(EXAM_IDS)]

        with self.client.get(
            "/exam/available",
            headers={"x-session-token": self.token},
            name="GET /exam/available",
            catch_response=True,
            timeout=REQUEST_TIMEOUT_SECONDS,
        ) as res:
            if not res.ok:
                res.failure(f"available exams failed: {res.status_code}")
                raise StopUser()
            payload = res.json()
            exams = payload.get("exams") or []
            if not exams:
                res.failure("no available exams")
                raise StopUser()
            res.success()
        return int(exams[self.user_index % len(exams)]["id"])

    def _take_exam(self) -> None:
        with self.client.get(
            f"/exam/{self.exam_id}/take",
            headers={"x-session-token": self.token},
            name="GET /exam/{id}/take",
            catch_response=True,
            timeout=REQUEST_TIMEOUT_SECONDS,
        ) as res:
            if not res.ok:
                res.failure(f"take exam failed: {res.status_code} {res.text[:140]}")
                raise StopUser()
            payload = res.json()
            sections = payload.get("sections") or []
            questions: list[dict[str, Any]] = []
            for section in sections:
                for q in section.get("questions", []):
                    qid = q.get("question_id")
                    options = q.get("options") or []
                    if isinstance(qid, int) and len(options) > 0:
                        questions.append({"question_id": qid, "option_count": len(options)})
            if not questions:
                res.failure("exam has no answerable questions")
                raise StopUser()
            self.question_bank = questions
            self.responses = {
                q["question_id"]: {"question_id": q["question_id"], "option": None, "marked": False}
                for q in questions
            }
            res.success()

    def _student_roll_guess(self) -> str:
        local = self.email.split("@", 1)[0].strip()
        return local

    def _touch_one_answer(self) -> dict[str, Any]:
        q = random.choice(self.question_bank)
        qid = q["question_id"]
        current = self.responses[qid]
        if random.random() < 0.12:
            current["option"] = None
        else:
            current["option"] = random.randint(0, q["option_count"] - 1)
        if random.random() < 0.08:
            current["marked"] = not bool(current["marked"])
        self.responses[qid] = current
        return current

    def _submit(self) -> None:
        if self.submitted:
            return
        if not self.token:
            return
        if self.exam_id is None:
            return
        if not self.responses:
            return
        payload = {
            "exam_id": self.exam_id,
            "response": {
                "student_roll": self._student_roll_guess(),
                "responses": list(self.responses.values()),
            },
        }
        with self.client.post(
            "/response/submit",
            headers=self._headers(),
            json=payload,
            name="POST /response/submit",
            catch_response=True,
            timeout=REQUEST_TIMEOUT_SECONDS,
        ) as res:
            if not res.ok:
                res.failure(f"submit failed: {res.status_code} {res.text[:120]}")
                return
            self.submitted = True
            res.success()

    def on_start(self) -> None:
        picked = self._pick_user()
        self.email = picked["email"]
        self.password = picked["password"]

        self.token = ""
        self.exam_id = None
        self.submitted = False
        self.heartbeat_count = 0
        self.last_heartbeat_at = 0.0
        self.question_bank = []
        self.responses = {}

        self._login()
        self._check_session()
        self.exam_id = self._pick_exam()
        self._take_exam()

    @task(8)
    def heartbeat(self) -> None:
        if self.submitted:
            return
        now = time.time()
        if now - self.last_heartbeat_at < HEARTBEAT_SECONDS:
            return

        changed = self._touch_one_answer()
        self.heartbeat_count += 1

        body: dict[str, Any] = {
            "exam_id": self.exam_id,
            "events": [],
            "warning_count": 0,
        }

        if self.heartbeat_count % FULL_SNAPSHOT_EVERY == 0:
            body["response"] = {
                "student_roll": self._student_roll_guess(),
                "responses": list(self.responses.values()),
            }
        else:
            body["response_delta"] = [changed]

        with self.client.post(
            "/response/heartbeat",
            headers=self._headers(),
            json=body,
            name="POST /response/heartbeat",
            catch_response=True,
            timeout=REQUEST_TIMEOUT_SECONDS,
        ) as res:
            if res.ok:
                self.last_heartbeat_at = now
                res.success()
            else:
                res.failure(f"heartbeat failed: {res.status_code} {res.text[:120]}")

    @task(1)
    def maybe_submit(self) -> None:
        if self.submitted:
            return
        if self.heartbeat_count < SUBMIT_AFTER_HEARTBEATS:
            return
        if random.random() < 0.35:
            self._submit()

    def on_stop(self) -> None:
        if not self.submitted:
            self._submit()
