"use client";

import { useEffect, useMemo, useState } from "react";
import { getCookie } from "cookies-next";
import Link from "next/link";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { API } from "@/lib/config";

type StudentQuery = {
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

export default function StudentQueriesPage() {
  const [loading, setLoading] = useState(true);
  const [queries, setQueries] = useState<StudentQuery[]>([]);
  const [summary, setSummary] = useState<QuerySummary>({ total: 0, pending: 0, answered: 0 });
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const pendingQueries = useMemo(() => queries.filter((q) => q.status === "pending"), [queries]);
  const answeredQueries = useMemo(() => queries.filter((q) => q.status === "answered"), [queries]);

  useEffect(() => {
    const load = async () => {
      const token = getCookie("wfl-session") as string | undefined;
      if (!token) {
        setLoading(false);
        return;
      }

      const res = await fetch(`${API}/response/queries/my`, {
        headers: { "x-session-token": token },
        cache: "no-store",
      }).catch(() => null);

      if (!res?.ok) {
        setLoading(false);
        return;
      }

      const body = await res.json();
      const list = (body.queries ?? []) as StudentQuery[];
      setQueries(list);
      setSummary((body.summary ?? { total: 0, pending: 0, answered: 0 }) as QuerySummary);
      setLoading(false);
    };

    void load();
  }, []);

  const toggle = (id: number) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
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
      <div className="px-8 py-10 space-y-8">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
          <p className="text-xs uppercase tracking-wider text-zinc-500">My Queries</p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Question review requests</h1>
          <p className="mt-2 text-sm text-zinc-400">Track the status of your flagged questions and faculty responses.</p>

          <div className="mt-5 grid grid-cols-3 gap-3">
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
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-500">No pending queries.</div>
          ) : (
            pendingQueries.map((q) => (
              <div key={q.id} className="rounded-xl border border-zinc-800 bg-zinc-900/30">
                <button
                  type="button"
                  onClick={() => toggle(q.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-800/30"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span className="rounded border border-zinc-700 px-2 py-0.5">{q.exam_name || "Exam"}</span>
                      <span>Q{q.question_id ?? "-"}</span>
                      <span>Raised {fmtDateTime(q.created_at)}</span>
                    </div>
                    <p className="mt-1 truncate text-sm text-zinc-300">{q.why_wrong || "-"}</p>
                  </div>
                  {expanded[q.id] ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
                  )}
                </button>

                {expanded[q.id] && (
                  <div className="space-y-3 border-t border-zinc-800 px-4 py-3">
                    <div className="space-y-1 text-sm">
                      <p className="text-zinc-400">Why you flagged:</p>
                      <p className="whitespace-pre-wrap text-zinc-200">{q.why_wrong || "-"}</p>
                    </div>
                    <div className="space-y-1 text-sm">
                      <p className="text-zinc-400">Your expected answer:</p>
                      <p className="whitespace-pre-wrap text-zinc-200">{q.expected_answer || "-"}</p>
                    </div>
                    <div className="space-y-1 text-sm">
                      <p className="text-zinc-400">Your selected option in exam:</p>
                      <p className="text-zinc-200">{q.student_marked_option || "Not answered"}</p>
                    </div>
                    <div className="space-y-1 text-sm">
                      <p className="text-zinc-400">Status:</p>
                      <p className="text-amber-300">Awaiting faculty response</p>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-200">Answered Queries</h2>
          {answeredQueries.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-500">No answered queries yet.</div>
          ) : (
            answeredQueries.map((q) => (
              <div key={q.id} className="rounded-xl border border-zinc-800 bg-zinc-900/30">
                <button
                  type="button"
                  onClick={() => toggle(q.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-800/30"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span className="rounded border border-zinc-700 px-2 py-0.5">{q.exam_name || "Exam"}</span>
                      <span>Q{q.question_id ?? "-"}</span>
                      <span>Answered {fmtDateTime(q.answered_at)}</span>
                    </div>
                    <p className="mt-1 truncate text-sm text-zinc-300">{q.faculty_response || "-"}</p>
                  </div>
                  {expanded[q.id] ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
                  )}
                </button>

                {expanded[q.id] && (
                  <div className="space-y-3 border-t border-zinc-800 px-4 py-3">
                    <div className="space-y-1 text-sm">
                      <p className="text-zinc-400">Why you flagged:</p>
                      <p className="whitespace-pre-wrap text-zinc-200">{q.why_wrong || "-"}</p>
                    </div>
                    <div className="space-y-1 text-sm">
                      <p className="text-zinc-400">Faculty response:</p>
                      <p className="whitespace-pre-wrap text-zinc-200">{q.faculty_response || "-"}</p>
                    </div>
                    {q.answer_key_corrected && (
                      <div className="space-y-1 text-sm">
                        <p className="text-zinc-400">Answer key update:</p>
                        <p className="text-emerald-300">Updated{q.corrected_option ? ` to option ${q.corrected_option}` : ""}</p>
                      </div>
                    )}
                    {q.response_id ? (
                      <div>
                        <Link href={`/history/${q.response_id}`} className="text-xs text-yellow-400 hover:text-yellow-300">
                          Open response review
                        </Link>
                      </div>
                    ) : null}
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
