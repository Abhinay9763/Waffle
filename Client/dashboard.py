from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import QMainWindow, QWidget, QLabel


class Dashboard(QMainWindow):
    def __init__(self):
        super().__init__()
        # self.setWindowFlags(
        #     Qt.WindowType.Frame
        # )



        self.setWindowTitle("Waffle-Dashboard")
        self.showMaximized()