"use client";

import { useEffect, useState } from "react";
import { getCookie } from "cookies-next";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { API } from "@/lib/config";

type HodSolvedQuery = {
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
  answered_at?: string | null;
  answer_key_corrected?: boolean;
  corrected_option?: string;
  created_at?: string | null;
  student_name: string;
  student_roll: string;
  faculty_name: string;
  faculty_roll: string;
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

export default function HodSolvedQueriesPage() {
  const [loading, setLoading] = useState(true);
  const [queries, setQueries] = useState<HodSolvedQuery[]>([]);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const load = async () => {
      const token = getCookie("wfl-session") as string | undefined;
      if (!token) {
        setLoading(false);
        return;
      }

      const res = await fetch(`${API}/response/queries/hod-solved`, {
        headers: { "x-session-token": token },
        cache: "no-store",
      }).catch(() => null);

      if (!res?.ok) {
        setLoading(false);
        return;
      }

      const body = await res.json();
      setQueries((body.queries ?? []) as HodSolvedQuery[]);
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
      <div className="px-4 py-6 sm:px-8 sm:py-10 space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-zinc-100">Solved Question Queries</h1>
          <p className="text-sm text-zinc-500">{queries.length} solved quer{queries.length === 1 ? "y" : "ies"}</p>
        </div>

        {queries.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-500">
            No solved queries available.
          </div>
        ) : (
          <div className="space-y-3">
            {queries.map((q) => (
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
                      <span>Faculty: {q.faculty_name || "-"}</span>
                      <span>Student: {q.student_name || "-"}</span>
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
                    <div className="grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
                      <p>Faculty: {q.faculty_name || "-"} ({q.faculty_roll || "-"})</p>
                      <p>Student: {q.student_name || "-"} ({q.student_roll || "-"})</p>
                    </div>

                    <div className="space-y-1 text-sm">
                      <p className="text-zinc-400">Why student flagged:</p>
                      <p className="whitespace-pre-wrap text-zinc-200">{q.why_wrong || "-"}</p>
                    </div>

                    <div className="space-y-1 text-sm">
                      <p className="text-zinc-400">Student expected answer:</p>
                      <p className="whitespace-pre-wrap text-zinc-200">{q.expected_answer || "-"}</p>
                    </div>

                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      <div>
                        <p className="text-zinc-400">Student suggested option</p>
                        <p className="text-zinc-200">{q.student_correct_option || "-"}</p>
                      </div>
                      <div>
                        <p className="text-zinc-400">Student marked option</p>
                        <p className="text-zinc-200">{q.student_marked_option || "Not answered"}</p>
                      </div>
                    </div>

                    <div className="space-y-1 text-sm">
                      <p className="text-zinc-400">Faculty response:</p>
                      <p className="whitespace-pre-wrap text-zinc-200">{q.faculty_response || "-"}</p>
                    </div>

                    {q.answer_key_corrected && (
                      <div className="space-y-1 text-sm">
                        <p className="text-zinc-400">Answer key corrected:</p>
                        <p className="text-emerald-300">Yes{q.corrected_option ? ` · ${q.corrected_option}` : ""}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
