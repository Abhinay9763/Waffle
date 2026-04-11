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
  disabled = false,
  mobileOpen = false,
  onMobileClose,
}: {
  sections: ExamSection[];
  activeId: number;
  responses: Record<number, QuestionResponse>;
  onSelect: (questionId: number) => void;
  disabled?: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  let displayNumber = 0;

  const content = (
    <>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Question palette</p>
      <div className="space-y-4">
        {sections.map((section) => (
          <div key={section.section_id} className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{section.name}</p>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
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
                    disabled={disabled}
                    tabIndex={disabled ? -1 : 0}
                    onClick={() => onSelect(question.question_id)}
                    className={`${buttonClass(question.question_id === activeId, state)} disabled:cursor-not-allowed disabled:opacity-60`}
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
    </>
  );

  return (
    <>
      <aside className="hidden md:block w-64 shrink-0 border-l border-zinc-800 bg-zinc-900/30 p-4 overflow-y-auto">
        {content}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 bg-zinc-950/80 md:hidden">
          <div className="absolute inset-y-0 right-0 w-[86vw] max-w-sm border-l border-zinc-800 bg-zinc-900 p-4 overflow-y-auto">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Question Nav</p>
              <button
                type="button"
                onClick={onMobileClose}
                className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300"
              >
                Close
              </button>
            </div>
            {content}
          </div>
        </div>
      )}
    </>
  );
}
