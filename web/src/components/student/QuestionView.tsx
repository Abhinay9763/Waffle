"use client";

import { ExamQuestion, OptionValue } from "@/components/student/types";

function optText(opt: string | OptionValue) {
  return typeof opt === "string" ? opt : opt.text;
}

function optImage(opt: string | OptionValue) {
  return typeof opt === "string" ? undefined : opt.image_url;
}

export default function QuestionView({
  question,
  selected,
  onChoose,
}: {
  question: ExamQuestion;
  selected: number | null;
  onChoose: (idx: number) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <p className="text-sm text-zinc-500 select-none">Question {question.question_id}</p>
        <p className="mt-2 text-base text-zinc-100 leading-relaxed select-none">{question.text}</p>
        {question.image_url && (
          <img
            src={question.image_url}
            alt="question"
            className="mt-4 max-h-80 rounded-lg border border-zinc-800 object-contain"
          />
        )}
      </div>

      <div className="space-y-2.5">
        {question.options.map((opt, idx) => {
          const active = selected === idx;
          const image = optImage(opt);
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onChoose(idx)}
              className={`w-full rounded-xl border p-4 text-left transition-colors ${active ? "border-yellow-600/70 bg-yellow-950/20" : "border-zinc-800 bg-zinc-900/30 hover:border-zinc-700"}`}
            >
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold ${active ? "bg-yellow-500 text-zinc-900" : "bg-zinc-800 text-zinc-300"}`}>
                  {String.fromCharCode(65 + idx)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-200 leading-relaxed select-none">{optText(opt)}</p>
                  {image && (
                    <img
                      src={image}
                      alt={`option-${idx + 1}`}
                      className="mt-3 max-h-64 rounded-md border border-zinc-800 object-contain"
                    />
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
