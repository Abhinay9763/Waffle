"use client";

import { useEffect, useState } from "react";
import { getCookie } from "cookies-next";
import Link from "next/link";
import { CalendarDays, ChevronRight, Loader2, Plus } from "lucide-react";
import { API } from "@/lib/config";

interface Exam {
  id: number;
  name: string;
  total_marks: number;
  start: string;
  end: string;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function HodResponsesPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) { setLoading(false); return; }

    fetch(`${API}/exam/list`, { headers: { "x-session-token": token } })
      .then((r) => (r.ok ? r.json() : { exams: [] }))
      .then((d) => setExams(d.exams ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-600" /></div>;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-10 space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-zinc-100">Results</h1>
          <p className="text-sm text-zinc-500">View submissions for each exam.</p>
        </div>

        {exams.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <p className="text-zinc-500 text-sm">No exams yet.</p>
            <Link
              href="/hod/exams/new"
              className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 text-zinc-900 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" /> Schedule an exam
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {exams.map((exam) => (
              <div key={exam.id} className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-zinc-800 bg-zinc-900">
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-100">{exam.name}</p>
                  <p className="text-xs text-zinc-600 flex items-center gap-1"><CalendarDays className="w-3 h-3" /> {fmtDate(exam.start)} - {fmtDate(exam.end)} · {exam.total_marks} marks</p>
                </div>
                <Link href={`/hod/responses/${exam.id}`} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 px-2.5 py-1.5 rounded-lg">
                  Results <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
