from datetime import datetime, timezone

from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtWidgets import (
    QMainWindow, QWidget, QLabel, QVBoxLayout, QHBoxLayout, QPushButton,
)


class CountdownWindow(QMainWindow):
    def __init__(self, exam: dict, on_start, on_cancel):
        """
        exam     — dict with id, name, start (ISO), end (ISO), total_marks
        on_start — callable(exam_id) called when countdown hits 0
        on_cancel— callable() called when user goes back
        """
        super().__init__()
        self._exam = exam
        self._on_start = on_start
        self._on_cancel = on_cancel

        self.setWindowTitle("Waffle")

        root = QWidget()
        root.setObjectName("MainBackground")
        layout = QVBoxLayout()
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.setContentsMargins(40, 40, 40, 40)
        layout.setSpacing(8)
        root.setLayout(layout)

        name_lbl = QLabel(exam["name"])
        name_lbl.setObjectName("ExamTitle")
        name_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(name_lbl)

        marks_lbl = QLabel(f"{exam.get('total_marks', '—')} marks")
        marks_lbl.setObjectName("CardMeta")
        marks_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(marks_lbl)

        layout.addSpacing(32)

        sub = QLabel("Exam starts in")
        sub.setObjectName("LoginSubtitle")
        sub.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(sub)

        self._countdown_lbl = QLabel("--:--:--")
        self._countdown_lbl.setObjectName("CountdownLabel")
        self._countdown_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self._countdown_lbl)

        layout.addSpacing(40)

        cancel_btn = QPushButton("← Back")
        cancel_btn.setObjectName("SignOutButton")
        cancel_btn.setFixedWidth(120)
        cancel_btn.clicked.connect(self._cancel)

        btn_row = QHBoxLayout()
        btn_row.setAlignment(Qt.AlignmentFlag.AlignCenter)
        btn_row.addWidget(cancel_btn)
        layout.addLayout(btn_row)

        self.setCentralWidget(root)

        self._timer = QTimer()
        self._timer.timeout.connect(self._tick)
        self._timer.start(1000)
        self._tick()  # render immediately without waiting 1 s

        self.showMaximized()

    @staticmethod
    def _parse_dt(iso: str) -> datetime:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))

    def _tick(self):
        delta = self._parse_dt(self._exam["start"]) - datetime.now(timezone.utc)
        total = int(delta.total_seconds())
        if total <= 0:
            self._timer.stop()
            self._on_start(self._exam["id"])
            self.close()
            return
        h, rem = divmod(total, 3600)
        m, s = divmod(rem, 60)
        self._countdown_lbl.setText(f"{h:02d}:{m:02d}:{s:02d}")

    def _cancel(self):
        self._timer.stop()
        self._on_cancel()
        self.close()
