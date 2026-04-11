"use client";

import { useState, useEffect } from "react";
import { getCookie } from "cookies-next";
import Link from "next/link";
import { ArrowLeft, Download, Loader2, Users } from "lucide-react";
import * as XLSX from "xlsx";
import { API } from "@/lib/config";

interface ResponseRow {
  id: number;
  submitted_at: string;
  student_name: string;
  student_roll: string;
  score: number;
}

interface Summary {
  submitted: number;
  avg: number;
  high: number;
  low: number;
  total_marks: number;
}

interface ExamInfo {
  name: string;
  start: string;
  end: string;
  total_marks: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function downloadExcel(
  sorted: ResponseRow[],
  exam: ExamInfo,
  summary: Summary,
) {
  const sheetData = [
    ["Exam",    exam.name],
    ["Period",  `${fmtDateTime(exam.start)} – ${fmtDateTime(exam.end)}`],
    ["Submitted", summary.submitted, "Average", summary.avg, "Top Score", summary.high, "Total Marks", summary.total_marks],
    [],
    ["#", "Roll Number", "Student Name", "Score", "Total Marks", "Percentage", "Submitted At"],
    ...sorted.map((row, i) => [
      i + 1,
      row.student_roll,
      row.student_name,
      row.score,
      summary.total_marks,
      `${Math.round((row.score / summary.total_marks) * 100)}%`,
      fmtDateTime(row.submitted_at),
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws["!cols"] = [
    { wch: 4 }, { wch: 14 }, { wch: 24 },
    { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 22 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Results");
  XLSX.writeFile(wb, `${exam.name} – Results.xlsx`);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3.5 space-y-0.5">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-2xl font-bold text-zinc-100 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-zinc-600">{sub}</p>}
    </div>
  );
}

function ScoreCell({ score, total }: { score: number; total: number }) {
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const color =
    pct >= 70 ? "text-emerald-400" : pct >= 50 ? "text-yellow-400" : "text-red-400";
  return (
    <span className={`tabular-nums font-medium ${color}`}>
      {score}
      <span className="text-zinc-600 font-normal"> / {total}</span>
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ResponsesView({ examId, basePath = "/responses" }: { examId: number; basePath?: string }) {
  const [rows, setRows] = useState<ResponseRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [exam, setExam] = useState<ExamInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) { setLoading(false); setError(true); return; }

    fetch(`${API}/exam/${examId}/responses`, {
      headers: { "x-session-token": token },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setExam(d.exam);
        setRows(d.responses);
        setSummary(d.summary);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [examId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
      </div>
    );
  }

  if (error || !exam || !summary) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
        <p className="text-zinc-500 text-sm">Failed to load responses.</p>
        <Link
          href={basePath}
          className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors"
        >
          ← Back to results
        </Link>
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) => b.score - a.score);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-10 space-y-8">

        {/* Back + header */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Link
              href={basePath}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              All results
            </Link>
            <button
              onClick={() => downloadExcel(sorted, exam, summary)}
              disabled={rows.length === 0}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" />
              Download .xlsx
            </button>
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">{exam.name}</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              {fmtDateTime(exam.start)} – {fmtDateTime(exam.end)}
            </p>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Submitted" value={summary.submitted} />
          <StatCard
            label="Average score"
            value={summary.submitted ? summary.avg : "—"}
            sub={
              summary.submitted
                ? `${Math.round((summary.avg / summary.total_marks) * 100)}%`
                : undefined
            }
          />
          <StatCard
            label="Top score"
            value={summary.submitted ? summary.high : "—"}
            sub={
              summary.submitted
                ? `${Math.round((summary.high / summary.total_marks) * 100)}%`
                : undefined
            }
          />
          <StatCard label="Total marks" value={summary.total_marks} />
        </div>

        {/* Table */}
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40 py-16 gap-3 text-center">
            <Users className="w-7 h-7 text-zinc-700" />
            <p className="text-sm text-zinc-500">No submissions yet.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900">
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 w-10">#</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500">Roll</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500">Name</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500">Score</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 hidden sm:table-cell">
                    Submitted
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => (
                  <tr
                    key={row.id}
                    className="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-800/20 transition-colors"
                  >
                    <td className="px-4 py-3 text-zinc-600 tabular-nums">{i + 1}</td>
                    <td className="px-4 py-3 text-zinc-400 font-mono text-xs">{row.student_roll}</td>
                    <td className="px-4 py-3 text-zinc-200">{row.student_name}</td>
                    <td className="px-4 py-3 text-right">
                      <ScoreCell score={row.score} total={summary.total_marks} />
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-500 text-xs tabular-nums hidden sm:table-cell">
                      {fmtDateTime(row.submitted_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  );
}
