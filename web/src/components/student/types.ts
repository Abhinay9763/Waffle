export interface OptionValue {
  text: string;
  image_url?: string;
}

export interface ExamQuestion {
  question_id: number;
  text: string;
  image_url?: string;
  question_type?: "MCQ" | "FIB" | "TOF";
  fib_answer?: string;
  options: Array<string | OptionValue>;
  marks: number;
  negative_marks: number;
}

export interface ExamSection {
  section_id: number;
  name: string;
  questions: ExamQuestion[];
}

export interface ExamMeta {
  exam_id: number;
  exam_name: string;
  start_time: string;
  end_time: string;
  total_marks: number;
}

export interface ExamStructure {
  meta: ExamMeta;
  sections: ExamSection[];
}

export interface QuestionResponse {
  question_id: number;
  option: number | null;
  answer_text?: string;
  marked: boolean;
}
