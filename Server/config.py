import os

APP_NAME     = "Waffle"
BASE_URL     = os.getenv("BASE_URL",     "http://localhost:8000")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

SMTP_HOST    = "smtp.gmail.com"
SMTP_PORT    = 465
