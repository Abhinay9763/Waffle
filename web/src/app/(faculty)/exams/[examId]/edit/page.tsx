"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getCookie } from "cookies-next";
import { Loader2 } from "lucide-react";
import ExamScheduleForm from "@/components/exams/ExamScheduleForm";
import { API } from "@/lib/config";

type ExamPayload = {
  id: number;
  name: string;
  questionpaper_id: number;
  start: string;
  end: string;
  max_warnings?: number;
  allowed_sections?: string[];
  join_window?: number | null;
  release_after_exam?: boolean;
  can_modify?: boolean;
};

export default function EditExamPage() {
  const params = useParams<{ examId: string }>();
  const examId = Number(params?.examId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exam, setExam] = useState<ExamPayload | null>(null);

  useEffect(() => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) {
      setError("Session expired. Please sign in again.");
      setLoading(false);
      return;
    }
    if (!Number.isFinite(examId) || examId <= 0) {
      setError("Invalid exam id.");
      setLoading(false);
      return;
    }

    fetch(`${API}/exam/${examId}/detail`, { headers: { "x-session-token": token } })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || "Failed to load exam.");
        }
        return res.json();
      })
      .then((data) => {
        const loaded = data.exam as ExamPayload | undefined;
        if (!loaded) {
          throw new Error("Exam not found.");
        }
        setExam(loaded);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "Failed to load exam.";
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, [examId]);

  const blocked = useMemo(() => exam && exam.can_modify === false, [exam]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-red-900/50 bg-red-950/30 p-5">
          <p className="text-sm text-red-300">{error}</p>
          <Link href="/exams" className="mt-3 inline-block text-xs text-zinc-300 hover:text-zinc-100">
            Back to exams
          </Link>
        </div>
      </div>
    );
  }

  if (!exam) {
    return null;
  }

  if (blocked) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h1 className="text-base font-medium text-zinc-100">Exam can no longer be modified</h1>
          <p className="mt-2 text-sm text-zinc-400">Only upcoming exams can be modified.</p>
          <Link href="/exams" className="mt-3 inline-block text-xs text-zinc-300 hover:text-zinc-100">
            Back to exams
          </Link>
        </div>
      </div>
    );
  }

  return (
    <ExamScheduleForm
      mode="edit"
      examId={examId}
      initialData={{
        name: exam.name,
        questionpaper_id: exam.questionpaper_id,
        start: exam.start,
        end: exam.end,
        max_warnings: exam.max_warnings,
        allowed_sections: exam.allowed_sections ?? [],
        join_window: exam.join_window ?? undefined,
        release_after_exam: !!exam.release_after_exam,
      }}
    />
  );
}
