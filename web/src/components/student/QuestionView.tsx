"use client";
/* eslint-disable @next/next/no-img-element */

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
  answerText,
  onChoose,
  onAnswerText,
  disabled = false,
}: {
  question: ExamQuestion;
  selected: number | null;
  answerText?: string;
  onChoose: (idx: number) => void;
  onAnswerText?: (text: string) => void;
  disabled?: boolean;
}) {
  const qType = question.question_type || "MCQ";
  const renderOptions = qType !== "FIB";
  const visibleOptions = qType === "TOF" ? question.options.slice(0, 2) : question.options;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <p className="text-sm text-zinc-500 select-none">Question {question.question_id}</p>
        <p className="mt-2 whitespace-pre-wrap text-base text-zinc-100 leading-relaxed select-none">{question.text}</p>
        {question.image_url && (
          <img
            src={question.image_url}
            alt="question"
            className="mt-4 max-h-80 rounded-lg border border-zinc-800 object-contain"
          />
        )}
      </div>

      {qType === "FIB" ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-zinc-500">Your Answer</label>
          <input
            type="text"
            value={answerText ?? ""}
            disabled={disabled}
            onChange={(e) => onAnswerText?.(e.target.value)}
            placeholder="Type your answer"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-yellow-500 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
      ) : null}

      {renderOptions ? (
        <div className="space-y-2.5">
        {visibleOptions.map((opt, idx) => {
          const active = selected === idx;
          const image = optImage(opt);
          return (
            <button
              key={idx}
              type="button"
              disabled={disabled}
              tabIndex={disabled ? -1 : 0}
              onClick={() => onChoose(idx)}
              className={`w-full rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${active ? "border-yellow-600/70 bg-yellow-950/20" : "border-zinc-800 bg-zinc-900/30 hover:border-zinc-700"}`}
            >
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold ${active ? "bg-yellow-500 text-zinc-900" : "bg-zinc-800 text-zinc-300"}`}>
                  {String.fromCharCode(65 + idx)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed select-none">{optText(opt)}</p>
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
      ) : null}
    </div>
  );
}
