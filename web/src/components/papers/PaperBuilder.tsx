"use client";

import { useReducer, useRef, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Plus, Trash2, ChevronLeft, ChevronRight,
  Save, X, GripVertical, Loader2, Copy, Lock, Mic,
} from "lucide-react";
import { getCookie } from "cookies-next";
import { API } from "@/lib/config";

// ── Types ──────────────────────────────────────────────────────────────────────

interface BuilderQuestion {
  question_id: number;
  text: string;
  options: [string, string, string, string];
  correct_option: number | null;
  marks: number;
  negative_marks: number;
}

interface BuilderSection {
  section_id: number;
  name: string;
  questions: BuilderQuestion[];
}

interface BuilderState {
  examName: string;
  sections: BuilderSection[];
  activeId: number | null;
  _nextQId: number;
  _nextSId: number;
}

type Action =
  | { type: "SET_NAME"; name: string }
  | { type: "GO_TO"; id: number }
  | { type: "PREV" }
  | { type: "NEXT" }
  | { type: "ADD_SECTION" }
  | { type: "REMOVE_SECTION"; sectionId: number }
  | { type: "UPDATE_SECTION_NAME"; sectionId: number; name: string }
  | { type: "ADD_QUESTION"; sectionId: number }
  | { type: "REMOVE_QUESTION" }
  | { type: "UPDATE_Q_TEXT"; text: string }
  | { type: "UPDATE_OPTION"; idx: number; text: string }
  | { type: "SET_CORRECT"; idx: number }
  | { type: "UPDATE_MARKS"; marks: number }
  | { type: "UPDATE_NEG_MARKS"; neg: number };

// ── Helpers ────────────────────────────────────────────────────────────────────

function flatQuestions(sections: BuilderSection[]) {
  return sections.flatMap(s => s.questions);
}

function findQuestion(sections: BuilderSection[], id: number): BuilderQuestion | null {
  for (const s of sections) {
    const q = s.questions.find(q => q.question_id === id);
    if (q) return q;
  }
  return null;
}

function findSectionForQ(sections: BuilderSection[], qId: number): BuilderSection | null {
  return sections.find(s => s.questions.some(q => q.question_id === qId)) ?? null;
}

function getDisplayIndex(sections: BuilderSection[], qId: number): number {
  let i = 1;
  for (const s of sections) {
    for (const q of s.questions) {
      if (q.question_id === qId) return i;
      i++;
    }
  }
  return -1;
}

function questionStatus(q: BuilderQuestion): "complete" | "partial" | "empty" {
  const hasText = q.text.trim().length > 0;
  const allOpts = q.options.every(o => o.trim().length > 0);
  const hasCorrect = q.correct_option !== null;
  if (hasText && allOpts && hasCorrect) return "complete";
  if (hasText || q.options.some(o => o.trim().length > 0)) return "partial";
  return "empty";
}

function makeQ(id: number): BuilderQuestion {
  return { question_id: id, text: "", options: ["", "", "", ""], correct_option: null, marks: 1, negative_marks: 0 };
}

// ── Reducer ────────────────────────────────────────────────────────────────────

function reducer(state: BuilderState, action: Action): BuilderState {
  const flat = flatQuestions(state.sections);

  switch (action.type) {
    case "SET_NAME":
      return { ...state, examName: action.name };

    case "GO_TO":
      return { ...state, activeId: action.id };

    case "PREV": {
      if (!state.activeId || flat.length === 0) return state;
      const idx = flat.findIndex(q => q.question_id === state.activeId);
      return { ...state, activeId: flat[(idx - 1 + flat.length) % flat.length].question_id };
    }

    case "NEXT": {
      if (!state.activeId || flat.length === 0) return state;
      const idx = flat.findIndex(q => q.question_id === state.activeId);
      return { ...state, activeId: flat[(idx + 1) % flat.length].question_id };
    }

    case "ADD_SECTION": {
      const qId = state._nextQId;
      const sId = state._nextSId;
      const label = String.fromCharCode(64 + sId);
      return {
        ...state,
        sections: [
          ...state.sections,
          { section_id: sId, name: `Section ${label}`, questions: [makeQ(qId)] },
        ],
        activeId: qId,
        _nextQId: qId + 1,
        _nextSId: sId + 1,
      };
    }

    case "REMOVE_SECTION": {
      if (state.sections.length <= 1) return state;
      const newSections = state.sections.filter(s => s.section_id !== action.sectionId);
      const newFlat = newSections.flatMap(s => s.questions);
      return { ...state, sections: newSections, activeId: newFlat[0]?.question_id ?? null };
    }

    case "UPDATE_SECTION_NAME":
      return {
        ...state,
        sections: state.sections.map(s =>
          s.section_id === action.sectionId ? { ...s, name: action.name } : s
        ),
      };

    case "ADD_QUESTION": {
      const qId = state._nextQId;
      return {
        ...state,
        sections: state.sections.map(s =>
          s.section_id === action.sectionId ? { ...s, questions: [...s.questions, makeQ(qId)] } : s
        ),
        activeId: qId,
        _nextQId: qId + 1,
      };
    }

    case "REMOVE_QUESTION": {
      if (!state.activeId || flat.length <= 1) return state;
      const idx = flat.findIndex(q => q.question_id === state.activeId);
      const newFlat = flat.filter(q => q.question_id !== state.activeId);
      const newActive = newFlat[Math.min(idx, newFlat.length - 1)].question_id;
      return {
        ...state,
        sections: state.sections
          .map(s => ({ ...s, questions: s.questions.filter(q => q.question_id !== state.activeId) }))
          .filter(s => s.questions.length > 0),
        activeId: newActive,
      };
    }

    case "UPDATE_Q_TEXT":
      return updateQ(state, q => ({ ...q, text: action.text }));

    case "UPDATE_OPTION":
      return updateQ(state, q => {
        const opts = [...q.options] as [string, string, string, string];
        opts[action.idx] = action.text;
        return { ...q, options: opts };
      });

    case "SET_CORRECT":
      return updateQ(state, q => ({
        ...q, correct_option: q.correct_option === action.idx ? null : action.idx,
      }));

    case "UPDATE_MARKS":
      return updateQ(state, q => ({ ...q, marks: action.marks }));

    case "UPDATE_NEG_MARKS":
      return updateQ(state, q => ({ ...q, negative_marks: action.neg }));

    default:
      return state;
  }
}

function updateQ(state: BuilderState, fn: (q: BuilderQuestion) => BuilderQuestion): BuilderState {
  if (!state.activeId) return state;
  const id = state.activeId;
  return {
    ...state,
    sections: state.sections.map(s => ({
      ...s, questions: s.questions.map(q => q.question_id === id ? fn(q) : q),
    })),
  };
}

const INIT: BuilderState = {
  examName: "",
  sections: [{ section_id: 1, name: "Section A", questions: [makeQ(1)] }],
  activeId: 1,
  _nextQId: 2,
  _nextSId: 2,
};

// ── Props and initial state builder ───────────────────────────────────────────

interface InitialPaperData {
  examName: string;
  sections: BuilderSection[];
  answers: Record<string, number>;
}

interface PaperBuilderProps {
  paperId?: number;
  initialData?: InitialPaperData;
  inUse?: boolean;
}

function buildInitialState(initialData?: InitialPaperData): BuilderState {
  if (!initialData) return INIT;
  const sections: BuilderSection[] = initialData.sections.map(s => ({
    ...s,
    questions: s.questions.map(q => ({
      ...q,
      options: q.options as [string, string, string, string],
      correct_option: initialData.answers[String(q.question_id)] ?? null,
    })),
  }));
  const allQIds = sections.flatMap(s => s.questions.map(q => q.question_id));
  const allSIds = sections.map(s => s.section_id);
  return {
    examName: initialData.examName,
    sections,
    activeId: sections[0]?.questions[0]?.question_id ?? null,
    _nextQId: (allQIds.length > 0 ? Math.max(...allQIds) : 0) + 1,
    _nextSId: (allSIds.length > 0 ? Math.max(...allSIds) : 0) + 1,
  };
}

// ── Option row ─────────────────────────────────────────────────────────────────

function OptionRow({
  letter, value, isCorrect, onChange, onMarkCorrect, readonly, optIdx,
}: {
  letter: string; value: string; isCorrect: boolean; readonly?: boolean;
  onChange: (v: string) => void; onMarkCorrect: () => void; optIdx: number;
}) {
  return (
    <div
      className={`
        flex items-start gap-3 rounded-xl border px-4 py-3 transition-all
        ${isCorrect
          ? "border-emerald-700/70 bg-emerald-950/25"
          : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700/80"}
      `}
    >
      <span className={`
        shrink-0 w-7 h-7 mt-0.5 rounded-md flex items-center justify-center
        text-xs font-bold transition-colors
        ${isCorrect ? "bg-emerald-700/40 text-emerald-300" : "bg-zinc-800 text-zinc-400"}
      `}>
        {letter}
      </span>

      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={`Option ${letter}`}
        rows={1}
        readOnly={readonly}
        data-stt-field={`option-${optIdx}`}
        onInput={e => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight}px`;
        }}
        className="flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 resize-none outline-none leading-relaxed min-h-[28px] read-only:cursor-default"
      />

      <button
        type="button"
        onClick={onMarkCorrect}
        disabled={readonly}
        title={isCorrect ? "Correct answer" : "Mark as correct"}
        className={`
          shrink-0 w-5 h-5 mt-0.5 rounded-full border-2 flex items-center justify-center transition-all
          ${isCorrect ? "border-emerald-500 bg-emerald-500" : "border-zinc-600 hover:border-zinc-400"}
          disabled:cursor-default
        `}
      >
        {isCorrect && <span className="w-2 h-2 rounded-full bg-white block" />}
      </button>
    </div>
  );
}

// ── Question editor ────────────────────────────────────────────────────────────

function QuestionEditor({
  q, displayIdx, total, dispatch, readonly,
}: {
  q: BuilderQuestion; displayIdx: number; total: number;
  dispatch: React.Dispatch<Action>; readonly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-7 flex-1 overflow-y-auto p-8">

      {/* Question number */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-zinc-600 uppercase tracking-widest">
            Question {displayIdx} of {total}
          </span>
          {!readonly && questionStatus(q) === "complete" && (
            <span className="text-[10px] font-medium text-emerald-500 border border-emerald-800/50 bg-emerald-950/30 rounded px-1.5 py-0.5">
              Complete
            </span>
          )}
          {!readonly && questionStatus(q) === "partial" && (
            <span className="text-[10px] font-medium text-amber-500 border border-amber-800/50 bg-amber-950/30 rounded px-1.5 py-0.5">
              Incomplete
            </span>
          )}
        </div>

        {/* Question text */}
        <textarea
          value={q.text}
          onChange={e => dispatch({ type: "UPDATE_Q_TEXT", text: e.target.value })}
          placeholder="Type the question here…"
          rows={3}
          readOnly={readonly}
          data-stt-field="question"
          className="
            w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-5 py-4
            text-lg text-zinc-100 placeholder:text-zinc-700 placeholder:text-base
            resize-none outline-none leading-relaxed
            focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-colors
            read-only:cursor-default read-only:focus:border-zinc-800 read-only:focus:ring-0
          "
          onInput={e => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
        />
      </div>

      {/* Options */}
      <div className="space-y-2.5">
        <p className="text-xs font-medium text-zinc-600 uppercase tracking-widest">
          {readonly ? "Options" : "Options — click circle to mark correct"}
        </p>
        {(["A", "B", "C", "D"] as const).map((letter, idx) => (
          <OptionRow
            key={idx}
            optIdx={idx}
            letter={letter}
            value={q.options[idx]}
            isCorrect={q.correct_option === idx}
            onChange={text => dispatch({ type: "UPDATE_OPTION", idx, text })}
            onMarkCorrect={() => dispatch({ type: "SET_CORRECT", idx })}
            readonly={readonly}
          />
        ))}
      </div>

      {/* Marks */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <label className="text-sm text-zinc-500 whitespace-nowrap">Marks</label>
          <input
            type="number"
            min={0}
            value={q.marks}
            readOnly={readonly}
            onChange={e => dispatch({ type: "UPDATE_MARKS", marks: Number(e.target.value) })}
            className="
              w-20 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5
              text-sm text-zinc-200 text-center outline-none
              focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-colors
              read-only:cursor-default read-only:focus:border-zinc-800 read-only:focus:ring-0
            "
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-zinc-500 whitespace-nowrap">Negative marks</label>
          <input
            type="number"
            min={0}
            step={0.25}
            value={q.negative_marks}
            readOnly={readonly}
            onChange={e => dispatch({ type: "UPDATE_NEG_MARKS", neg: Number(e.target.value) })}
            className="
              w-20 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5
              text-sm text-zinc-200 text-center outline-none
              focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-colors
              read-only:cursor-default read-only:focus:border-zinc-800 read-only:focus:ring-0
            "
          />
        </div>
      </div>

    </div>
  );
}

// ── Nav panel ──────────────────────────────────────────────────────────────────

const STATUS_STYLE = {
  complete: "border-emerald-700/70 bg-emerald-950/25 text-emerald-400",
  partial:  "border-amber-700/60  bg-amber-950/20   text-amber-400",
  empty:    "border-zinc-800       bg-zinc-900        text-zinc-500",
};

function NavPanel({
  sections, activeId, totalQ, dispatch, readonly,
}: {
  sections: BuilderSection[]; activeId: number | null; totalQ: number;
  dispatch: React.Dispatch<Action>; readonly?: boolean;
}) {
  let palIdx = 0;

  return (
    <aside className="w-64 shrink-0 border-l border-zinc-800 flex flex-col bg-zinc-900/30">

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {sections.map(section => (
          <div key={section.section_id}>

            {/* Section header */}
            <div className="flex items-center gap-1.5 mb-2.5">
              <GripVertical className="w-3.5 h-3.5 text-zinc-700 shrink-0" />
              <input
                value={section.name}
                readOnly={readonly}
                onChange={e => dispatch({ type: "UPDATE_SECTION_NAME", sectionId: section.section_id, name: e.target.value })}
                className="
                  flex-1 bg-transparent text-xs font-semibold text-zinc-400
                  uppercase tracking-wider outline-none border-b border-transparent
                  hover:border-zinc-700 focus:border-yellow-500 focus:text-zinc-200
                  pb-0.5 transition-colors read-only:hover:border-transparent
                  read-only:cursor-default read-only:focus:border-transparent
                "
              />
              {!readonly && sections.length > 1 && (
                <button
                  type="button"
                  onClick={() => dispatch({ type: "REMOVE_SECTION", sectionId: section.section_id })}
                  className="shrink-0 text-zinc-700 hover:text-red-400 transition-colors"
                  title="Remove section"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Question palette */}
            <div className="grid grid-cols-5 gap-1.5">
              {section.questions.map(q => {
                palIdx++;
                const num = palIdx;
                const status = questionStatus(q);
                const isActive = q.question_id === activeId;
                return (
                  <button
                    key={q.question_id}
                    type="button"
                    onClick={() => dispatch({ type: "GO_TO", id: q.question_id })}
                    className={`
                      h-9 rounded-lg border text-xs font-medium transition-all
                      ${STATUS_STYLE[status]}
                      ${isActive ? "ring-2 ring-yellow-500 ring-offset-1 ring-offset-zinc-950 border-transparent" : ""}
                    `}
                  >
                    {num}
                  </button>
                );
              })}

              {/* Add question — hidden in readonly */}
              {!readonly && (
                <button
                  type="button"
                  onClick={() => dispatch({ type: "ADD_QUESTION", sectionId: section.section_id })}
                  className="h-9 rounded-lg border border-dashed border-zinc-700 text-zinc-600 hover:border-yellow-600 hover:text-yellow-400 transition-colors flex items-center justify-center"
                  title="Add question to this section"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="px-4 py-3 border-t border-zinc-800 space-y-1.5">
        {[
          { label: "Complete",   color: "bg-emerald-500" },
          { label: "Incomplete", color: "bg-amber-500" },
          { label: "Empty",      color: "bg-zinc-600" },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-2 text-[11px] text-zinc-600">
            <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
            {label}
          </div>
        ))}
      </div>

      {/* Add section — hidden in readonly */}
      {!readonly && (
        <div className="px-3 pb-3 shrink-0">
          <button
            type="button"
            onClick={() => dispatch({ type: "ADD_SECTION" })}
            className="
              w-full flex items-center justify-center gap-2
              border border-dashed border-zinc-700 rounded-lg py-2
              text-xs text-zinc-500 hover:text-yellow-400 hover:border-yellow-600
              transition-colors
            "
          >
            <Plus className="w-3.5 h-3.5" />
            Add section
          </button>
        </div>
      )}

    </aside>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PaperBuilder({ paperId, initialData, inUse = false }: PaperBuilderProps = {}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, initialData, buildInitialState);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);

  // ── Speech-to-text ──────────────────────────────────────────────────────
  const [sttActive, setSttActive] = useState(false);
  const [sttSupported, setSttSupported] = useState(true);
  const [sttError, setSttError] = useState<string | null>(null);
  const srRef = useRef<any>(null);
  const capturedFocus = useRef<{ field: string; start: number; end: number; val: string } | null>(null);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) setSttSupported(false);
  }, []);

  const toggleSTT = () => {
    if (sttActive) { srRef.current?.stop(); setSttActive(false); return; }
    setSttError(null);
    let el = document.activeElement as HTMLTextAreaElement;
    if (!el?.dataset?.sttField) {
      el = document.querySelector("[data-stt-field=\"question\"]") as HTMLTextAreaElement;
    }
    const field = el?.dataset?.sttField;
    if (!field) return;
    capturedFocus.current = {
      field,
      start: el.selectionStart ?? el.value.length,
      end:   el.selectionEnd   ?? el.value.length,
      val:   el.value,
    };
    // Fresh instance every time — reusing a spent recognition fires onend immediately
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const r = new SR();
    r.continuous = false;
    r.interimResults = false;
    r.lang = "en-IN";
    r.onresult = (e: any) => {
      const transcript: string = e.results[0][0].transcript;
      const c = capturedFocus.current;
      if (c) {
        const newVal = c.val.slice(0, c.start) + transcript + " " + c.val.slice(c.end);
        if (c.field === "question") {
          dispatch({ type: "UPDATE_Q_TEXT", text: newVal });
        } else if (c.field.startsWith("option-")) {
          dispatch({ type: "UPDATE_OPTION", idx: +c.field.split("-")[1], text: newVal });
        }
        capturedFocus.current = null;
      }
      setSttActive(false);
    };
    r.onerror = (e: any) => { setSttError(e.error ?? "error"); setSttActive(false); };
    r.onend   = () => setSttActive(false);
    srRef.current = r;
    try { r.start(); setSttActive(true); } catch { setSttActive(false); }
  };
  // ── End speech-to-text ──────────────────────────────────────────────────

  const flat = flatQuestions(state.sections);
  const activeQ = state.activeId ? findQuestion(state.sections, state.activeId) : null;
  const activeSection = state.activeId ? findSectionForQ(state.sections, state.activeId) : null;
  const displayIdx = state.activeId ? getDisplayIndex(state.sections, state.activeId) : 0;
  const totalQ = flat.length;
  const totalS = state.sections.length;

  const buildPayload = () => {
    const totalMarks = flat.reduce((sum, q) => sum + q.marks, 0);
    const questions = {
      meta: { exam_name: state.examName, total_marks: totalMarks },
      sections: state.sections.map(s => ({
        section_id: s.section_id,
        name: s.name,
        questions: s.questions.map(q => ({
          question_id: q.question_id,
          text: q.text,
          options: q.options,
          marks: q.marks,
          negative_marks: q.negative_marks,
        })),
      })),
    };
    const answers: Record<number, number> = {};
    for (const q of flat) {
      if (q.correct_option !== null) answers[q.question_id] = q.correct_option;
    }
    return { questions, answers };
  };

  const handleSave = async () => {
    setSaveError(null);
    if (!state.examName.trim()) { setSaveError("Please enter a paper name."); return; }
    const incomplete = flat.filter(q => questionStatus(q) !== "complete");
    if (incomplete.length > 0) { setSaveError(`${incomplete.length} question(s) are incomplete.`); return; }

    const token = getCookie("wfl-session") as string | undefined;
    setSaving(true);

    const isEdit = paperId !== undefined;
    const res = await fetch(
      isEdit ? `${API}/paper/${paperId}` : `${API}/paper/create`,
      {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "x-session-token": token ?? "" },
        body: JSON.stringify({ ...buildPayload(), creator_id: 0 }),
      }
    ).catch(() => null);
    setSaving(false);

    if (!res || !res.ok) {
      const err = await res?.json().catch(() => ({})) ?? {};
      setSaveError(err.detail ?? "Failed to save paper.");
      return;
    }
    router.push("/papers");
  };

  const handleClone = async () => {
    if (!paperId) return;
    const token = getCookie("wfl-session") as string | undefined;
    setCloning(true);
    const res = await fetch(`${API}/paper/${paperId}/clone`, {
      method: "POST",
      headers: { "x-session-token": token ?? "" },
    }).catch(() => null);
    setCloning(false);
    if (!res || !res.ok) { setSaveError("Failed to clone paper."); return; }
    router.push("/papers");
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950">

      {/* ── Header ──────────────────────────────────────────── */}
      <header className="flex items-center gap-4 px-5 h-14 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
        <Link
          href="/papers"
          className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 transition-colors text-sm shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          Papers
        </Link>

        <div className="h-5 w-px bg-zinc-800 shrink-0" />

        <input
          value={state.examName}
          onChange={e => dispatch({ type: "SET_NAME", name: e.target.value })}
          readOnly={inUse}
          placeholder="Untitled paper"
          className="flex-1 bg-transparent text-sm font-medium text-zinc-200 placeholder:text-zinc-600 outline-none min-w-0 read-only:cursor-default"
        />

        <div className="flex items-center gap-3 shrink-0">
          {inUse && (
            <span className="flex items-center gap-1.5 text-xs text-amber-500 border border-amber-800/50 bg-amber-950/20 rounded-lg px-2.5 py-1">
              <Lock className="w-3 h-3" />
              In use — read only
            </span>
          )}
          <span className="text-xs text-zinc-600 tabular-nums">
            {totalQ}Q · {totalS}S
          </span>
          {saveError && (
            <span className="text-xs text-red-400">{saveError}</span>
          )}
          {paperId !== undefined && (
            <button
              type="button"
              onClick={handleClone}
              disabled={cloning}
              className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-600 transition-colors disabled:opacity-60"
            >
              {cloning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
              {cloning ? "Cloning…" : "Clone"}
            </button>
          )}
          {!inUse && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 text-zinc-900 text-xs font-medium px-3.5 py-1.5 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? "Saving…" : paperId !== undefined ? "Update paper" : "Save paper"}
            </button>
          )}
        </div>
      </header>

      {/* ── Main split ──────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {activeQ ? (
          <QuestionEditor
            q={activeQ}
            displayIdx={displayIdx}
            total={totalQ}
            dispatch={dispatch}
            readonly={inUse}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-700 text-sm">
            No question selected
          </div>
        )}

        <NavPanel
          sections={state.sections}
          activeId={state.activeId}
          totalQ={totalQ}
          dispatch={dispatch}
          readonly={inUse}
        />

      </div>

      {/* ── Bottom bar ──────────────────────────────────────── */}
      <footer className="flex items-center justify-between px-5 h-14 border-t border-zinc-800 bg-zinc-900/50 shrink-0">

        <div className="flex items-center gap-2">
          {!inUse && (
            <>
              <button
                type="button"
                onClick={() => dispatch({ type: "REMOVE_QUESTION" })}
                disabled={totalQ <= 1}
                className="
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                  text-zinc-500 hover:text-red-400 hover:bg-red-950/40
                  border border-transparent hover:border-red-900/50
                  disabled:opacity-30 disabled:cursor-not-allowed transition-colors
                "
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>

              <button
                type="button"
                onClick={() => activeSection && dispatch({ type: "ADD_QUESTION", sectionId: activeSection.section_id })}
                className="
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                  text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800
                  border border-zinc-800 hover:border-zinc-700
                  transition-colors
                "
              >
                <Plus className="w-3.5 h-3.5" />
                Add question
              </button>

              {sttSupported && (
                <>
                  <div className="w-px h-5 bg-zinc-800 shrink-0" />
                  <button
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={toggleSTT}
                    disabled={!!sttError}
                    title={sttActive ? "Click to stop" : "Click a text field, then click to dictate"}
                    className={`
                      flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors
                      ${sttActive
                        ? "text-yellow-400 border-yellow-700/60 bg-yellow-950/30 hover:bg-yellow-950/50"
                        : sttError
                          ? "text-zinc-600 border-zinc-800 cursor-not-allowed"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border-zinc-800 hover:border-zinc-700"}
                    `}
                  >
                    <Mic className="w-3.5 h-3.5" />
                    {sttError
                      ? <>Try <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-500 font-mono text-[10px]">Win+H</kbd></>
                      : sttActive ? "Listening…" : "Dictate"}
                  </button>
                </>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => dispatch({ type: "PREV" })}
            disabled={totalQ <= 1}
            className="
              flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
              text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800
              border border-zinc-800 hover:border-zinc-700
              disabled:opacity-30 disabled:cursor-not-allowed transition-colors
            "
          >
            <ChevronLeft className="w-4 h-4" />
            Prev
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "NEXT" })}
            disabled={totalQ <= 1}
            className="
              flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
              text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800
              border border-zinc-800 hover:border-zinc-700
              disabled:opacity-30 disabled:cursor-not-allowed transition-colors
            "
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

      </footer>

    </div>
  );
}
