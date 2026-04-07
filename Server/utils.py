import os
import smtplib
import uuid
import logging
import base64
from time import monotonic
from threading import Lock
from email.message import EmailMessage
from functools import lru_cache

import bcrypt
import secrets
from dotenv import load_dotenv
from itsdangerous import URLSafeTimedSerializer
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from models import Register
from config import (
    APP_NAME,
    APP_LOGO_URL,
    FRONTEND_URL,
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USE_TLS,
    GMAIL_API_CLIENT_ID,
    GMAIL_API_CLIENT_SECRET,
    GMAIL_API_REFRESH_TOKEN,
    GMAIL_API_TOKEN_URI,
)

load_dotenv()
secret_key = os.getenv("secret_key")

mail_user = os.getenv("gmail_user")
mail_pass = os.getenv("gmail_pass")

serializer = URLSafeTimedSerializer(secret_key)
logger = logging.getLogger(__name__)

EMAIL_SEND_WINDOW_SECONDS = 180
_email_send_cache: dict[str, float] = {}
_email_send_cache_lock = Lock()


def should_allow_email_send(email: str, window_seconds: int = EMAIL_SEND_WINDOW_SECONDS) -> bool:
    normalized_email = (email or "").strip().lower()
    if not normalized_email:
        return False

    now = monotonic()
    expiry = now + max(1, int(window_seconds))

    with _email_send_cache_lock:
        expired_keys = [k for k, v in _email_send_cache.items() if v <= now]
        for key in expired_keys:
            _email_send_cache.pop(key, None)

        existing_expiry = _email_send_cache.get(normalized_email)
        if existing_expiry and existing_expiry > now:
            return False

        _email_send_cache[normalized_email] = expiry
        return True


def _can_use_gmail_api() -> bool:
    return all([
        GMAIL_API_CLIENT_ID,
        GMAIL_API_CLIENT_SECRET,
        GMAIL_API_REFRESH_TOKEN,
        mail_user,
    ])


@lru_cache(maxsize=1)
def _get_gmail_service():
    creds = Credentials(
        token=None,
        refresh_token=GMAIL_API_REFRESH_TOKEN,
        token_uri=GMAIL_API_TOKEN_URI,
        client_id=GMAIL_API_CLIENT_ID,
        client_secret=GMAIL_API_CLIENT_SECRET,
        scopes=["https://www.googleapis.com/auth/gmail.send"],
    )
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _send_mail_via_gmail_api(msg: EmailMessage) -> None:
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
    service = _get_gmail_service()
    service.users().messages().send(userId="me", body={"raw": raw}).execute()


def _send_mail(to_email: str, subject: str, text_body: str, html_body: str) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = mail_user
    msg["To"] = to_email
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")

    # Prefer Gmail API in hosted environments where SMTP egress may be blocked.
    if _can_use_gmail_api():
        try:
            _send_mail_via_gmail_api(msg)
            return
        except HttpError:
            logger.exception("Gmail API delivery failed to %s", to_email)
            raise RuntimeError("Mail delivery failed via Gmail API")
        except Exception:
            logger.exception("Unexpected Gmail API failure for %s", to_email)
            raise RuntimeError("Mail delivery failed via Gmail API")

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
            server.ehlo()
            if SMTP_USE_TLS:
                server.starttls()
                server.ehlo()
            server.login(mail_user, mail_pass)
            server.send_message(msg)
    except (smtplib.SMTPException, OSError) as exc:
        logger.exception("Mail delivery failed to %s via %s:%s", to_email, SMTP_HOST, SMTP_PORT)
        raise RuntimeError("Mail delivery failed") from exc


def _button_html(link: str, label: str) -> str:
        return (
                f"<a href=\"{link}\" "
                "style=\"display:inline-block;padding:12px 20px;border-radius:10px;"
                "background:#facc15;color:#111827;text-decoration:none;font-weight:700;\">"
                f"{label}</a>"
        )


def _mail_shell(title: str, subtitle: str, cta_html: str, note: str, fallback_url: str) -> str:
    logo_block = (
        f"<img src=\"{APP_LOGO_URL}\" alt=\"{APP_NAME} logo\" "
        "style=\"display:block;height:44px;max-width:220px;object-fit:contain;margin:0 0 10px 0;\"/>"
        if APP_LOGO_URL else
        ""
    )
    return f"""
<!doctype html>
<html>
    <body style=\"margin:0;padding:0;background:#09090b;font-family:Segoe UI,Arial,sans-serif;color:#e4e4e7;\">
        <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"padding:24px 0;\">
            <tr>
                <td align=\"center\">
                    <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;width:100%;background:#18181b;border:1px solid #3f3f46;border-radius:16px;overflow:hidden;\">
                        <tr>
                            <td style=\"padding:24px 24px 8px 24px;\">
                                {logo_block}
                                <p style=\"margin:0 0 6px 0;font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:#facc15;\">{APP_NAME}</p>
                                <h1 style=\"margin:0;font-size:24px;line-height:1.3;color:#fafafa;\">{title}</h1>
                            </td>
                        </tr>
                        <tr>
                            <td style=\"padding:0 24px 8px 24px;\">
                                <p style=\"margin:0;font-size:14px;line-height:1.6;color:#d4d4d8;\">{subtitle}</p>
                            </td>
                        </tr>
                        <tr>
                            <td style=\"padding:16px 24px 8px 24px;\">{cta_html}</td>
                        </tr>
                        <tr>
                            <td style=\"padding:8px 24px 0 24px;\">
                                <p style=\"margin:0;font-size:12px;line-height:1.6;color:#a1a1aa;\">{note}</p>
                            </td>
                        </tr>
                        <tr>
                            <td style=\"padding:18px 24px 24px 24px;\">
                                <p style=\"margin:0;font-size:11px;line-height:1.7;color:#71717a;\">
                                    If the button does not work, copy and paste this URL in your browser:<br/>
                                    <span style=\"word-break:break-all;color:#a1a1aa;\">{fallback_url}</span>
                                </p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
</html>
"""

# def generateLink(email : str):
#     return "http://localhost:8000/user/auth/" + serializer.dumps(email,salt="email-auth")

def send_auth_mail(user : Register):
    link = FRONTEND_URL + "/users/auth/" + serializer.dumps(user.model_dump_json(),salt="email-auth")
    subject = f"{APP_NAME} Account Activation"
    text = (
        f"Welcome to {APP_NAME}.\n\n"
        "Please verify your account using the link below:\n"
        f"{link}\n\n"
        "This link expires in 10 minutes."
    )
    html = _mail_shell(
        title="Verify your account",
        subtitle="Welcome aboard. Confirm your email to activate your account and continue.",
        cta_html=_button_html(link, "Verify account"),
        note="This verification link expires in 10 minutes.",
        fallback_url=link,
    )
    _send_mail(user.email, subject, text, html)


def send_auth_mail_safe(user: Register) -> None:
    try:
        send_auth_mail(user)
    except Exception:
        logger.exception("Activation mail background task failed for %s", user.email)


def send_password_reset_mail(email: str):
    token = serializer.dumps({"email": email}, salt="password-reset")
    link = FRONTEND_URL + f"/reset-password/{token}"

    subject = f"{APP_NAME} Password Reset"
    text = (
        "We received a request to reset your password.\n\n"
        f"Reset your password using the link below:\n{link}\n\n"
        "This link expires in 15 minutes. If you did not request this, you can ignore this email."
    )
    html = _mail_shell(
        title="Reset your password",
        subtitle="A password reset was requested for your account. Use the button below to continue.",
        cta_html=_button_html(link, "Reset password"),
        note="This reset link expires in 15 minutes. If you did not request this, you can ignore this email.",
        fallback_url=link,
    )
    _send_mail(email, subject, text, html)


def send_password_reset_mail_safe(email: str) -> None:
    try:
        send_password_reset_mail(email)
    except Exception:
        logger.exception("Password reset mail background task failed for %s", email)

def hashPassword(password : str):
    return bcrypt.hashpw(bytes(password,'utf-8'),bcrypt.gensalt()).decode('utf-8')
def verifyPassword(p1,hashed):
    return bcrypt.checkpw(bytes(p1,'utf-8'),bytes(hashed,'utf-8'))

def createSessionToken():
    return uuid.uuid4().__str__()





# def generateKey():
#     key : str = secrets.token_urlsafe(32)
#     print(key)
#     return key
#
# print(generateKey())