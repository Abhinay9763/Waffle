import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

LOADTEST_DIR = Path(__file__).resolve().parent
load_dotenv(LOADTEST_DIR / ".env")

host = os.getenv("TARGET_HOST", "").strip()
users = os.getenv("LOADTEST_USERS", "200").strip()
spawn_rate = os.getenv("SPAWN_RATE", "20").strip()
run_time = os.getenv("RUN_TIME", "20m").strip()

if not host:
    raise SystemExit("TARGET_HOST is empty. Set it in Server/loadtest/.env")

locustfile = str(LOADTEST_DIR / "locustfile.py")
cmd = [
    sys.executable,
    "-m",
    "locust",
    "-f",
    locustfile,
    "--host",
    host,
    "--users",
    users,
    "--spawn-rate",
    spawn_rate,
    "--run-time",
    run_time,
    "--headless",
]

print("Running:", " ".join(cmd))
subprocess.run(cmd, check=True)
