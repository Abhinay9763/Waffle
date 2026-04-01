"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BlindExamRunner from "@/components/student/BlindExamRunner";
import { ExamStructure } from "@/components/student/types";

function navigateBackOrDashboard(router: ReturnType<typeof useRouter>) {
  if (typeof window === "undefined") {
    router.replace("/student");
    return;
  }

  if (window.history.length > 1) {
    router.back();
    return;
  }

  router.replace("/student");
}

export default function BlindExamGate({ exam }: { exam: ExamStructure }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "requesting" | "denied" | "granted">("idle");
  const [error, setError] = useState<string | null>(null);

  const requestMic = async () => {
    if (status === "requesting" || status === "granted") return;

    setStatus("requesting");
    setError(null);

    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("denied");
      setError("Microphone is not available in this browser.");
      navigateBackOrDashboard(router);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setStatus("granted");
    } catch {
      setStatus("denied");
      setError("Microphone access was denied. Returning you to the previous page.");
      navigateBackOrDashboard(router);
    }
  };

  if (status === "granted") {
    return <BlindExamRunner exam={exam} />;
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-10rem)] w-full max-w-2xl items-center px-6 py-10">
      <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center shadow-lg shadow-black/30">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Blind Mode</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Microphone permission required</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Blind mode uses speech recognition for voice commands. Allow microphone access to continue.
        </p>

        {error ? <p className="mt-4 text-xs text-rose-300">{error}</p> : null}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={requestMic}
            disabled={status === "requesting"}
            className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "requesting" ? "Requesting..." : "Allow microphone and continue"}
          </button>

          <Link
            href="/student"
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-500"
          >
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
}
