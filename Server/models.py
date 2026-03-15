from enum import Enum
from datetime import datetime
from typing import Optional

from pydantic import BaseModel




class Role(str,Enum):
    hod = "HOD"
    faculty = "Faculty"
    student = "Student"
    admin = "Admin"

class Register(BaseModel):
    name : str
    email : str
    password : str
    roll : str
    role : Role #= Role.student

class Login(BaseModel):
    email : str
    password : str



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

class Response(BaseModel):
    id : Optional[int] = None
    submitted_at: Optional[datetime] = None
    exam_id : int
    user_id : int
    response : dict

class Heartbeat(BaseModel):
    exam_id: int
    response: dict  # full current answers snapshot — backend overwrites on each ping

class Submit(BaseModel):
    exam_id: int
    response: dict  # final answers on exam end / manual submit

class RetakeRequest(BaseModel):
    user_id: int

class Session(BaseModel):
    user_id : int
    expiry : datetime
    token : str