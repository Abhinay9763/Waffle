import json
from http.client import responses

import httpx
from PyQt6.QtCore import QObject, pyqtSignal
from httpx import Response

from config import loginRoute

def isValidEmail(email : str):
    if not "@" in email or not "." in email:
        return False
    return True

class LoginWorker(QObject):
    finished = pyqtSignal(Response)
    error = pyqtSignal(str)

    def __init__(self,email,password):
        super().__init__()
        self.email = email
        self.password = password

    def run(self):
        if not self.email or not self.password:
            self.error.emit("Empty Field! Please Enter Correct Credentials")
            return
        if not isValidEmail(self.email):
            self.error.emit("Invalid Email!")
            return
        try:
            print("httpx")
            with httpx.Client(timeout=10) as client:
                response = client.post(
                    loginRoute,
                    json={
                        "email": self.email,
                        "password": self.password
                    }
                )
            self.finished.emit(response)


        except Exception as e:
            self.error.emit(str(e))