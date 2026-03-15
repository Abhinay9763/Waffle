from datetime import datetime, timezone

import httpx
from PyQt6.QtCore import Qt, QThread, pyqtSignal, QObject, QTimer
from PyQt6.QtWidgets import (
    QMainWindow, QWidget, QLabel, QVBoxLayout, QHBoxLayout,
    QPushButton, QLineEdit, QScrollArea, QSizePolicy,
)

from config import API, APP_NAME


# ── Helpers ────────────────────────────────────────────────────────────────

def _parse_dt(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def status_of(exam: dict) -> str:
    now = datetime.now(timezone.utc)
    s, e = _parse_dt(exam["start"]), _parse_dt(exam["end"])
    if now < s:
        return "upcoming"
    if now <= e:
        return "live"
    return "ended"


def fmt_countdown(iso: str, prefix: str) -> str:
    delta = _parse_dt(iso) - datetime.now(timezone.utc)
    total = max(0, int(delta.total_seconds()))
    h, rem = divmod(total, 3600)
    m = rem // 60
    if h > 0:
        return f"{prefix} in {h}h {m}m"
    return f"{prefix} in {m}m"


# ── Background workers ─────────────────────────────────────────────────────

class UserFetchWorker(QObject):
    finished = pyqtSignal(dict)
    error = pyqtSignal(str)

    def __init__(self, token: str):
        super().__init__()
        self.token = token

    def run(self):
        try:
            with httpx.Client(timeout=10) as c:
                r = c.get(f"{API}/user/session", headers={"x-session-token": self.token})
            if r.status_code == 200:
                self.finished.emit(r.json().get("user", {}))
            else:
                self.error.emit(str(r.status_code))
        except Exception as e:
            self.error.emit(str(e))


class ExamFetchWorker(QObject):
    finished = pyqtSignal(list)
    error = pyqtSignal(str)
    auth_error = pyqtSignal()

    def __init__(self, token: str):
        super().__init__()
        self.token = token

    def run(self):
        try:
            with httpx.Client(timeout=10) as c:
                r = c.get(f"{API}/exam/available", headers={"x-session-token": self.token})
            if r.status_code == 200:
                self.finished.emit(r.json().get("exams", []))
            elif r.status_code == 401:
                self.auth_error.emit()
            else:
                self.error.emit(f"Server error {r.status_code}")
        except Exception as e:
            msg = str(e).lower()
            if any(w in msg for w in ("connect", "refused", "network", "timeout", "unreachable")):
                self.error.emit("Could not reach the server.")
            else:
                self.error.emit(str(e))


# ── Dashboard window ───────────────────────────────────────────────────────

class DashboardWindow(QMainWindow):
    signed_out = pyqtSignal()
    join_exam = pyqtSignal(int)    # live exam → enter immediately
    watch_exam = pyqtSignal(dict)  # upcoming exam → show countdown
    session_expired = pyqtSignal() # 401 → redirect to login

    def __init__(self, token: str):
        super().__init__()
        self.token = token
        self._exams: list[dict] = []
        self._fetch_thread = None
        self._fetch_worker = None

        self.setWindowTitle(APP_NAME)

        # ── Root ────────────────────────────────────────────
        root = QWidget()
        root.setObjectName("MainBackground")
        root_layout = QVBoxLayout()
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)
        root.setLayout(root_layout)

        # ── Header ──────────────────────────────────────────
        header = QWidget()
        header.setObjectName("TopBar")
        header_layout = QHBoxLayout()
        header_layout.setContentsMargins(24, 0, 24, 0)
        header_layout.setSpacing(10)
        header.setLayout(header_layout)

        brand = QLabel(APP_NAME)
        brand.setObjectName("ExamTitle")
        header_layout.addWidget(brand)
        header_layout.addStretch(1)

        self.student_info_lbl = QLabel("")
        self.student_info_lbl.setObjectName("StudentInfo")
        header_layout.addWidget(self.student_info_lbl)
        header_layout.addStretch(1)

        self.refresh_btn = QPushButton("↻  Refresh")
        self.refresh_btn.setObjectName("RefreshButton")
        self.refresh_btn.clicked.connect(self._fetch_exams)
        header_layout.addWidget(self.refresh_btn)

        signout_btn = QPushButton("Sign out")
        signout_btn.setObjectName("SignOutButton")
        signout_btn.clicked.connect(self._sign_out)
        header_layout.addWidget(signout_btn)

        root_layout.addWidget(header)

        # ── Body ─────────────────────────────────────────────
        body = QWidget()
        body_layout = QVBoxLayout()
        body_layout.setContentsMargins(24, 20, 24, 20)
        body_layout.setSpacing(14)
        body.setLayout(body_layout)

        self.search_edit = QLineEdit()
        self.search_edit.setObjectName("SearchInput")
        self.search_edit.setPlaceholderText("Search exams…")
        self.search_edit.textChanged.connect(self._render_exams)
        body_layout.addWidget(self.search_edit)

        scroll = QScrollArea()
        scroll.setObjectName("DashScroll")
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)

        self.list_widget = QWidget()
        self.list_layout = QVBoxLayout()
        self.list_layout.setSpacing(8)
        self.list_layout.setContentsMargins(0, 0, 0, 0)
        self.list_layout.setAlignment(Qt.AlignmentFlag.AlignTop)
        self.list_widget.setLayout(self.list_layout)
        scroll.setWidget(self.list_widget)

        body_layout.addWidget(scroll, 1)
        root_layout.addWidget(body, 1)

        self.setCentralWidget(root)

        # ── Timers ───────────────────────────────────────────
        # Re-fetch data every 30 s
        self._fetch_timer = QTimer()
        self._fetch_timer.timeout.connect(self._fetch_exams)
        self._fetch_timer.start(30_000)

        # Re-render countdown text every 60 s (no network)
        self._render_timer = QTimer()
        self._render_timer.timeout.connect(self._render_exams)
        self._render_timer.start(60_000)

        # ── Initial data load ────────────────────────────────
        self._fetch_user_info()
        self._fetch_exams()
        self.showMaximized()

    # ── User info ──────────────────────────────────────────

    def _fetch_user_info(self):
        worker = UserFetchWorker(self.token)
        thread = QThread(self)
        worker.moveToThread(thread)
        thread.started.connect(worker.run)
        worker.finished.connect(lambda u: self._on_user_info(u))
        worker.error.connect(lambda _: None)
        worker.finished.connect(thread.quit)
        worker.error.connect(lambda _: thread.quit())
        thread.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)
        thread.start()

    def _on_user_info(self, user: dict):
        parts = [p for p in [user.get("name"), user.get("roll")] if p]
        if parts:
            self.student_info_lbl.setText("  |  ".join(parts))

    # ── Exam fetch ─────────────────────────────────────────

    def _fetch_exams(self):
        if self._fetch_thread is not None:   # thread still alive — skip
            return
        self.refresh_btn.setEnabled(False)
        self.refresh_btn.setText("↻  Refreshing…")

        self._fetch_worker = ExamFetchWorker(self.token)
        self._fetch_thread = QThread()
        self._fetch_worker.moveToThread(self._fetch_thread)
        self._fetch_thread.started.connect(self._fetch_worker.run)
        self._fetch_worker.finished.connect(self._on_fetched)
        self._fetch_worker.error.connect(self._on_fetch_error)
        self._fetch_worker.auth_error.connect(self._on_auth_error)

        # Cleanup: null refs first, then schedule C++ deletion
        self._fetch_worker.finished.connect(self._fetch_thread.quit)
        self._fetch_worker.error.connect(lambda _: self._fetch_thread.quit())
        self._fetch_worker.auth_error.connect(self._fetch_thread.quit)
        self._fetch_thread.finished.connect(self._clear_fetch_thread)
        self._fetch_thread.finished.connect(self._fetch_worker.deleteLater)
        self._fetch_thread.finished.connect(self._fetch_thread.deleteLater)

        self._fetch_thread.start()

    def _clear_fetch_thread(self):
        self._fetch_thread = None
        self._fetch_worker = None

    def _on_fetched(self, exams: list):
        self.refresh_btn.setEnabled(True)
        self.refresh_btn.setText("↻  Refresh")
        self._exams = exams
        self._render_exams()

    def _on_fetch_error(self, msg: str):
        self.refresh_btn.setEnabled(True)
        self.refresh_btn.setText("↻  Refresh")
        self._clear_list()
        err = QLabel(f"Could not load exams — {msg}")
        err.setObjectName("ErrorLabel")
        err.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.list_layout.addWidget(err)

    def _on_auth_error(self):
        self.refresh_btn.setEnabled(True)
        self.refresh_btn.setText("↻  Refresh")
        self.session_expired.emit()

    # ── Rendering ──────────────────────────────────────────

    def _clear_list(self):
        while self.list_layout.count():
            child = self.list_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()

    def _render_exams(self):
        query = self.search_edit.text().strip().lower()
        filtered = [e for e in self._exams if query in e["name"].lower()]
        live = [e for e in filtered if status_of(e) == "live"]
        upcoming = [e for e in filtered if status_of(e) == "upcoming"]

        self._clear_list()

        if not live and not upcoming:
            msg = "No exams match your search." if query else "No exams scheduled right now.\nCheck back later."
            empty = QLabel(msg)
            empty.setObjectName("EmptyLabel")
            empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
            empty.setWordWrap(True)
            self.list_layout.addWidget(empty)
            return

        if live:
            self._add_section("Live Now")
            for exam in live:
                self.list_layout.addWidget(self._make_card(exam, "live"))

        if upcoming:
            self._add_section("Upcoming")
            for exam in upcoming:
                self.list_layout.addWidget(self._make_card(exam, "upcoming"))

    def _add_section(self, text: str):
        lbl = QLabel(text)
        lbl.setObjectName("DashSectionLabel")
        self.list_layout.addWidget(lbl)

    def _make_card(self, exam: dict, status: str) -> QWidget:
        card = QWidget()
        card.setObjectName("ExamCardLive" if status == "live" else "ExamCardUpcoming")
        card.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)

        layout = QHBoxLayout()
        layout.setContentsMargins(18, 14, 18, 14)
        layout.setSpacing(16)
        card.setLayout(layout)

        # Info column
        info = QVBoxLayout()
        info.setSpacing(5)

        name_row = QHBoxLayout()
        name_row.setSpacing(8)
        name_row.setAlignment(Qt.AlignmentFlag.AlignVCenter)

        name_lbl = QLabel(exam["name"])
        name_lbl.setObjectName("CardName")

        badge = QLabel("● Live" if status == "live" else "Upcoming")
        badge.setObjectName("LiveBadge" if status == "live" else "UpcomingBadge")
        badge.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)

        name_row.addWidget(name_lbl)
        name_row.addWidget(badge)
        name_row.addStretch()

        marks = exam.get("total_marks", "—")
        faculty = exam.get("faculty_name", "")
        if status == "live":
            countdown = fmt_countdown(exam["end"], "ends")
        else:
            countdown = fmt_countdown(exam["start"], "starts")
        meta_text = f"{marks} marks  ·  {countdown}"
        if faculty:
            meta_text += f"  ·  {faculty}"
        meta_lbl = QLabel(meta_text)
        meta_lbl.setObjectName("CardMeta")

        info.addLayout(name_row)
        info.addWidget(meta_lbl)
        layout.addLayout(info, 1)

        # Join button
        join_btn = QPushButton("Join" if status == "live" else "Wait")
        join_btn.setObjectName("JoinButton" if status == "live" else "WaitButton")
        join_btn.setFixedWidth(88)
        if status == "live":
            join_btn.clicked.connect(lambda _, eid=exam["id"]: self.join_exam.emit(eid))
        else:
            join_btn.clicked.connect(lambda _, e=exam: self.watch_exam.emit(e))
        layout.addWidget(join_btn)

        return card

    # ── Sign out ───────────────────────────────────────────

    def _sign_out(self):
        self._fetch_timer.stop()
        self._render_timer.stop()
        self.signed_out.emit()
        self.close()
