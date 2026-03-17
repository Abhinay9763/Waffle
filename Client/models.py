from pydantic import BaseModel, field_validator
from datetime import datetime

class OptionValue(BaseModel):
    text: str = ""
    image_url: str | None = None

class Question(BaseModel):
    question_id : int
    text : str
    image_url : str | None = None
    options : list[OptionValue]
    correct_option : int = -1  # not sent to client; server scores server-side
    marks : int
    negative_marks : int

    @field_validator("options", mode="before")
    @classmethod
    def coerce_options(cls, v):
        return [{"text": o} if isinstance(o, str) else o for o in v]

class Section(BaseModel):
    section_id : int
    name : str
    questions : list[Question]

class Meta(BaseModel):
    exam_id : int = 0
    exam_name : str
    student_roll : str | None = None
    start_time : datetime
    end_time : datetime
    total_marks : int

class Exam(BaseModel):
    meta : Meta
    sections : list[Section]

class QuestionResponse(BaseModel):
    question_id: int
    option : int | None = None
    marked : bool = False

class Submission(BaseModel):
    student_roll :str
    responses : list[QuestionResponse]


