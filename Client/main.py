import sys
import traceback

import httpx
from PyQt6.QtCore import QObject, QThread, pyqtSignal
from PyQt6.QtWidgets import QApplication, QMessageBox

from loginWindow import LoginWindow
from dashboardWindow import DashboardWindow
from countdownWindow import CountdownWindow
from examWindow import MainWindow
from models import Exam
from config import API

app = QApplication([])

# crash logging that never worked
def _excepthook(exc_type, exc_value, exc_tb):
    text = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
    print(text, file=sys.stderr)
    with open("crash.log", "a") as f:
        f.write(text + "\n" + "─" * 60 + "\n")
    sys.__excepthook__(exc_type, exc_value, exc_tb)

def _unraisablehook(unraisable):
    text = "".join(traceback.format_exception(
        unraisable.exc_type, unraisable.exc_value, unraisable.exc_traceback
    ))
    print(text, file=sys.stderr)
    with open("crash.log", "a") as f:
        f.write(text + "\n" + "─" * 60 + "\n")

sys.excepthook = _excepthook
sys.unraisablehook = _unraisablehook

with open("dark.qss", "r") as f:
    app.setStyleSheet(f.read())

# prevent garbaaage collection cus python is an idiot
_windows: dict = {}
_token: str = ""




class ExamTakeWorker(QObject):
    finished = pyqtSignal(dict)
    error = pyqtSignal(str)

    def __init__(self, exam_id: int, token: str):
        super().__init__()
        self.exam_id = exam_id
        self.token = token

    def run(self):
        try:
            with httpx.Client(timeout=10) as c:
                r = c.get(f"{API}/exam/{self.exam_id}/take",
                          headers={"x-session-token": self.token})
            if r.status_code == 200:
                self.finished.emit(r.json())
            else:
                try:
                    detail = r.json().get("detail", f"Server returned {r.status_code}.")
                except Exception:
                    detail = f"Server returned {r.status_code}."
                self.error.emit(detail)
        except Exception as e:
            msg = str(e).lower()
            if any(w in msg for w in ("connect", "refused", "network", "timeout", "unreachable")):
                self.error.emit("Could not reach the server.")
            else:
                self.error.emit(str(e))


# ── Window transitions ──────────────────────────────────────────────────────

def show_login():
    w = LoginWindow(on_success=show_dashboard)
    _windows["login"] = w
    if "dashboard" in _windows:
        del _windows["dashboard"]


def show_dashboard(token: str):
    global _token
    _token = token
    if "login" in _windows:
        _windows["login"].hide()
    w = DashboardWindow(token)
    w.signed_out.connect(show_login)
    w.join_exam.connect(show_exam)
    w.watch_exam.connect(show_countdown)
    w.session_expired.connect(show_login)
    _windows["dashboard"] = w


def show_countdown(exam: dict):
    if "dashboard" in _windows:
        _windows["dashboard"].hide()
    w = CountdownWindow(
        exam=exam,
        on_start=show_exam,
        on_cancel=_back_to_dashboard,
    )
    _windows["countdown"] = w


def _back_to_dashboard():
    _windows.pop("countdown", None)
    if "dashboard" in _windows:
        _windows["dashboard"].show()


def show_exam(exam_id: int):
    if "_exam_fetch" in _windows or "exam" in _windows:
        return  # already fetching or exam already open
    for key in ("dashboard", "countdown"):  # hide source window immediately
        if key in _windows:
            _windows[key].hide()
    worker = ExamTakeWorker(exam_id, _token)
    thread = QThread()
    worker.moveToThread(thread)
    thread.started.connect(worker.run)
    worker.finished.connect(_open_exam)
    worker.error.connect(_on_exam_error)
    worker.finished.connect(lambda _: thread.quit())
    worker.error.connect(lambda _: thread.quit())
    thread.finished.connect(worker.deleteLater)
    thread.finished.connect(thread.deleteLater)
    thread.finished.connect(lambda: _windows.pop("_exam_fetch", None))
    _windows["_exam_fetch"] = (worker, thread)  # strong ref
    thread.start()


def _open_exam(data: dict):
    try:
        exam = Exam(**data)
    except Exception as e:
        _on_exam_error(f"Invalid exam data: {e}")
        return
    for key in ("dashboard", "countdown"):
        if key in _windows:
            _windows[key].hide()
    w = MainWindow(exam, app, _token, _on_exam_complete)
    _windows["exam"] = w


def _on_exam_complete():
    _windows.pop("exam", None)
    if "dashboard" in _windows:
        _windows["dashboard"].show()
    else:
        show_login()


def _on_exam_error(msg: str):
    QMessageBox.critical(None, "Could not load exam", msg)
    if "countdown" in _windows:
        _back_to_dashboard()
    elif "dashboard" in _windows:
        _windows["dashboard"].show()


show_login()          # normal flow
# show_dashboard("fake-token")  # skip login during development
app.exec()
