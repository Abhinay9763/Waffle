import os

APP_NAME     = "QuizForge"
BASE_URL     = os.getenv("BASE_URL",     "http://localhost:8000")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
STUDENT_EMAIL_DOMAIN = os.getenv("STUDENT_EMAIL_DOMAIN", "smec.ac.in")

PAPER_DOCX_TEMPLATE_NAME = os.getenv("PAPER_DOCX_TEMPLATE_NAME", "Template.docx")
PAPER_XLSX_TEMPLATE_NAME = os.getenv("PAPER_XLSX_TEMPLATE_NAME", "question_paper_template.xlsx")
DOCX_TEMPLATE_ANCHOR_TEXT = os.getenv("DOCX_TEMPLATE_ANCHOR_TEXT", "www.smec.ac.in")

SMTP_HOST    = "smtp.gmail.com"
SMTP_PORT    = 465
