"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getCookie } from "cookies-next";
import { ArrowLeft, Flag, Loader2, X } from "lucide-react";
import { API } from "@/lib/config";

type OptionValue = string | { text: string; image_url?: string };

type ReviewQuestion = {
  question_id: number;
  text: string;
  image_url?: string;
  options: OptionValue[];
  marks: number;
  negative_marks: number;
  correct_option: number | null;
  chosen_option: number | null;
  marked: boolean;
  is_correct: boolean;
};

type ReviewSection = {
  section_id: number;
  name: string;
  questions: ReviewQuestion[];
};

type ReviewResponse = {
  id: number;
  submitted_at: string;
  exam_id: number;
  exam_name: string;
  score: number;
  total_marks: number;
  percentage: number;
  sections: ReviewSection[];
};

function optionText(opt: OptionValue): string {
  return typeof opt === "string" ? opt : (opt.text ?? "");
}

function optionImage(opt: OptionValue): string | undefined {
  return typeof opt === "string" ? undefined : opt.image_url;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function scoreBadgeClass(pct: number): string {
  if (pct >= 70) return "border-emerald-700/60 bg-emerald-950/20 text-emerald-300";
  if (pct >= 50) return "border-yellow-700/60 bg-yellow-950/20 text-yellow-300";
  return "border-red-700/60 bg-red-950/20 text-red-300";
}

export default function ResponseDetailPage() {
  const params = useParams<{ responseId: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [activeQuestionId, setActiveQuestionId] = useState<number | null>(null);
  const [mobilePaletteOpen, setMobilePaletteOpen] = useState(false);
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [flagSubmitting, setFlagSubmitting] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [flagForm, setFlagForm] = useState({
    whyWrong: "",
    expectedAnswer: "",
    correctOption: "",
  });

  useEffect(() => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) {
      router.replace("/login");
      return;
    }

    const responseId = Number(params.responseId);
    if (!Number.isFinite(responseId)) {
      setError("Invalid response id.");
      setLoading(false);
      return;
    }

    fetch(`${API}/response/my/${responseId}`, {
      headers: { "x-session-token": token },
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.detail ?? "Failed to load response.");
        }
        return r.json();
      })
      .then((payload) => {
        const response = payload.response as ReviewResponse;
        setData(response);
        const first = response.sections.flatMap((s) => s.questions)[0];
        setActiveQuestionId(first?.question_id ?? null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load response.");
      })
      .finally(() => setLoading(false));
  }, [params.responseId, router]);

  const flatQuestions = useMemo(() => data?.sections.flatMap((s) => s.questions) ?? [], [data]);
  const activeQuestion = useMemo(
    () => flatQuestions.find((q) => q.question_id === activeQuestionId) ?? null,
    [flatQuestions, activeQuestionId],
  );

  const submitFlag = async () => {
    if (!activeQuestion) return;

    const whyWrong = flagForm.whyWrong.trim();
    const expectedAnswer = flagForm.expectedAnswer.trim();
    const correctOption = flagForm.correctOption.trim().toUpperCase();

    if (!whyWrong || !expectedAnswer || !correctOption) {
      setFlagError("Please fill all fields before submitting.");
      return;
    }

    const token = getCookie("wfl-session") as string | undefined;
    if (!token) {
      router.replace("/login");
      return;
    }

    setFlagSubmitting(true);
    setFlagError(null);

    const responseId = Number(params.responseId);
    const res = await fetch(`${API}/response/my/${responseId}/flag-question`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session-token": token,
      },
      body: JSON.stringify({
        question_id: activeQuestion.question_id,
        why_wrong: whyWrong,
        expected_answer: expectedAnswer,
        correct_option: correctOption,
      }),
    }).catch(() => null);

    setFlagSubmitting(false);

    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      setFlagError(body?.detail ?? "Failed to submit flag.");
      return;
    }

    setShowFlagModal(false);
    setFlagForm({ whyWrong: "", expectedAnswer: "", correctOption: "" });
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-zinc-400">{error ?? "Could not load response."}</p>
        <Link href="/history" className="text-xs text-yellow-400 hover:text-yellow-300">
          Back to history
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-zinc-950 text-zinc-100">
      {showFlagModal && activeQuestion && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-zinc-950/90 px-6">
          <div className="w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-100">Flag Question {flatQuestions.findIndex((q) => q.question_id === activeQuestion.question_id) + 1}</h2>
              <button
                type="button"
                onClick={() => {
                  if (flagSubmitting) return;
                  setShowFlagModal(false);
                  setFlagError(null);
                }}
                className="rounded-md border border-zinc-700 p-1.5 text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-zinc-400">1. Why is this wrong</label>
                <textarea
                  value={flagForm.whyWrong}
                  onChange={(e) => setFlagForm((prev) => ({ ...prev, whyWrong: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-yellow-500"
                  placeholder="Explain why this evaluated result seems incorrect"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-zinc-400">2. What would the correct answer be</label>
                <textarea
                  value={flagForm.expectedAnswer}
                  onChange={(e) => setFlagForm((prev) => ({ ...prev, expectedAnswer: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-yellow-500"
                  placeholder="Describe your expected/correct answer"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-zinc-400">3. Correct option (A, B, C, D)</label>
                <select
                  value={flagForm.correctOption}
                  onChange={(e) => setFlagForm((prev) => ({ ...prev, correctOption: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-yellow-500"
                >
                  <option value="">Select option</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                  <option value="D">D</option>
                </select>
              </div>

              {flagError && <p className="text-xs text-red-400">{flagError}</p>}

              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (flagSubmitting) return;
                    setShowFlagModal(false);
                    setFlagError(null);
                  }}
                  className="rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-200 transition hover:border-zinc-500"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void submitFlag()}
                  disabled={flagSubmitting}
                  className="rounded-md bg-yellow-400 px-3 py-2 text-xs font-semibold text-zinc-900 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {flagSubmitting ? "Submitting..." : "Submit flag"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center gap-2 sm:gap-3 border-b border-zinc-800 bg-zinc-900/60 px-3 py-3 sm:px-5">
          <Link
            href="/history"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition hover:text-zinc-200"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <div className="hidden h-5 w-px bg-zinc-800 sm:block" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-zinc-100">{data.exam_name}</h1>
            <p className="text-xs text-zinc-500">Submitted {fmtDateTime(data.submitted_at)}</p>
          </div>
          {activeQuestion && (
            <button
              type="button"
              onClick={() => {
                setFlagError(null);
                setShowFlagModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-700/70 bg-amber-950/20 px-2.5 py-1 text-xs font-medium text-amber-300 transition hover:border-amber-600"
            >
              <Flag className="h-3.5 w-3.5" /> Flag question
            </button>
          )}
          <div className={`rounded-md border px-2 py-1 text-xs font-medium ${scoreBadgeClass(data.percentage)}`}>
            {data.score} / {data.total_marks} ({data.percentage}%)
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <section className="min-w-0 flex-1 overflow-y-auto p-3 sm:p-6">
            <div className="mb-3 md:hidden">
              <button
                type="button"
                onClick={() => setMobilePaletteOpen(true)}
                className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300"
              >
                Question Nav
              </button>
            </div>
            {!activeQuestion ? (
              <p className="text-sm text-zinc-500">No questions found in this response.</p>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
                  <p className="text-sm text-zinc-500">Question {flatQuestions.findIndex((q) => q.question_id === activeQuestion.question_id) + 1}</p>
                  <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-zinc-100">{activeQuestion.text}</p>
                  {activeQuestion.image_url && (
                    <img
                      src={activeQuestion.image_url}
                      alt="question"
                      className="mt-4 max-h-80 rounded-lg border border-zinc-800 object-contain"
                    />
                  )}
                </div>

                <div className="space-y-2.5">
                  {activeQuestion.options.map((opt, idx) => {
                    const isCorrect = idx === activeQuestion.correct_option;
                    const isChosen = idx === activeQuestion.chosen_option;
                    const isWrongChosen = isChosen && !activeQuestion.is_correct;

                    const optionClass = isWrongChosen
                      ? "border-red-700/70 bg-red-950/20"
                      : isCorrect
                        ? "border-emerald-700/70 bg-emerald-950/20"
                        : isChosen
                          ? "border-yellow-700/70 bg-yellow-950/20"
                          : "border-zinc-800 bg-zinc-900/30";

                    return (
                      <div key={idx} className={`w-full rounded-xl border p-4 ${optionClass}`}>
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md bg-zinc-800 text-xs font-semibold text-zinc-300">
                            {String.fromCharCode(65 + idx)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{optionText(opt)}</p>
                            {optionImage(opt) && (
                              <img
                                src={optionImage(opt)}
                                alt={`option-${idx + 1}`}
                                className="mt-3 max-h-64 rounded-md border border-zinc-800 object-contain"
                              />
                            )}
                            <div className="mt-2 flex flex-wrap gap-2">
                              {isCorrect && <span className="rounded border border-emerald-700/60 bg-emerald-950/20 px-2 py-0.5 text-[11px] text-emerald-300">Correct answer</span>}
                              {isChosen && <span className="rounded border border-sky-700/60 bg-sky-950/20 px-2 py-0.5 text-[11px] text-sky-300">Your answer</span>}
                              {isWrongChosen && <span className="rounded border border-red-700/60 bg-red-950/20 px-2 py-0.5 text-[11px] text-red-300">Wrong answer</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <aside className="hidden shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-900/30 p-4 md:block lg:w-72">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Question palette</p>
            <div className="space-y-4">
              {data.sections.map((section) => (
                <div key={section.section_id} className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{section.name}</p>
                  <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                    {section.questions.map((q, idx) => {
                      const displayNum = data.sections
                        .flatMap((s) => s.questions)
                        .findIndex((x) => x.question_id === q.question_id) + 1;

                      const stateClass = q.chosen_option === null
                        ? "border-zinc-700 bg-zinc-900 text-zinc-400"
                        : q.is_correct
                          ? "border-emerald-700/60 bg-emerald-950/25 text-emerald-300"
                          : "border-red-700/60 bg-red-950/25 text-red-300";

                      const activeClass = q.question_id === activeQuestionId
                        ? " ring-2 ring-yellow-500 ring-offset-1 ring-offset-zinc-950"
                        : "";

                      return (
                        <button
                          key={`${section.section_id}-${idx}`}
                          type="button"
                          onClick={() => setActiveQuestionId(q.question_id)}
                          className={`h-9 rounded-lg border text-xs font-medium transition-colors ${stateClass}${activeClass}`}
                        >
                          {displayNum}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 space-y-1.5 text-[11px] text-zinc-500">
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" />Correct</div>
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-red-500" />Wrong</div>
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-zinc-600" />Not answered</div>
            </div>
          </aside>

          {mobilePaletteOpen && (
            <div className="fixed inset-0 z-50 bg-zinc-950/80 md:hidden">
              <aside className="absolute inset-y-0 right-0 w-[86vw] max-w-sm overflow-y-auto border-l border-zinc-800 bg-zinc-900 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Question Nav</p>
                  <button
                    type="button"
                    onClick={() => setMobilePaletteOpen(false)}
                    className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300"
                  >
                    Close
                  </button>
                </div>
                <div className="space-y-4">
                  {data.sections.map((section) => (
                    <div key={section.section_id} className="space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{section.name}</p>
                      <div className="grid grid-cols-4 gap-1.5">
                        {section.questions.map((q, idx) => {
                          const displayNum = data.sections
                            .flatMap((s) => s.questions)
                            .findIndex((x) => x.question_id === q.question_id) + 1;

                          const stateClass = q.chosen_option === null
                            ? "border-zinc-700 bg-zinc-900 text-zinc-400"
                            : q.is_correct
                              ? "border-emerald-700/60 bg-emerald-950/25 text-emerald-300"
                              : "border-red-700/60 bg-red-950/25 text-red-300";

                          const activeClass = q.question_id === activeQuestionId
                            ? " ring-2 ring-yellow-500 ring-offset-1 ring-offset-zinc-950"
                            : "";

                          return (
                            <button
                              key={`${section.section_id}-${idx}`}
                              type="button"
                              onClick={() => {
                                setActiveQuestionId(q.question_id);
                                setMobilePaletteOpen(false);
                              }}
                              className={`h-9 rounded-lg border text-xs font-medium transition-colors ${stateClass}${activeClass}`}
                            >
                              {displayNum}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 space-y-1.5 text-[11px] text-zinc-500">
                  <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" />Correct</div>
                  <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-red-500" />Wrong</div>
                  <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-zinc-600" />Not answered</div>
                </div>
              </aside>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
