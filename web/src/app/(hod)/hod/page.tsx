"use client";

import { useEffect, useMemo, useState } from "react";
import { getCookie } from "cookies-next";
import Link from "next/link";
import { CalendarDays, FileText, Flag, Loader2, ShieldCheck, Users } from "lucide-react";
import { API } from "@/lib/config";

type DashboardStats = {
  pending_faculty: number;
  approved_faculty: number;
  question_papers: number;
  exams: number;
  live_exams: number;
  student_submissions: number;
  flagged_questions: number;
};

type DashboardExam = {
  id: number;
  name: string;
  total_marks: number;
  start: string;
  end: string;
  paper_name: string;
};

type DashboardPaper = {
  id: number;
  name: string;
  total_marks: number;
  created_at: string;
};

type DashboardData = {
  hod_name: string;
  stats: DashboardStats;
  recent_exams: DashboardExam[];
  recent_papers: DashboardPaper[];
};

function fmtDateTime(iso: string) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function todayLabel() {
  return new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function HodDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) {
      setLoading(false);
      setError("Session not found.");
      return;
    }

    fetch(`${API}/exam/hod-dashboard`, {
      headers: { "x-session-token": token },
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.detail ?? "Could not load dashboard.");
        }
        return r.json();
      })
      .then((payload) => setData(payload as DashboardData))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Could not load dashboard.");
      })
      .finally(() => setLoading(false));
  }, []);

  const statCards = useMemo(() => {
    const stats = data?.stats;
    if (!stats) return [];
    return [
      {
        label: "Pending Faculty",
        value: stats.pending_faculty,
        icon: ShieldCheck,
      },
      {
        label: "Approved Faculty",
        value: stats.approved_faculty,
        icon: Users,
      },
      {
        label: "Question Papers",
        value: stats.question_papers,
        icon: FileText,
      },
      {
        label: "Exams",
        value: stats.exams,
        icon: CalendarDays,
      },
      {
        label: "Student Submissions",
        value: stats.student_submissions,
        icon: Users,
      },
      {
        label: "Flagged Questions",
        value: stats.flagged_questions,
        icon: Flag,
      },
    ];
  }, [data]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-zinc-500">{error ?? "Failed to load dashboard."}</p>
        <div className="flex gap-2">
          <Link
            href="/approvals"
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700"
          >
            Review approvals
          </Link>
          <Link
            href="/hod/exams"
            className="rounded-lg bg-yellow-400 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-yellow-300"
          >
            View exams
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-6 sm:px-8 sm:py-10 space-y-8">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
          <p className="text-xs uppercase tracking-wider text-zinc-500">HOD Dashboard</p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Welcome back, {data.hod_name}</h1>
          <p className="mt-2 text-sm text-zinc-400">{todayLabel()}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/approvals"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700"
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Review approvals
            </Link>
            <Link
              href="/hod/exams"
              className="inline-flex items-center gap-1.5 rounded-lg bg-yellow-400 px-3 py-2 text-xs font-medium text-zinc-900 transition hover:bg-yellow-300"
            >
              <CalendarDays className="h-3.5 w-3.5" /> Monitor exams
            </Link>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {statCards.map((card) => (
            <div key={card.label} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-zinc-500">{card.label}</p>
                <card.icon className="h-4 w-4 text-zinc-600" />
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-100">{card.value}</p>
            </div>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100">Recent Exams</h2>
              <Link href="/hod/exams" className="text-xs text-zinc-400 hover:text-zinc-200">View all</Link>
            </div>
            {data.recent_exams.length === 0 ? (
              <p className="text-sm text-zinc-500">No exams scheduled yet.</p>
            ) : (
              <div className="space-y-2">
                {data.recent_exams.map((exam) => (
                  <div key={exam.id} className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5">
                    <p className="truncate text-sm font-medium text-zinc-100">{exam.name}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {fmtDateTime(exam.start)} - {fmtDateTime(exam.end)}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-600">
                      {exam.paper_name || "Paper not linked"} · {exam.total_marks} marks
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Link href={`/hod/exams/${exam.id}/live`} className="text-xs text-emerald-400 hover:text-emerald-300">Live</Link>
                      <Link href={`/hod/responses/${exam.id}`} className="text-xs text-yellow-400 hover:text-yellow-300">Responses</Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100">Recent Papers</h2>
              <Link href="/hod/papers" className="text-xs text-zinc-400 hover:text-zinc-200">View all</Link>
            </div>
            {data.recent_papers.length === 0 ? (
              <p className="text-sm text-zinc-500">No papers available yet.</p>
            ) : (
              <div className="space-y-2">
                {data.recent_papers.map((paper) => (
                  <div key={paper.id} className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5">
                    <p className="truncate text-sm font-medium text-zinc-100">{paper.name}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{paper.total_marks} marks</p>
                    <p className="mt-0.5 text-xs text-zinc-600">Created {fmtDateTime(paper.created_at)}</p>
                    <div className="mt-2 flex gap-2">
                      <Link href={`/hod/papers/${paper.id}`} className="text-xs text-sky-400 hover:text-sky-300">Open</Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}