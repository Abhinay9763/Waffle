import os
import smtplib
import uuid
from email.message import EmailMessage

import bcrypt
import secrets
from dotenv import load_dotenv
from itsdangerous import URLSafeTimedSerializer

from models import Register
from config import APP_NAME, BASE_URL, SMTP_HOST, SMTP_PORT

load_dotenv()
secret_key = os.getenv("secret_key")

mail_user = os.getenv("gmail_user")
mail_pass = os.getenv("gmail_pass")

serializer = URLSafeTimedSerializer(secret_key)

# def generateLink(email : str):
#     return "http://localhost:8000/user/auth/" + serializer.dumps(email,salt="email-auth")

def send_auth_mail(user : Register):
    link = BASE_URL + "/user/auth/" + serializer.dumps(user.model_dump_json(),salt="email-auth")
    msg = EmailMessage()
    msg["Subject"] = f"{APP_NAME} Account Activation"
    msg["From"] = mail_user
    msg["To"] = user.email

    msg.set_content(f"Click the link below to verify your account:\n\n{link}")

    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as server:
        server.login(mail_user,mail_pass)
        server.send_message(msg)

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