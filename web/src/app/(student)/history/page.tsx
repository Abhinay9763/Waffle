"use client";

import { useState, useEffect } from "react";
import { getCookie } from "cookies-next";
import { Loader2 } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface MyResponse {
  id: number;
  submitted_at: string;
  exam_id: number;
  exam_name: string;
  exam_start: string;
  score: number;
  total_marks: number;
  percentage: number;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function PctBadge({ pct }: { pct: number }) {
  const cls =
    pct >= 70 ? "text-emerald-400 bg-emerald-950/40 border-emerald-800/50" :
    pct >= 50 ? "text-yellow-400 bg-yellow-950/40 border-yellow-800/50" :
                "text-red-400 bg-red-950/40 border-red-800/50";
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded border tabular-nums ${cls}`}>
      {pct}%
    </span>
  );
}

export default function HistoryPage() {
  const [responses, setResponses] = useState<MyResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) { setLoading(false); return; }

    fetch(`${API}/response/my`, { headers: { "x-session-token": token } })
      .then((r) => (r.ok ? r.json() : { responses: [] }))
      .then((d) => setResponses(d.responses ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
      </div>
    );
  }

  if (responses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
        <p className="text-zinc-300 text-sm font-medium">No results yet</p>
        <p className="text-zinc-600 text-xs">Your exam submissions will appear here.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">

        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-zinc-100">My Results</h1>
          <p className="text-sm text-zinc-500">{responses.length} exam{responses.length !== 1 ? "s" : ""} taken</p>
        </div>

        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500">Exam</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 hidden sm:table-cell">Date</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500">Score</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500">Grade</th>
              </tr>
            </thead>
            <tbody>
              {responses.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-800/20 transition-colors"
                >
                  <td className="px-4 py-3 text-zinc-200 font-medium">{r.exam_name}</td>
                  <td className="px-4 py-3 text-zinc-500 text-xs hidden sm:table-cell">
                    {fmtDate(r.submitted_at)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className="text-zinc-100 font-medium">{r.score}</span>
                    <span className="text-zinc-600"> / {r.total_marks}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PctBadge pct={r.percentage} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
