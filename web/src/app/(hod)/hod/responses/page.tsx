"use client";

import { useEffect, useState } from "react";
import { getCookie } from "cookies-next";
import Link from "next/link";
import { CalendarDays, ChevronRight, Loader2, Plus, Radio } from "lucide-react";
import { API } from "@/lib/config";

interface Exam {
  id: number;
  name: string;
  total_marks: number;
  start: string;
  end: string;
}

type ExamStatus = "upcoming" | "live" | "ended";

function getStatus(startIso: string, endIso: string): ExamStatus {
  const now = Date.now();
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();

  if (now < start) return "upcoming";
  if (now > end) return "ended";
  return "live";
}

function timeUntil(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "now";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)} days`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
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
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-10 space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-zinc-100">Exam Results</h1>
          <p className="text-sm text-zinc-500">Review responses by exam</p>
        </div>

        {exams.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <p className="text-zinc-500 text-sm">No exams found yet.</p>
            <Link
              href="/hod/exams/new"
              className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 text-zinc-900 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" /> Schedule an exam
            </Link>
          </div>
        ) : (
          (() => {
            const live = exams.filter((e) => getStatus(e.start, e.end) === "live");
            const upcoming = exams.filter((e) => getStatus(e.start, e.end) === "upcoming");
            const ended = exams.filter((e) => getStatus(e.start, e.end) === "ended");

            const sections = [
              { title: "Live", items: live },
              { title: "Upcoming", items: upcoming },
              { title: "Ended", items: ended },
            ].filter((s) => s.items.length > 0);

            return sections.map((section) => (
              <section key={section.title} className="space-y-2">
                <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  {section.title}
                </div>
                <div className="rounded-xl border border-zinc-800 overflow-hidden divide-y divide-zinc-800/60">
                  {section.items.map((exam) => {
                    const status = getStatus(exam.start, exam.end);
                    const statusClasses =
                      status === "live"
                        ? "text-emerald-400 bg-emerald-950/40 border-emerald-800/50"
                        : status === "upcoming"
                        ? "text-sky-400 bg-sky-950/40 border-sky-800/50"
                        : "text-zinc-500 bg-zinc-800/40 border-zinc-700/50";
                    const statusLabel =
                      status === "live" ? "Live" : status === "upcoming" ? "Upcoming" : "Ended";

                    return (
                      <div key={exam.id} className="flex items-center gap-4 px-4 py-3.5 hover:bg-zinc-800/30 transition-colors">
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <p className="text-sm font-medium text-zinc-200 truncate">{exam.name}</p>
                          <div className="flex items-center gap-3 text-xs text-zinc-600">
                            <span className="flex items-center gap-1">
                              <CalendarDays className="w-3 h-3" />
                              {new Date(exam.start).toLocaleString("en-IN", {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            <span>{exam.total_marks} marks</span>
                            {status === "live" && <span className="text-emerald-600">ends in {timeUntil(exam.end)}</span>}
                            {status === "upcoming" && <span>in {timeUntil(exam.start)}</span>}
                          </div>
                        </div>

                        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${statusClasses}`}>
                          {statusLabel}
                        </span>

                        {status === "live" && (
                          <Link
                            href={`/hod/exams/${exam.id}/live`}
                            className="shrink-0 flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-800/50 hover:border-emerald-700 px-2.5 py-1 rounded-lg transition-colors"
                          >
                            <Radio className="w-3 h-3" />
                            Control Centre
                          </Link>
                        )}

                        <Link
                          href={`/hod/responses/${exam.id}`}
                          className="shrink-0 flex items-center gap-1 text-xs text-zinc-500 hover:text-yellow-400 border border-zinc-700 hover:border-yellow-600 px-2.5 py-1 rounded-lg transition-colors"
                        >
                          {status === "live" ? "Live view" : "Results"}
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </section>
            ));
          })()
        )}
      </div>
    </div>
  );
}
