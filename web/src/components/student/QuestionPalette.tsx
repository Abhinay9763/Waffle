"use client";

import { ExamSection, QuestionResponse } from "@/components/student/types";

function buttonClass(active: boolean, state: "answered" | "marked" | "both" | "empty") {
  const base = "h-9 rounded-lg border text-xs font-medium transition-colors";
  const map = {
    answered: "border-emerald-700/60 bg-emerald-950/25 text-emerald-300",
    marked: "border-amber-700/60 bg-amber-950/25 text-amber-300",
    both: "border-yellow-700/60 bg-yellow-950/25 text-yellow-300",
    empty: "border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200",
  };
  const ring = active ? " ring-2 ring-yellow-500 ring-offset-1 ring-offset-zinc-950" : "";
  return `${base} ${map[state]}${ring}`;
}

export default function QuestionPalette({
  sections,
  activeId,
  responses,
  onSelect,
}: {
  sections: ExamSection[];
  activeId: number;
  responses: Record<number, QuestionResponse>;
  onSelect: (questionId: number) => void;
}) {
  let displayNumber = 0;

  return (
    <aside className="w-64 shrink-0 border-l border-zinc-800 bg-zinc-900/30 p-4 overflow-y-auto">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Question palette</p>
      <div className="space-y-4">
        {sections.map((section) => (
          <div key={section.section_id} className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{section.name}</p>
            <div className="grid grid-cols-5 gap-1.5">
              {section.questions.map((question) => {
                displayNumber += 1;
                const r = responses[question.question_id];
                const state = r
                  ? r.marked && r.option !== null
                    ? "both"
                    : r.marked
                      ? "marked"
                      : r.option !== null
                        ? "answered"
                        : "empty"
                  : "empty";
                return (
                  <button
                    key={question.question_id}
                    type="button"
                    onClick={() => onSelect(question.question_id)}
                    className={buttonClass(question.question_id === activeId, state)}
                  >
                    {displayNumber}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 space-y-1.5 text-[11px] text-zinc-500">
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500" />Answered</div>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500" />Marked</div>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-yellow-500" />Answered + Marked</div>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-zinc-600" />Empty</div>
      </div>
    </aside>
  );
}
