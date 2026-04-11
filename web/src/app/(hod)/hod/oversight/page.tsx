"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getCookie } from "cookies-next";
import { CalendarDays, FileText, Loader2, Users } from "lucide-react";
import { API } from "@/lib/config";

interface FacultyListResponse {
  faculty: Array<{ id: number }>;
}

interface PendingFacultyResponse {
  pending_faculty: Array<{ id: number }>;
}

interface Exam {
  id: number;
  start: string;
  end: string;
}

interface ExamListResponse {
  exams: Exam[];
}

interface PaperListResponse {
  papers: Array<{ id: number }>;
}

function statusOf(start: string, end: string): "upcoming" | "live" | "ended" {
  const now = Date.now();
  if (now < new Date(start).getTime()) return "upcoming";
  if (now <= new Date(end).getTime()) return "live";
  return "ended";
}

export default function HODOversightPage() {
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [approvedCount, setApprovedCount] = useState(0);
  const [examCount, setExamCount] = useState(0);
  const [paperCount, setPaperCount] = useState(0);
  const [liveExamCount, setLiveExamCount] = useState(0);

  useEffect(() => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) {
      setLoading(false);
      return;
    }

    Promise.all([
      fetch(`${API}/hod/pending-faculty`, { headers: { "x-session-token": token } })
        .then((r) => (r.ok ? r.json() : { pending_faculty: [] } as PendingFacultyResponse))
        .catch(() => ({ pending_faculty: [] } as PendingFacultyResponse)),
      fetch(`${API}/hod/faculty`, { headers: { "x-session-token": token } })
        .then((r) => (r.ok ? r.json() : { faculty: [] } as FacultyListResponse))
        .catch(() => ({ faculty: [] } as FacultyListResponse)),
      fetch(`${API}/exam/list`, { headers: { "x-session-token": token } })
        .then((r) => (r.ok ? r.json() : { exams: [] } as ExamListResponse))
        .catch(() => ({ exams: [] } as ExamListResponse)),
      fetch(`${API}/paper/list`, { headers: { "x-session-token": token } })
        .then((r) => (r.ok ? r.json() : { papers: [] } as PaperListResponse))
        .catch(() => ({ papers: [] } as PaperListResponse)),
    ])
      .then(([pendingData, approvedData, examData, paperData]) => {
        setPendingCount(pendingData.pending_faculty?.length ?? 0);
        setApprovedCount(approvedData.faculty?.length ?? 0);
        const exams: Exam[] = examData.exams ?? [];
        setExamCount(exams.length);
        setLiveExamCount(exams.filter((e) => statusOf(e.start, e.end) === "live").length);
        setPaperCount(paperData.papers?.length ?? 0);
      })
      .finally(() => setLoading(false));
  }, []);

  const statCards = useMemo(
    () => [
      {
        label: "Pending Faculty",
        value: pendingCount,
        helper: "Needs approval",
        icon: Users,
        tone: "text-amber-400 border-amber-800/50 bg-amber-950/30",
      },
      {
        label: "Approved Faculty",
        value: approvedCount,
        helper: "Active members",
        icon: Users,
        tone: "text-emerald-400 border-emerald-800/50 bg-emerald-950/30",
      },
      {
        label: "Question Papers",
        value: paperCount,
        helper: "Total papers",
        icon: FileText,
        tone: "text-sky-400 border-sky-800/50 bg-sky-950/30",
      },
      {
        label: "Scheduled Exams",
        value: examCount,
        helper: `${liveExamCount} live right now`,
        icon: CalendarDays,
        tone: "text-violet-400 border-violet-800/50 bg-violet-950/30",
      },
    ],
    [pendingCount, approvedCount, paperCount, examCount, liveExamCount]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-6 sm:px-8 sm:py-10 space-y-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-zinc-100">System Oversight</h1>
          <p className="text-sm text-zinc-500">High-level operational view across faculty, papers, and exams.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {statCards.map((card) => (
            <div key={card.label} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-zinc-500">{card.label}</p>
                <div className={`rounded-md border px-2 py-1 ${card.tone}`}>
                  <card.icon className="w-4 h-4" />
                </div>
              </div>
              <p className="mt-3 text-2xl font-semibold text-zinc-100">{card.value}</p>
              <p className="mt-1 text-xs text-zinc-500">{card.helper}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
          <h2 className="text-sm font-medium text-zinc-200">Quick Actions</h2>
          <div className="flex flex-wrap gap-2">
            <Link href="/approvals" className="px-3 py-1.5 rounded-lg text-xs border border-amber-800/50 text-amber-300 hover:bg-amber-950/30 transition-colors">
              Review Approvals
            </Link>
            <Link href="/hod/faculty" className="px-3 py-1.5 rounded-lg text-xs border border-emerald-800/50 text-emerald-300 hover:bg-emerald-950/30 transition-colors">
              Faculty Management
            </Link>
            <Link href="/exams" className="px-3 py-1.5 rounded-lg text-xs border border-sky-800/50 text-sky-300 hover:bg-sky-950/30 transition-colors">
              View Exams
            </Link>
            <Link href="/responses" className="px-3 py-1.5 rounded-lg text-xs border border-violet-800/50 text-violet-300 hover:bg-violet-950/30 transition-colors">
              View Results
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
