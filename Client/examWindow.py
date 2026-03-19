import datetime
from datetime import timezone

import httpx
from PyQt6.QtCore import Qt, QEvent, QTimer, QThread, pyqtSignal
from PyQt6.QtGui import QPixmap
from PyQt6.QtWidgets import (
    QMainWindow, QApplication,
    QHBoxLayout, QVBoxLayout, QWidget, QLabel, QPushButton, QGridLayout, QScrollArea, QSizePolicy,
    QSplitter, QMessageBox, QFrame,
)
from models import Exam, Question, QuestionResponse, Submission
from config import API, APP_NAME

# Optional blind mode import - gracefully handle if dependencies not installed
try:
    from blind_mode import BlindModeManager
    BLIND_MODE_AVAILABLE = True
except ImportError as e:
    print(f"Blind mode not available: {e}")
    BLIND_MODE_AVAILABLE = False
    BlindModeManager = None


# ── Submit worker ────────────────────────────────────────────────────────────

class SubmitWorker(QThread):
    success = pyqtSignal()
    error   = pyqtSignal(str)

    def __init__(self, token: str, exam_id: int, response_payload: dict, parent=None):
        super().__init__(parent)
        self.token            = token
        self.exam_id          = exam_id
        self.response_payload = response_payload

    def run(self):
        try:
            with httpx.Client(timeout=15) as c:
                r = c.post(
                    f"{API}/response/submit",
                    headers={"x-session-token": self.token},
                    json={"exam_id": self.exam_id, "response": self.response_payload},
                )
            if r.status_code == 200:
                self.success.emit()
            else:
                self.error.emit(f"Server returned {r.status_code}.")
        except Exception as e:
            msg = str(e).lower()
            if any(w in msg for w in ("connect", "refused", "network", "timeout", "unreachable")):
                self.error.emit("Could not reach the server.")
            else:
                self.error.emit(str(e))



# ── Heartbeat worker (fire-and-forget autosave) ──────────────────────────────

class HeartbeatWorker(QThread):
    success = pyqtSignal()  # emitted only on 2xx — drives the autosave indicator

    def __init__(self, token: str, exam_id: int, response_payload: dict, parent=None):
        super().__init__(parent)
        self.token            = token
        self.exam_id          = exam_id
        self.response_payload = response_payload

    def run(self):
        try:
            with httpx.Client(timeout=6) as c:
                r = c.post(
                    f"{API}/response/heartbeat",
                    headers={"x-session-token": self.token},
                    json={"exam_id": self.exam_id, "response": self.response_payload},
                )
            if r.status_code == 200:
                self.success.emit()
        except Exception:
            pass  # best-effort — silently drop on failure


# ── Clickable option widget (supports text + optional image) ──────────────────

class ClickableOption(QFrame):
    def __init__(self, callback, parent=None):
        super().__init__(parent)
        self._cb = callback
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setObjectName("OptionButton")

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self._cb()


# ── Exam window ──────────────────────────────────────────────────────────────

class MainWindow(QMainWindow):
    def __init__(self, exam: Exam, app: QApplication, token: str, on_complete, image_cache: dict | None = None):
        super().__init__()
        self._token       = token
        self._on_complete = on_complete
        self.image_cache: dict[str, QPixmap] = image_cache or {}
        self._dialog_open = False  # suppresses force_on_top while a dialog is shown
        self._submitting  = False  # prevents duplicate submissions
        self.app = app
        self.qTimer = QTimer(self)
        self.qTimer.timeout.connect(self.updateTimer)
        self.qTimer.start(1000)

        # Heartbeat — autosaves progress every 30 s for live-tracker + recovery
        self._hb_timer = QTimer(self)
        self._hb_timer.timeout.connect(self._send_heartbeat)
        self._hb_timer.start(30_000)

        # Single-shot timer to clear the autosave label — parented to self so it
        # dies with the window (avoids dangling pointer crash after submit)
        self._autosave_hide = QTimer(self)
        self._autosave_hide.setSingleShot(True)
        self._autosave_hide.timeout.connect(lambda: self._autosave_lbl.setText(""))

        # Fire an initial heartbeat 2 s after the exam opens
        QTimer.singleShot(2000, self._send_heartbeat)

        # Blind mode setup (only if dependencies available)
        self.blind_mode_enabled = False
        self.blind_mode = None
        self.should_auto_speak_question = False  # Flag to control when to auto-speak questions
        if BLIND_MODE_AVAILABLE:
            self.blind_mode = BlindModeManager(parent=self)
            self.blind_mode.command_recognized.connect(self._handle_blind_command)
            self.blind_mode.speech_finished.connect(self._on_speech_finished)
            self.blind_mode.listening_started.connect(self._show_listening_indicator)
            self.blind_mode.listening_finished.connect(self._hide_listening_indicator)

        self.sections = exam.sections
        self.questions = [question
                          for section in self.sections
                          for question in section.questions]

        self.current_question = 0
        self.responses: dict[int, QuestionResponse] = {}
        self.exam = exam

        self.setObjectName("MainWindow")

        # self.setWindowFlags(
        #     Qt.WindowType.FramelessWindowHint
        #     | Qt.WindowType.WindowStaysOnTopHint
        # )
        self.setWindowTitle(APP_NAME)
        self.setContextMenuPolicy(Qt.ContextMenuPolicy.NoContextMenu)

        main_layout = QVBoxLayout()
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # TOP --------------------------------
        topbar = QWidget()
        topbar.setObjectName("TopBar")
        top_layout = QHBoxLayout()
        top_layout.setContentsMargins(24, 0, 24, 0)
        top_layout.setSpacing(0)
        topbar.setLayout(top_layout)

        # Left: exam name
        exam_name = QLabel(exam.meta.exam_name)
        exam_name.setObjectName("ExamTitle")
        top_layout.addWidget(exam_name)
        top_layout.addStretch(1)

        # Center: student info
        student_info = QLabel(exam.meta.student_roll or "")
        student_info.setObjectName("StudentInfo")
        top_layout.addWidget(student_info)
        top_layout.addStretch(1)

        # Right: blind mode toggle (if available) + listening indicator + autosave indicator + timer
        if BLIND_MODE_AVAILABLE:
            self.blind_mode_btn = QPushButton("🎧 Enable Blind Mode")
            self.blind_mode_btn.setObjectName("BlindModeButton")
            self.blind_mode_btn.setCheckable(True)
            self.blind_mode_btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)  # Prevent button from stealing space bar
            self.blind_mode_btn.clicked.connect(self._toggle_blind_mode)
            top_layout.addWidget(self.blind_mode_btn)

            # Listening indicator
            self.listening_indicator = QLabel("🔴 Listening...")
            self.listening_indicator.setObjectName("ListeningIndicator")
            self.listening_indicator.setVisible(False)  # Hidden by default
            top_layout.addWidget(self.listening_indicator)

        self._autosave_lbl = QLabel("")
        self._autosave_lbl.setObjectName("AutosaveLabel")
        top_layout.addWidget(self._autosave_lbl)

        self.timer = QLabel("")
        self.timer.setObjectName("TimerLabel")
        self.timer.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        top_layout.addWidget(self.timer)

        # MID --------------------------------
        mid_layout = QHBoxLayout()
        mid_layout.setContentsMargins(12, 8, 12, 8)
        midbar = QWidget()
        midbar.setObjectName("MidBar")
        midbar.setLayout(mid_layout)

        splitter = QSplitter(Qt.Orientation.Horizontal)

        question_widget = QWidget()
        question_widget.setObjectName("QuestionPanel")
        question_widget.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        # Keep question side visibly wider than nav
        question_widget.setMinimumWidth(400)
        question_layout = QVBoxLayout()
        question_layout.setSpacing(12)
        self.question_layout = question_layout
        question_widget.setLayout(question_layout)

        question_scroll = QScrollArea()
        question_scroll.setWidgetResizable(True)
        question_scroll.setWidget(question_widget)
        question_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        question_scroll.setMinimumWidth(0)

        nav_widget = QWidget()
        nav_widget.setObjectName("NavPanel")
        # Keep nav visible but never wider than the question area
        nav_widget.setMinimumWidth(260)
        nav_widget.setMaximumWidth(360)
        nav_widget.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Expanding)
        self.nav_layout = QVBoxLayout()
        nav_widget.setLayout(self.nav_layout)

        q_scroll = QScrollArea()
        q_scroll.setWidgetResizable(True)
        q_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)

        self.container = QWidget()
        container_layout = QVBoxLayout()
        self.container.setLayout(container_layout)
        container_layout.setContentsMargins(10, 10, 10, 10)
        container_layout.setSpacing(10)
        count = 1
        for section in self.sections:
            section_label = QLabel(section.name)
            section_label.setObjectName("NavSectionLabel")
            container_layout.addWidget(section_label)

            grid = QGridLayout()
            Columns = 5
            for i, question in enumerate(section.questions):
                row = i // Columns
                col = i % Columns

                button = QPushButton(str(count))
                button.setObjectName("G" + str(question.question_id))
                button.clicked.connect(
                    lambda _, qid=question.question_id:
                    self.switchQuestion(qid - 1)
                )
                button.setFixedSize(50, 50)
                grid.addWidget(button, row, col)
                count += 1
            container_layout.addLayout(grid)
        container_layout.addStretch()

        q_scroll.setWidget(self.container)

        qVert = QWidget()
        qVert.setObjectName("LegendPanel")
        qVert_Layout = QVBoxLayout()
        qVert.setLayout(qVert_Layout)

        # Legend labels – colour-coded to match nav grid
        self.answered_label = QLabel("")
        self.marked_label = QLabel("")
        self.answered_marked_label = QLabel("")
        self.not_answered_label = QLabel("")

        # Base typography from QSS via object name, colours inline here
        self.answered_label.setObjectName("LegendLabel")
        self.answered_label.setStyleSheet("color: #22c55e;")  # green – answered

        self.marked_label.setObjectName("LegendLabel")
        self.marked_label.setStyleSheet("color: #a855f7;")  # purple – marked

        self.answered_marked_label.setObjectName("LegendLabel")
        self.answered_marked_label.setStyleSheet("color: #eab308;")  # orange – answered+marked

        self.not_answered_label.setObjectName("LegendLabel")

        qVert_Layout.addWidget(self.answered_label)
        qVert_Layout.addWidget(self.marked_label)
        qVert_Layout.addWidget(self.answered_marked_label)
        qVert_Layout.addWidget(self.not_answered_label)
        self.nav_layout.addWidget(q_scroll, 1)
        self.nav_layout.addWidget(qVert, 0)

        splitter.addWidget(question_scroll)
        splitter.addWidget(nav_widget)
        # Left (question) : right (nav) = 3 : 1
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 1)
        splitter.setChildrenCollapsible(False)
        mid_layout.addWidget(splitter)

        # BOT  --------------------------------
        bot_layout = QHBoxLayout()
        bot_layout.setContentsMargins(20, 0, 20, 0)
        bot_layout.setSpacing(10)
        botbar = QWidget()
        botbar.setObjectName("BottomBar")
        botbar.setLayout(bot_layout)

        self.mark_btn = QPushButton("Mark for Review")
        self.mark_btn.setObjectName("MarkForReview")
        self.mark_btn.setCheckable(True)
        self.mark_btn.clicked.connect(
            lambda: self.markQuestion(self.current_question)
        )
        bot_layout.addWidget(self.mark_btn)
        bot_layout.addStretch()
        clear_btn = QPushButton("Clear")
        back_btn = QPushButton("Back")
        self.next_btn = QPushButton("Next")
        clear_btn.setObjectName("ClearButton")
        back_btn.setObjectName("BackButton")
        self.next_btn.setObjectName("NextButton")

        self.next_btn.clicked.connect(self._on_next_or_submit)
        back_btn.clicked.connect(
            lambda: self.switchQuestion(self.current_question - 1)
        )
        clear_btn.clicked.connect(
            lambda: self.clearQuestion(self.current_question)
        )
        bot_layout.addWidget(clear_btn)
        bot_layout.addWidget(back_btn)
        bot_layout.addWidget(self.next_btn)

        main_layout.addWidget(topbar)
        main_layout.addWidget(midbar)
        main_layout.addWidget(botbar)

        widget = QWidget()
        widget.setObjectName("MainBackground")
        widget.setLayout(main_layout)
        self.setCentralWidget(widget)

        # self.force_on_top()
        self.updateTimer()
        self.switchQuestion(self.current_question)
        self.updateLegend()

        # Theme setup (default dark)
        self.is_dark_mode = True
        # self.load_themes()
        # self.apply_theme()

        self.showFullScreen()

        # Play entrance sound effect to confirm exam has started (after a short delay)
        if BLIND_MODE_AVAILABLE and self.blind_mode:
            QTimer.singleShot(1000, self._play_entrance_sound)

    # def load_themes(self):
    #     styles_dir = Path(__file__).parent
    #     with open(styles_dir / "light.qss", "r") as f:
    #         self.light_stylesheet = f.read()
    #     with open(styles_dir / "dark.qss", "r") as f:
    #         self.dark_stylesheet = f.read()

    def nav_btn_style(self, response):
        if not response:
            return ""
        if response.marked and response.option is not None:
            return "border: 2px solid #eab308"
        if response.marked and response.option is None:
            return "border: 2px solid #a855f7"
        if not response.marked and response.option is not None:
            return "border: 2px solid #22c55e"
        return ""

    def wrap_option_text(self, letter: str, text: str, max_chars: int = 40) -> str:

        prefix = f"{letter}.  "
        words = text.split()
        if not words:
            return prefix

        lines: list[str] = []
        current = prefix
        first_line = True

        for w in words:
            sep = "" if current.endswith("  ") or current.endswith(" ") else " "
            tentative = f"{current}{sep}{w}"
            if len(tentative) > max_chars and not first_line:
                lines.append(current)
                # indent following lines under the text part, not under the letter
                current = " " * len(prefix) + w
            else:
                current = tentative
            first_line = False

        lines.append(current)
        return "\n".join(lines)

    def updateLegend(self):
        total = len(self.questions)
        answered_only = 0
        marked_only = 0
        answered_and_marked = 0

        for r in self.responses.values():
            if r.marked and r.option is not None:
                answered_and_marked += 1
            elif r.marked and r.option is None:
                marked_only += 1
            elif (not r.marked) and r.option is not None:
                answered_only += 1

        not_answered = total - (answered_only + marked_only + answered_and_marked)

        # Texts intentionally simple: label + count, colour comes from styles above
        self.answered_label.setText(f"Answered: {answered_only}")
        self.marked_label.setText(f"Marked: {marked_only}")
        self.answered_marked_label.setText(f"Answered & marked: {answered_and_marked}")
        self.not_answered_label.setText(f"Not answered: {not_answered}")

    # def apply_theme(self):
    #     self.app.setStyleSheet(self.dark_stylesheet)
        #
        # if self.is_dark_mode:
        #     app.setStyleSheet(self.dark_stylesheet)
        #     if hasattr(self, "theme_button"):
        #         self.theme_button.setText("☀ Light")
        #         self.theme_button.setChecked(True)
        # else:
        #     app.setStyleSheet(self.light_stylesheet)
        #     if hasattr(self, "theme_button"):
        #         self.theme_button.setText("☽ Dark")
        #         self.theme_button.setChecked(False)

    # def toggle_theme(self):
    #     self.is_dark_mode = not self.is_dark_mode
    #     self.apply_theme()

    def updateTimer(self):
        remaining = self.exam.meta.end_time - datetime.datetime.now(timezone.utc)
        total_seconds = max(0, int(remaining.total_seconds()))

        if total_seconds == 0:
            self.qTimer.stop()
            self.timer.setText("00 : 00 : 00")
            if not self._submitting:
                self._do_submit()
            return

        low = total_seconds < 300  # under 5 minutes
        if self.timer.property("lowtime") != low:
            self.timer.setProperty("lowtime", low)
            self.timer.style().unpolish(self.timer)
            self.timer.style().polish(self.timer)

        self.timer.setText(
            f"{total_seconds // 3600:02} : {(total_seconds % 3600) // 60:02} : {total_seconds % 60:02}"
        )

    def clearQuestion(self, qid: int):
        question = self.questions[qid]
        if not question:
            return
        response = self.responses.get(qid) or QuestionResponse(
            question_id=question.question_id)
        response.option = None
        self.responses[qid] = response
        self.updateLegend()
        self.switchQuestion(qid)

    def markQuestion(self, qid: int):
        question = self.questions[qid]
        if not question:
            return
        response = self.responses.get(qid) or QuestionResponse(
            question_id=question.question_id)
        response.marked = not response.marked
        self.responses[qid] = response
        self.updateLegend()
        self.switchQuestion(qid)

    def answerQuestion(self, qid: int, option: int):
        question = self.questions[qid]
        if not question:
            return
        response = self.responses.get(qid) or QuestionResponse(
            question_id=question.question_id,
            option=option)
        response.option = option
        self.responses[qid] = response
        self.updateLegend()
        self.switchQuestion(qid)

    # also acts as a re-render funciton. idk why i mixed
    # ALSO NOTE: QUESTION_ID PARAM HERE DOES NOT REFLECT QID OF THE ACTUAL QUESTION BUT RATHER ITS INDEX
    # THAS WHY IT DDOESNT FLAG IN ANSWERQ+CLEAR+MARK METHOD
    # i should rename it, idk i wont im lazy
    def switchQuestion(self, question_id: int):
        if question_id >= len(self.questions):
            question_id = 0
        if question_id < 0:
            question_id = len(self.questions) - 1
        # youll notice i converted it in the above line, forgot to give diff name
        # actual L move. dont know dont care
        question = self.questions[question_id]
        if question is None:
            question = self.questions[0]

        # Clear current highlight from previous question
        old_idx = self.current_question
        old_question = self.questions[old_idx]
        old_btn = self.container.findChild(QPushButton, "G" + str(old_question.question_id))
        if old_btn:
            old_btn.setProperty("current", False)
            old_response = self.responses.get(old_idx)
            old_btn.setStyleSheet(self.nav_btn_style(old_response))
            old_btn.style().unpolish(old_btn)
            old_btn.style().polish(old_btn)

        while self.question_layout.count():
            child = self.question_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()

        # Question text
        label = QLabel(str(question.question_id) + ". " + str(question.text))
        label.setObjectName("QuestionText")
        label.setWordWrap(True)
        label.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        self.question_layout.addWidget(label)

        # Question image
        if question.image_url and question.image_url in self.image_cache:
            img_label = QLabel()
            px = self.image_cache[question.image_url].scaled(
                800, 420, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation
            )
            img_label.setPixmap(px)
            img_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.question_layout.addWidget(img_label)

        self.current_question = question_id
        response = self.responses.get(self.current_question)

        btn = self.container.findChild(QPushButton, "G" + str(question.question_id))
        if btn:
            btn.setProperty("current", True)
            btn.setStyleSheet(self.nav_btn_style(response))
            btn.style().unpolish(btn)
            btn.style().polish(btn)

        if response:
            self.mark_btn.setChecked(response.marked)
            self.mark_btn.setText("✓ Mark for Review" if response.marked else "Mark for Review")
        else:
            self.mark_btn.setChecked(False)
            self.mark_btn.setText("Mark for Review")

        # Toggle Next ↔ Submit on the last question
        is_last  = question_id == len(self.questions) - 1
        new_text = "Submit" if is_last else "Next"
        new_name = "SubmitButton" if is_last else "NextButton"
        if self.next_btn.text() != new_text:
            self.next_btn.setText(new_text)
            self.next_btn.setObjectName(new_name)
            self.next_btn.style().unpolish(self.next_btn)
            self.next_btn.style().polish(self.next_btn)

        option_labels = ("A", "B", "C", "D", "E", "F")
        for i, option in enumerate(question.options):
            letter = option_labels[i] if i < len(option_labels) else str(i + 1)

            frame = ClickableOption(
                callback=lambda _, idx=i, q=self.current_question: self.answerQuestion(q, idx)
            )
            if response and i == response.option:
                frame.setStyleSheet(
                    "QFrame#OptionButton { border: 2px solid #22c55e; background-color: #18181b; border-radius: 8px; }"
                )
            frame.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Minimum)

            frame_layout = QVBoxLayout(frame)
            frame_layout.setContentsMargins(20, 14, 20, 14)
            frame_layout.setSpacing(8)

            # Option text
            if option.text:
                text_label = QLabel(self.wrap_option_text(letter, option.text))
                text_label.setObjectName("OptionText")
                text_label.setWordWrap(True)
                frame_layout.addWidget(text_label)
            else:
                ltr_label = QLabel(f"{letter}.")
                ltr_label.setObjectName("OptionText")
                frame_layout.addWidget(ltr_label)

            # Option image
            if option.image_url and option.image_url in self.image_cache:
                opt_img = QLabel()
                opt_px = self.image_cache[option.image_url].scaled(
                    500, 300, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation
                )
                opt_img.setPixmap(opt_px)
                opt_img.setAlignment(Qt.AlignmentFlag.AlignCenter)
                frame_layout.addWidget(opt_img)

            self.question_layout.addWidget(frame)

        # Auto-speak question in blind mode
        if self.blind_mode_enabled and self.blind_mode:
            self.blind_mode.speak_question(question, question_id + 1)

    def closeEvent(self, a0):
        self.qTimer.stop()
        self._hb_timer.stop()
        self._autosave_hide.stop()

        # Cleanup blind mode aggressively
        if self.blind_mode:
            print("Cleaning up blind mode...")  # Debug output
            self.blind_mode_enabled = False  # Disable immediately
            self.blind_mode.cleanup()
            print("Blind mode cleanup completed.")  # Debug output

        if not self._submitting:
            # Unexpected close — submit current state synchronously (best-effort).
            # Blocking call is intentional: threads can't be relied on during shutdown.
            try:
                payload = {"responses": [r.model_dump() for r in self.responses.values()]}
                with httpx.Client(timeout=8) as c:
                    c.post(
                        f"{API}/response/submit",
                        headers={"x-session-token": self._token},
                        json={"exam_id": self.exam.meta.exam_id, "response": payload},
                    )
            except Exception:
                pass

    def keyPressEvent(self, event):
        # Space bar handling for blind mode
        if event.key() == Qt.Key.Key_Space:
            # If blind mode is not available, ignore
            if not BLIND_MODE_AVAILABLE or not self.blind_mode:
                return

            # If blind mode is off, turn it on first
            if not self.blind_mode_enabled:
                self.blind_mode_btn.setChecked(True)
                self._toggle_blind_mode()
                # Remove focus from button to prevent future space presses from triggering it
                self.blind_mode_btn.clearFocus()
                self.setFocus()  # Set focus back to main window
                return

            # Blind mode is on - handle mic toggle
            # Toggle behavior based on current state
            if self.blind_mode.state.value == "speaking":
                # If speaking, stop speech and start listening
                self.blind_mode.stop_speaking()
                # Give a brief moment for state transition, then start listening
                QTimer.singleShot(100, self.blind_mode.listen)
            elif self.blind_mode.state.value == "listening":
                # If listening, stop listening
                self.blind_mode.stop_listening()
            elif self.blind_mode.state.value == "idle":
                # If idle, start listening
                self.blind_mode.listen()
            # If processing, ignore (command is being processed)
            return

        # Block all exit / OS-level shortcuts
        if event.key() in (Qt.Key.Key_Escape, Qt.Key.Key_F4,
                           Qt.Key.Key_Meta, Qt.Key.Key_Super_L, Qt.Key.Key_Super_R):
            return
        if event.modifiers() & (Qt.KeyboardModifier.AltModifier
                                | Qt.KeyboardModifier.MetaModifier):
            return
        if event.modifiers() & Qt.KeyboardModifier.ControlModifier:
            return  # block clipboard (Ctrl+C/V/X/A)

        # Regular navigation shortcuts (only when blind mode is off)
        if not self.blind_mode_enabled:
            if event.key() == Qt.Key.Key_D:
                self.switchQuestion(self.current_question + 1)
            if event.key() == Qt.Key.Key_A:
                self.switchQuestion(self.current_question - 1)
            if event.key() == Qt.Key.Key_C:
                self.clearQuestion(self.current_question)
            if event.key() == Qt.Key.Key_Z:
                self.markQuestion(self.current_question)

        super().keyPressEvent(event)

    # Detect focus loss
    def changeEvent(self, event):
        if event.type() == QEvent.Type.ActivationChange:
            if not self.isActiveWindow():
                # self.force_on_top()
                pass
        super().changeEvent(event)

    def force_on_top(self):
        self.showFullScreen()
        self.raise_()
        self.activateWindow()

    def event(self, event):
        if event.type() == QEvent.Type.WindowDeactivate and not self._dialog_open:
            QTimer.singleShot(300, self.force_on_top)
        return super().event(event)

    # ── Submit flow ──────────────────────────────────────────────────────────

    def _send_heartbeat(self):
        """Fire-and-forget autosave — keeps the live tracker up to date."""
        payload = {"responses": [r.model_dump() for r in self.responses.values()]}
        t = HeartbeatWorker(self._token, self.exam.meta.exam_id, payload, parent=self)
        t.success.connect(self._on_heartbeat_success)
        t.start()

    def _on_heartbeat_success(self):
        self._autosave_lbl.setText("✓ Autosaved")
        self._autosave_hide.start(2500)  # restarts if already counting down

    def _on_next_or_submit(self):
        if self.current_question == len(self.questions) - 1:
            self._confirm_submit()
        else:
            self.switchQuestion(self.current_question + 1)

    def _confirm_submit(self):
        unanswered = sum(
            1 for i in range(len(self.questions))
            if self.responses.get(i) is None or self.responses[i].option is None
        )
        detail = (
            f"{unanswered} question{'s' if unanswered != 1 else ''} left unanswered."
            if unanswered else "All questions answered."
        )
        dlg = QMessageBox(self)
        dlg.setWindowTitle("Submit exam")
        dlg.setText(f"{detail}\n\nSubmit and end the exam?")
        dlg.setStandardButtons(
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        dlg.setDefaultButton(QMessageBox.StandardButton.No)
        dlg.setWindowFlags(dlg.windowFlags() | Qt.WindowType.WindowStaysOnTopHint)
        self._dialog_open = True
        reply = dlg.exec()
        self._dialog_open = False
        if reply == QMessageBox.StandardButton.Yes:
            self._do_submit()

    def _do_submit(self):
        if self._submitting:
            return
        self._submitting = True
        self._hb_timer.stop()  # no more heartbeats once submission is in flight
        self.next_btn.setEnabled(False)
        self.next_btn.setText("Submitting…")
        payload = {"responses": [r.model_dump() for r in self.responses.values()]}
        self._submit_worker = SubmitWorker(
            self._token, self.exam.meta.exam_id, payload, parent=self)
        self._submit_worker.success.connect(self._on_submit_success)
        self._submit_worker.error.connect(self._on_submit_error)
        self._submit_worker.start()

    def _on_submit_success(self):
        self.qTimer.stop()
        self._dialog_open = True  # suppress force_on_top triggered by WindowDeactivate on close
        self.close()
        self._on_complete()

    def _on_submit_error(self, msg: str):
        self._submitting = False  # allow retry
        self._hb_timer.start(30_000)  # resume heartbeats while student is still active
        self.next_btn.setEnabled(True)
        self.next_btn.setText("Submit")
        dlg = QMessageBox(self)
        dlg.setIcon(QMessageBox.Icon.Critical)
        dlg.setWindowTitle("Submission failed")
        dlg.setText(msg)
        dlg.setWindowFlags(dlg.windowFlags() | Qt.WindowType.WindowStaysOnTopHint)
        self._dialog_open = True
        dlg.exec()
        self._dialog_open = False

    # ── Blind Mode methods ───────────────────────────────────────────────────

    def _toggle_blind_mode(self):
        """Toggle blind mode on/off"""
        if not self.blind_mode:
            return

        self.blind_mode_enabled = self.blind_mode_btn.isChecked()

        if self.blind_mode_enabled:
            self.blind_mode_btn.setText("🎧 Blind Mode: ON")
            # Ensure button doesn't have focus to prevent space bar interception
            self.blind_mode_btn.clearFocus()
            self.setFocus()  # Set focus back to main window
            # Set flag to auto-speak question after intro finishes
            self.should_auto_speak_question = True
            # Announce blind mode activation
            self.blind_mode.speak(
                "Blind mode activated. Press space bar to give voice commands. "
                "You can say: A, B, C, D to select an option. "
                "Mark, to mark for review. "
                "Next, to go to next question. "
                "Previous, to go back. "
                "Repeat, to hear the question again. "
                "Clear, to clear your answer."
            )
        else:
            self.blind_mode_btn.setText("🎧 Enable Blind Mode")
            self.blind_mode.stop_speaking()

    def _handle_blind_command(self, command: str):
        """Handle voice commands in blind mode"""
        print(f"🎮 Received blind command: {command}")  # Debug

        if not self.blind_mode_enabled or not self.blind_mode:
            print(f"🎮 Ignoring command - blind mode disabled")  # Debug
            return

        # Option selection
        if command.startswith('OPTION_'):
            option_letter = command.split('_')[1]
            option_map = {'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5}
            option_idx = option_map.get(option_letter)

            if option_idx is not None and option_idx < len(self.questions[self.current_question].options):
                # Check if this is the same option already selected
                current_response = self.responses.get(self.current_question)
                if current_response and current_response.option == option_idx:
                    self.blind_mode.speak(f"Option {option_letter} already selected")
                else:
                    self.answerQuestion(self.current_question, option_idx)
                    # Give confirmation with movement announcement
                    if self.current_question < len(self.questions) - 1:
                        self.blind_mode.speak(f"Selected Option {option_letter}. Moving to next question.")
                        # Auto-advance after confirmation
                        QTimer.singleShot(2000, lambda: self._delayed_next_question())
                    else:
                        self.blind_mode.speak(f"Selected Option {option_letter}. This is the last question.")
                        QTimer.singleShot(1500, lambda: self._blind_mode_last_question_prompt())
            else:
                self.blind_mode.speak("Invalid option for this question.")

        # Navigation
        elif command == 'NEXT':
            if self.current_question < len(self.questions) - 1:
                self.switchQuestion(self.current_question + 1)
                self.should_auto_speak_question = True  # Auto-speak after navigation
                self.blind_mode.speak(f"Moved to question {self.current_question + 1}")
            else:
                # Last question - ask if they want to submit or go to unanswered
                self.blind_mode.speak("Already at last question.")
                QTimer.singleShot(1000, lambda: self._blind_mode_last_question_prompt())

        elif command == 'PREV':
            if self.current_question > 0:
                self.switchQuestion(self.current_question - 1)
                self.should_auto_speak_question = True  # Auto-speak after navigation
                self.blind_mode.speak(f"Moved to question {self.current_question + 1}")
            else:
                self.blind_mode.speak("Already at first question.")

        # Mark for review
        elif command == 'MARK':
            # Get current status before marking
            current_response = self.responses.get(self.current_question)
            was_marked = current_response and current_response.marked if current_response else False

            self.markQuestion(self.current_question)

            # Check new status after marking
            updated_response = self.responses.get(self.current_question)
            is_now_marked = updated_response and updated_response.marked if updated_response else False

            if is_now_marked and not was_marked:
                # Newly marked - give confirmation with movement
                if self.current_question < len(self.questions) - 1:
                    self.blind_mode.speak("Marked for review. Moving to next question.")
                    QTimer.singleShot(2000, lambda: self._delayed_next_question())
                else:
                    self.blind_mode.speak("Marked for review. This is the last question.")
                    QTimer.singleShot(1500, lambda: self._blind_mode_last_question_prompt())
            elif not is_now_marked and was_marked:
                self.blind_mode.speak("Review mark removed")
            elif is_now_marked:
                self.blind_mode.speak("Already marked for review")

        # Repeat question
        elif command == 'REPEAT':
            # Directly speak the question without confirmation
            current_q = self.questions[self.current_question]
            self.blind_mode.speak_question(current_q, self.current_question + 1)

        # Clear answer
        elif command == 'CLEAR':
            # Check if there was an answer to clear
            current_response = self.responses.get(self.current_question)
            if current_response and current_response.option is not None:
                option_letter = ['A', 'B', 'C', 'D', 'E', 'F'][current_response.option]
                self.clearQuestion(self.current_question)
                self.blind_mode.speak(f"Option {option_letter} cleared")
            else:
                self.blind_mode.speak("No answer to clear for this question")

        # Submit
        elif command == 'SUBMIT':
            self.blind_mode.speak("Preparing to submit exam")
            self._confirm_submit()

        # Go to unanswered
        elif command == 'UNANSWERED':
            self.blind_mode.speak("Searching for unanswered questions")
            # Brief pause before executing the search
            QTimer.singleShot(600, lambda: self._blind_mode_go_to_unanswered())

    def _blind_mode_last_question_prompt(self):
        """Prompt user when they reach the last question"""
        if not self.blind_mode:
            return

        unanswered_count = sum(
            1 for i in range(len(self.questions))
            if self.responses.get(i) is None or self.responses[i].option is None
        )

        if unanswered_count > 0:
            self.blind_mode.speak(
                f"This is the last question. You have {unanswered_count} unanswered question{'s' if unanswered_count != 1 else ''}. "
                "Say 'submit' to submit the exam, or say 'unanswered' to go to unanswered questions."
            )
        else:
            self.blind_mode.speak(
                "This is the last question. All questions answered. Say 'submit' to submit the exam."
            )

    def _delayed_next_question(self):
        """Move to next question with automatic question reading"""
        if self.current_question < len(self.questions) - 1:
            self.switchQuestion(self.current_question + 1)
        else:
            # Already at last question, prompt user
            self._blind_mode_last_question_prompt()

    def _blind_mode_go_to_unanswered(self):
        """Navigate to the first unanswered question"""
        if not self.blind_mode:
            return

        for i in range(len(self.questions)):
            response = self.responses.get(i)
            if response is None or response.option is None:
                self.switchQuestion(i)
                self.should_auto_speak_question = True  # Auto-speak after navigation
                self.blind_mode.speak(f"Moved to question {i + 1}, which is unanswered.")
                return

        # All answered
        self.blind_mode.speak("All questions have been answered.")

    def _on_speech_finished(self):
        """Called when TTS finishes - auto-speak current question when flag is set"""
        if not self.blind_mode or not self.blind_mode_enabled:
            return

        # Only auto-speak question if the flag is set (after navigation commands)
        if self.should_auto_speak_question and not self.blind_mode.is_speaking:
            self.should_auto_speak_question = False  # Reset flag
            QTimer.singleShot(500, self._auto_speak_current_question)

    def _auto_speak_current_question(self):
        """Automatically speak the current question"""
        if not self.blind_mode or not self.blind_mode_enabled:
            return
        # Don't speak if already speaking
        if self.blind_mode.is_speaking:
            return
        current_q = self.questions[self.current_question]
        self.blind_mode.speak_question(current_q, self.current_question + 1)

    def _show_listening_indicator(self):
        """Show the listening indicator"""
        if BLIND_MODE_AVAILABLE and hasattr(self, 'listening_indicator'):
            self.listening_indicator.setVisible(True)

    def _hide_listening_indicator(self):
        """Hide the listening indicator"""
        if BLIND_MODE_AVAILABLE and hasattr(self, 'listening_indicator'):
            self.listening_indicator.setVisible(False)

    def _play_entrance_sound(self):
        """Play entrance sound effect when exam starts"""
        if self.blind_mode:
            self.blind_mode.play_entrance_beep()


