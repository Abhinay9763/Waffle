import json
import webbrowser

import httpx
from PyQt6.QtCore import Qt, QThread, QObject, pyqtSignal
from PyQt6.QtWidgets import (
    QMainWindow, QWidget, QLabel, QVBoxLayout, QHBoxLayout,
    QLineEdit, QPushButton,
)

API = "http://localhost:8000"
WEB_REGISTER_URL = "http://localhost:3000/register"


class LoginWorker(QObject):
    finished = pyqtSignal(int, str)  # status_code, response_body_text
    error = pyqtSignal(str)

    def __init__(self, email: str, password: str):
        super().__init__()
        self.email = email
        self.password = password

    def run(self):
        try:
            with httpx.Client(timeout=10) as c:
                r = c.post(f"{API}/user/login",
                           json={"email": self.email, "password": self.password})
            self.finished.emit(r.status_code, r.text)
        except Exception as e:
            msg = str(e).lower()
            if any(w in msg for w in ("connect", "refused", "network", "timeout", "unreachable")):
                self.error.emit("Could not reach the server.")
            else:
                self.error.emit("Network error. Please try again.")


class LoginWindow(QMainWindow):
    def __init__(self, on_success):
        """on_success(token: str) called after successful login."""
        super().__init__()
        self._on_success_cb = on_success
        self._busy = False
        self._thread = None
        self._worker = None

        self.setWindowTitle("Waffle")

        root = QWidget()
        root.setObjectName("MainBackground")
        root_layout = QVBoxLayout()
        root_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        root.setLayout(root_layout)

        card = QWidget()
        card.setObjectName("LoginCard")
        card.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        card.setFixedWidth(400)
        card_layout = QVBoxLayout()
        card_layout.setContentsMargins(32, 36, 32, 36)
        card_layout.setSpacing(14)
        card.setLayout(card_layout)

        # Title
        title = QLabel("Waffle")
        title.setObjectName("LoginTitle")
        subtitle = QLabel("Sign in to your student account")
        subtitle.setObjectName("LoginSubtitle")
        card_layout.addWidget(title)
        card_layout.addWidget(subtitle)
        card_layout.addSpacing(10)

        # Email
        card_layout.addWidget(self._field_label("Email address"))
        self.email_edit = QLineEdit()
        self.email_edit.setObjectName("FieldInput")
        self.email_edit.setPlaceholderText("you@smec.ac.in")
        card_layout.addWidget(self.email_edit)

        # Password
        card_layout.addWidget(self._field_label("Password"))
        self.password_edit = QLineEdit()
        self.password_edit.setObjectName("FieldInput")
        self.password_edit.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_edit.setPlaceholderText("••••••••")
        self.password_edit.returnPressed.connect(self._login)
        card_layout.addWidget(self.password_edit)

        # Error banner
        self.error_label = QLabel("")
        self.error_label.setObjectName("ErrorLabel")
        self.error_label.setWordWrap(True)
        self.error_label.hide()
        card_layout.addWidget(self.error_label)

        # Sign in button
        card_layout.addSpacing(4)
        self.login_btn = QPushButton("Sign in")
        self.login_btn.setObjectName("LoginButton")
        self.login_btn.clicked.connect(self._login)
        card_layout.addWidget(self.login_btn)

        # Register row
        reg_row = QHBoxLayout()
        reg_row.setAlignment(Qt.AlignmentFlag.AlignCenter)
        reg_row.setSpacing(4)
        reg_row.addWidget(self._make_subtitle("Don't have an account?"))
        reg_btn = QPushButton("Register on web")
        reg_btn.setObjectName("RegisterLink")
        reg_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        reg_btn.clicked.connect(lambda: webbrowser.open(WEB_REGISTER_URL))
        reg_row.addWidget(reg_btn)
        card_layout.addLayout(reg_row)

        root_layout.addWidget(card)
        self.setCentralWidget(root)
        self.showMaximized()

    def _field_label(self, text: str) -> QLabel:
        lbl = QLabel(text)
        lbl.setObjectName("FieldLabel")
        return lbl

    def _make_subtitle(self, text: str) -> QLabel:
        lbl = QLabel(text)
        lbl.setObjectName("LoginSubtitle")
        return lbl

    # ── Login flow ─────────────────────────────────────────

    def _login(self):
        if self._busy:
            return

        email = self.email_edit.text().strip()
        password = self.password_edit.text()

        if not email or not password:
            self._show_error("Please enter your email and password.")
            return
        if "@" not in email or "." not in email:
            self._show_error("Please enter a valid email address.")
            return

        # Lock and show visual indicator BEFORE spawning thread
        self._busy = True
        self.error_label.hide()
        self.login_btn.setText("Signing in…")
        self.email_edit.setEnabled(False)
        self.password_edit.setEnabled(False)

        self._worker = LoginWorker(email, password)
        self._thread = QThread()
        self._worker.moveToThread(self._thread)

        self._thread.started.connect(self._worker.run)
        self._worker.finished.connect(self._on_success)
        self._worker.error.connect(self._on_error)

        # Cleanup: null refs first (so guard sees None), then schedule C++ deletion
        self._worker.finished.connect(lambda *_: self._thread.quit())
        self._worker.error.connect(lambda _: self._thread.quit())
        self._thread.finished.connect(self._clear_thread)       # null refs
        self._thread.finished.connect(self._worker.deleteLater) # then delete
        self._thread.finished.connect(self._thread.deleteLater)

        self._thread.start()

    def _clear_thread(self):
        """Runs on thread.finished — null refs before deleteLater fires."""
        self._thread = None
        self._worker = None
        self._busy = False
        self.login_btn.setText("Sign in")
        self.email_edit.setEnabled(True)
        self.password_edit.setEnabled(True)

    # ── Response handlers ──────────────────────────────────

    def _on_success(self, status_code: int, body: str):
        try:
            data = json.loads(body)
        except Exception:
            self._show_error("Unexpected server response.")
            return

        if status_code == 200:
            self._on_success_cb(data.get("token", ""))
        elif status_code == 401:
            self._show_error("Incorrect password. Please try again.")
        elif status_code == 404:
            self._show_error("No account found with that email.")
        else:
            self._show_error(data.get("detail") or f"Login failed ({status_code}).")

    def _on_error(self, msg: str):
        self._show_error(msg)

    def _show_error(self, msg: str):
        self.error_label.setText(msg)
        self.error_label.show()
