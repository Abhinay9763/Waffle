"use client";

import { useMemo, useState } from "react";
import { setCookie } from "cookies-next";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { API } from "@/lib/config";

const ROLL_PATTERN = /^[0-9]{2}[A-Za-z][0-9]{2}[A-Za-z][0-9]{4}$/;

type StudentPreview = {
  Name: string;
  Roll: string;
  Pic: string;
  Branch: string;
};

export default function InviteLaunchPage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const token = useMemo(() => (params?.token ?? "").trim(), [params]);

  const [roll, setRoll] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingExam, setLoadingExam] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [examName, setExamName] = useState<string>("");
  const [studentPreview, setStudentPreview] = useState<StudentPreview | null>(null);
  const [confirmedRoll, setConfirmedRoll] = useState<string>("");
  const isConfirmed = !!studentPreview && confirmedRoll === String(studentPreview.Roll || "").toUpperCase();

  const validateInvite = async () => {
    if (!token) {
      setError("Invalid invite link.");
      return;
    }
    setLoadingExam(true);
    setError(null);
    const res = await fetch(`${API}/exam/invite/${encodeURIComponent(token)}`, {
      cache: "no-store",
    }).catch(() => null);
    setLoadingExam(false);

    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      setError(body?.detail ?? "Invalid or expired invite link.");
      return;
    }

    const data = await res.json().catch(() => ({}));
    setExamName(String(data?.exam?.name ?? ""));
  };

  const launchExam = async () => {
    const normalized = roll.trim().toUpperCase();
    if (!ROLL_PATTERN.test(normalized)) {
      setError("Enter roll in format like 25K81A0561.");
      return;
    }

    if (!studentPreview || confirmedRoll !== normalized) {
      await previewRoll();
      return;
    }

    setLaunching(true);
    setError(null);
    const res = await fetch(`${API}/exam/invite/${encodeURIComponent(token)}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roll: normalized }),
    }).catch(() => null);
    setLaunching(false);

    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      setError(body?.detail ?? "Could not launch exam.");
      return;
    }

    const data = await res.json().catch(() => ({}));
    const sessionToken = String(data?.token ?? "");
    const user = data?.user ?? {};
    const redirectPath = String(data?.redirect ?? "");

    if (!sessionToken || !redirectPath) {
      setError("Invalid launch response.");
      return;
    }

    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    setCookie("wfl-session", sessionToken, { expires, sameSite: "strict" });
    setCookie("wfl-user", JSON.stringify({
      name: String(user?.name ?? "Student"),
      roll: String(user?.roll ?? normalized),
      pic: String(user?.pic ?? studentPreview?.Pic ?? ""),
      branch: String(user?.branch ?? studentPreview?.Branch ?? ""),
      role: "Student",
    }), { expires, sameSite: "strict" });

    router.replace(redirectPath);
  };

  const previewRoll = async () => {
    const normalized = roll.trim().toUpperCase();
    if (!ROLL_PATTERN.test(normalized)) {
      setError("Enter roll in format like 25K81A0561.");
      setStudentPreview(null);
      setConfirmedRoll("");
      return;
    }

    setPreviewing(true);
    setError(null);
    const res = await fetch(`${API}/exam/invite/${encodeURIComponent(token)}/preview-roll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roll: normalized }),
    }).catch(() => null);
    setPreviewing(false);

    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      setError(body?.detail ?? "Could not validate roll.");
      setStudentPreview(null);
      setConfirmedRoll("");
      return;
    }

    const data = await res.json().catch(() => ({}));
    const student = (data?.student ?? null) as StudentPreview | null;
    if (!student) {
      setError("Could not validate roll.");
      setStudentPreview(null);
      setConfirmedRoll("");
      return;
    }

    setStudentPreview(student);
    setConfirmedRoll("");
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-10rem)] w-full max-w-xl items-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-lg shadow-black/30 sm:p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Exam Invite</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Join exam with roll number</h1>
        <p className="mt-3 text-sm text-zinc-400">
          {examName ? `Exam: ${examName}` : "Validate your invite and continue in normal mode."}
        </p>

        {!examName && (
          <button
            type="button"
            onClick={() => void validateInvite()}
            disabled={loadingExam}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-yellow-400 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingExam ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loadingExam ? "Validating..." : "Validate invite"}
          </button>
        )}

        <div className="mt-6 space-y-2">
          <label htmlFor="invite-roll" className="text-sm text-zinc-300">Roll number</label>
          <input
            id="invite-roll"
            type="text"
            value={roll}
            onChange={(e) => {
              setRoll(e.target.value.toUpperCase());
              setStudentPreview(null);
              setConfirmedRoll("");
            }}
            placeholder="25K81A0561"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-yellow-500"
          />
          <p className="text-xs text-zinc-500">Format: 2 digits + letter + 2 digits + letter + 4 digits</p>
        </div>

        <button
          type="button"
          onClick={() => void previewRoll()}
          disabled={previewing || !examName}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-sky-800/60 bg-sky-950/30 px-4 py-2 text-sm font-medium text-sky-200 hover:bg-sky-900/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {previewing ? "Checking..." : "Verify student"}
        </button>

        {studentPreview && (
          <div className="mt-4 rounded-lg border border-sky-800/60 bg-sky-950/30 p-3.5 space-y-3">
            <p className="text-xs uppercase tracking-wider text-sky-300">Student Verification</p>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={studentPreview.Pic}
                alt={studentPreview.Name}
                className="h-16 w-16 rounded-md object-cover border border-zinc-700"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-100 truncate">{studentPreview.Name}</p>
                <p className="text-xs text-zinc-300">Roll: {studentPreview.Roll}</p>
                <p className="text-xs text-zinc-400">Branch: {studentPreview.Branch}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmedRoll(studentPreview.Roll.toUpperCase());
                  setError(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-emerald-400 transition-colors"
              >
                <CheckCircle2 className={`h-3.5 w-3.5 ${isConfirmed ? "opacity-100" : "opacity-70"}`} />
                {isConfirmed ? "Confirmed" : "Yes This is me"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStudentPreview(null);
                  setConfirmedRoll("");
                  setError("Please enter the correct roll number.");
                }}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                No
              </button>
            </div>
            {isConfirmed && (
              <p className="text-xs text-emerald-300 inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Identity confirmed. You can start the exam.
              </p>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <button
          type="button"
          onClick={() => void launchExam()}
          disabled={launching || !token || !examName || !isConfirmed}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {launching ? "Launching..." : "Start exam (Normal mode)"}
        </button>
      </div>
    </div>
  );
}
