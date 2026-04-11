from enum import Enum
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class Role(str,Enum):
    hod = "HOD"
    faculty = "Faculty"
    student = "Student"
    admin = "Admin"

class ApprovalStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"

class Register(BaseModel):
    name : str = ""
    email : str
    password : str
    roll : str = ""
    role : Role = Role.student

class Login(BaseModel):
    email : str
    password : str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    password: str


class StudentPreviewRequest(BaseModel):
    email: str

class QuestionPaper(BaseModel):
    id : Optional[int] = None
    questions : dict
    answers : dict
    creator_id : int

class Exam(BaseModel):
    id : Optional[int] = None
    created_at : Optional[datetime] = None
    name : str
    total_marks : int
    start : datetime
    end : datetime
    creator_id : int
    questionpaper_id : int
    join_window : Optional[int] = None  # minutes after start; None = no limit
    max_warnings : Optional[int] = 3
    allowed_sections: Optional[list[str]] = None
    release_after_exam: Optional[bool] = False

class Response(BaseModel):
    id : Optional[int] = None
    submitted_at: Optional[datetime] = None
    exam_id : int
    user_id : int
    response : dict

class Heartbeat(BaseModel):
    exam_id: int
    response: Optional[dict] = None  # optional full snapshot (sent periodically)
    response_delta: Optional[list[dict]] = None  # changed answers since last ping
    events: Optional[list[dict]] = None
    warning_count: Optional[int] = None

class Submit(BaseModel):
    exam_id: int
    response: dict  # final answers on exam end / manual submit


class FlagQuestionRequest(BaseModel):
    question_id: int
    why_wrong: str
    expected_answer: str
    correct_option: str


class AnswerFlaggedQuestionRequest(BaseModel):
    answer: str

class RetakeRequest(BaseModel):
    user_id: int

class Session(BaseModel):
    user_id : int
    expiry : datetime
    token : str

#REDUNDANT
# class ClientVersion(BaseModel):
#     id: Optional[int] = None
#     version: str  # e.g., "1.0.1"
#     required: bool = True  # If true, clients must update
#     installer_url: str  # GitHub release URL to download client installer
#     app_url: str  # GitHub release URL to app files (ZIP)
#     release_notes: Optional[str] = None
#     created_at: Optional[datetime] = None
#     is_active: bool = True  # Current active version
# past system used supabase cus i didnt know about github releases
# current system implements github releases