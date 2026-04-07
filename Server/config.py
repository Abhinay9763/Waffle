import os

APP_NAME     = os.getenv("APP_NAME", "SMECS")
BASE_URL     = os.getenv("BASE_URL",     "http://localhost:8000")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
APP_LOGO_URL = os.getenv("APP_LOGO_URL", f"{FRONTEND_URL}/logo.png")
STUDENT_EMAIL_DOMAIN = os.getenv("STUDENT_EMAIL_DOMAIN", "smec.ac.in")

PAPER_DOCX_TEMPLATE_NAME = os.getenv("PAPER_DOCX_TEMPLATE_NAME", "Template.docx")
PAPER_XLSX_TEMPLATE_NAME = os.getenv("PAPER_XLSX_TEMPLATE_NAME", "question_paper_template.xlsx")
DOCX_TEMPLATE_ANCHOR_TEXT = os.getenv("DOCX_TEMPLATE_ANCHOR_TEXT", "www.smec.ac.in")

SMTP_HOST    = "smtp.gmail.com"
SMTP_PORT    = int(os.getenv("SMTP_PORT", "587"))
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").strip().lower() in {"1", "true", "yes", "on"}

GMAIL_API_CLIENT_ID = os.getenv("GMAIL_API_CLIENT_ID", "")
GMAIL_API_CLIENT_SECRET = os.getenv("GMAIL_API_CLIENT_SECRET", "")
GMAIL_API_REFRESH_TOKEN = os.getenv("GMAIL_API_REFRESH_TOKEN", "")
GMAIL_API_TOKEN_URI = os.getenv("GMAIL_API_TOKEN_URI", "https://oauth2.googleapis.com/token")
