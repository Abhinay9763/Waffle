"use client";

import { useEffect, useMemo, useState } from "react";
import { getCookie } from "cookies-next";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/lib/config";

type QueryItem = {
  id: number;
  response_id: number | null;
  exam_id: number | null;
  exam_name: string;
  question_id: number | null;
  why_wrong: string;
  expected_answer: string;
  student_correct_option: string;
  student_marked_option: string;
  faculty_response: string;
  status: "pending" | "answered";
  answered_at?: string | null;
  answer_key_corrected?: boolean;
  corrected_option?: string;
  created_at?: string | null;
  student_name: string;
  student_roll: string;
};

type QuerySummary = {
  total: number;
  pending: number;
  answered: number;
};

function fmtDateTime(iso?: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function FacultyQueriesPage() {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [queries, setQueries] = useState<QueryItem[]>([]);
  const [summary, setSummary] = useState<QuerySummary>({ total: 0, pending: 0, answered: 0 });
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [expandedAnswered, setExpandedAnswered] = useState<Record<number, boolean>>({});
  const [applyCorrection, setApplyCorrection] = useState<Record<number, boolean>>({});
  const [useStudentMarkedOption, setUseStudentMarkedOption] = useState<Record<number, boolean>>({});
  const [correctedOption, setCorrectedOption] = useState<Record<number, string>>({});

  const pendingQueries = useMemo(() => queries.filter((q) => q.status === "pending"), [queries]);
  const answeredQueries = useMemo(() => queries.filter((q) => q.status === "answered"), [queries]);

  const loadQueries = async () => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) {
      setLoading(false);
      return;
    }

    const res = await fetch(`${API}/response/queries/my-faculty`, {
      headers: { "x-session-token": token },
      cache: "no-store",
    }).catch(() => null);

    if (!res?.ok) {
      setLoading(false);
      return;
    }

    const body = await res.json();
    const list = (body.queries ?? []) as QueryItem[];
    setQueries(list);
    setSummary((body.summary ?? { total: 0, pending: 0, answered: 0 }) as QuerySummary);
    setDrafts(
      Object.fromEntries(
        list.map((q) => [q.id, q.faculty_response ?? ""]),
      ),
    );
    setApplyCorrection(Object.fromEntries(list.map((q) => [q.id, false])));
    setUseStudentMarkedOption(Object.fromEntries(list.map((q) => [q.id, true])));
    setCorrectedOption(Object.fromEntries(list.map((q) => [q.id, ""])));
    setLoading(false);
  };

  useEffect(() => {
    void loadQueries();
  }, []);

  const toggleAnswered = (id: number) => {
    setExpandedAnswered((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const submitAnswer = async (query: QueryItem) => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) return;

    const answer = (drafts[query.id] ?? "").trim();
    if (!answer) {
      toast.error("Please write an answer before submitting.");
      return;
    }

    setSavingId(query.id);
    const res = await fetch(`${API}/response/queries/${query.id}/answer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session-token": token,
      },
      body: JSON.stringify({
        answer,
        apply_key_correction: !!applyCorrection[query.id],
        use_student_marked_option: !!useStudentMarkedOption[query.id],
        corrected_option: correctedOption[query.id] || null,
      }),
    }).catch(() => null);
    setSavingId(null);

    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      toast.error(body?.detail ?? "Failed to submit answer.");
      return;
    }

    toast.success("Answer sent to student query.");
    await loadQueries();
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-6 sm:px-8 sm:py-10 space-y-8">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Question Queries</p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Student query inbox</h1>
          <p className="mt-2 text-sm text-zinc-400">Review flagged questions and send clarifications.</p>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <p className="text-xs text-zinc-500">Total</p>
              <p className="mt-1 text-xl font-semibold text-zinc-100">{summary.total}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <p className="text-xs text-zinc-500">Pending</p>
              <p className="mt-1 text-xl font-semibold text-amber-300">{summary.pending}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <p className="text-xs text-zinc-500">Answered</p>
              <p className="mt-1 text-xl font-semibold text-emerald-300">{summary.answered}</p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-200">Pending Queries</h2>
          {pendingQueries.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-500">
              No pending queries.
            </div>
          ) : (
            pendingQueries.map((q) => (
              <div key={q.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="rounded border border-zinc-700 px-2 py-0.5">{q.exam_name || "Exam"}</span>
                  <span>Q{q.question_id ?? "-"}</span>
                  <span>{q.student_name} ({q.student_roll || "-"})</span>
                  <span>{fmtDateTime(q.created_at)}</span>
                </div>

                <div className="space-y-1 text-sm">
                  <p className="text-zinc-400">Why student flagged:</p>
                  <p className="whitespace-pre-wrap text-zinc-200">{q.why_wrong || "-"}</p>
                </div>

                <div className="space-y-1 text-sm">
                  <p className="text-zinc-400">Student expected answer:</p>
                  <p className="whitespace-pre-wrap text-zinc-200">{q.expected_answer || "-"}</p>
                </div>

                <div className="space-y-1 text-sm">
                  <p className="text-zinc-400">Student suggested correct option:</p>
                  <p className="text-zinc-200">{q.student_correct_option || "-"}</p>
                </div>

                <div className="space-y-1 text-sm">
                  <p className="text-zinc-400">Student marked option in exam:</p>
                  <p className="text-zinc-200">{q.student_marked_option || "Not answered"}</p>
                </div>

                <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <label className="flex items-center gap-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={!!applyCorrection[q.id]}
                      onChange={(e) => setApplyCorrection((prev) => ({ ...prev, [q.id]: e.target.checked }))}
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-yellow-500"
                    />
                    Update official answer key (scores update automatically)
                  </label>

                  {applyCorrection[q.id] && (
                    <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5">
                      <label className="flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={!!useStudentMarkedOption[q.id]}
                          onChange={(e) => setUseStudentMarkedOption((prev) => ({ ...prev, [q.id]: e.target.checked }))}
                          className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-yellow-500"
                        />
                        Use student marked option ({q.student_marked_option || "N/A"}) as corrected answer
                      </label>

                      <div className="flex items-center gap-2">
                        <label className="text-xs text-zinc-400">Or choose corrected option:</label>
                        <select
                          value={correctedOption[q.id] ?? ""}
                          onChange={(e) => setCorrectedOption((prev) => ({ ...prev, [q.id]: e.target.value }))}
                          disabled={!!useStudentMarkedOption[q.id]}
                          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 disabled:opacity-50"
                        >
                          <option value="">Select</option>
                          <option value="A">A</option>
                          <option value="B">B</option>
                          <option value="C">C</option>
                          <option value="D">D</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-zinc-400">Your response</label>
                  <textarea
                    value={drafts[q.id] ?? ""}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                    rows={4}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-yellow-500"
                    placeholder="Write your clarification/correction for the student"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => void submitAnswer(q)}
                    disabled={savingId === q.id}
                    className="rounded-lg bg-yellow-400 px-3 py-2 text-xs font-medium text-zinc-900 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingId === q.id ? "Submitting..." : "Submit answer"}
                  </button>
                </div>
              </div>
            ))
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-200">Answered Queries</h2>
          {answeredQueries.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-500">
              No answered queries yet.
            </div>
          ) : (
            answeredQueries.slice(0, 20).map((q) => (
              <div key={q.id} className="rounded-xl border border-zinc-800 bg-zinc-900/30">
                <button
                  type="button"
                  onClick={() => toggleAnswered(q.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-800/30"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span className="rounded border border-zinc-700 px-2 py-0.5">{q.exam_name || "Exam"}</span>
                      <span>Q{q.question_id ?? "-"}</span>
                      <span>{q.student_name} ({q.student_roll || "-"})</span>
                      <span>Answered {fmtDateTime(q.answered_at)}</span>
                    </div>
                    <p className="mt-1 truncate text-sm text-zinc-300">{q.faculty_response}</p>
                  </div>

                  {expandedAnswered[q.id] ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
                  )}
                </button>

                {expandedAnswered[q.id] && (
                  <div className="space-y-3 border-t border-zinc-800 px-4 py-3">
                    <div className="space-y-1 text-sm">
                      <p className="text-zinc-400">Why student flagged:</p>
                      <p className="whitespace-pre-wrap text-zinc-200">{q.why_wrong || "-"}</p>
                    </div>

                    <div className="space-y-1 text-sm">
                      <p className="text-zinc-400">Student expected answer:</p>
                      <p className="whitespace-pre-wrap text-zinc-200">{q.expected_answer || "-"}</p>
                    </div>

                    <div className="space-y-1 text-sm">
                      <p className="text-zinc-400">Student marked correct option:</p>
                      <p className="text-zinc-200">{q.student_correct_option || "-"}</p>
                    </div>

                    <div className="space-y-1 text-sm">
                      <p className="text-zinc-400">Student marked option in exam:</p>
                      <p className="text-zinc-200">{q.student_marked_option || "Not answered"}</p>
                    </div>

                    <div className="space-y-1 text-sm">
                      <p className="text-zinc-400">Faculty response:</p>
                      <p className="whitespace-pre-wrap text-zinc-200">{q.faculty_response || "-"}</p>
                    </div>

                    {q.answer_key_corrected && (
                      <div className="space-y-1 text-sm">
                        <p className="text-zinc-400">Answer key corrected:</p>
                        <p className="text-emerald-300">Yes{q.corrected_option ? ` · Correct option: ${q.corrected_option}` : ""}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
