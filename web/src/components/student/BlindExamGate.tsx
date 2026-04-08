"use client";

import { useState } from "react";
import Link from "next/link";
import BlindExamRunner from "@/components/student/BlindExamRunner";
import { ExamStructure } from "@/components/student/types";

export default function BlindExamGate({ exam }: { exam: ExamStructure }) {
  const [status, setStatus] = useState<"idle" | "requesting" | "denied" | "granted">("idle");
  const [error, setError] = useState<string | null>(null);

  const formatMicError = (err: unknown) => {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return "Microphone permission was blocked by the browser or OS.";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "No microphone device was found.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "Microphone is busy in another app.";
    }
    if (name === "SecurityError") {
      return "Microphone access requires a secure context (HTTPS).";
    }
    if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
      return "Microphone constraints are not supported on this device.";
    }
    return "Could not access microphone.";
  };

  const requestMic = async () => {
    if (status === "requesting" || status === "granted") return;

    setStatus("requesting");
    setError(null);

    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("denied");
      setError("Microphone is not available in this browser. Try a modern browser on HTTPS.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setStatus("granted");
    } catch (err) {
      // Some browsers can throw from getUserMedia even after permission is granted.
      // In that case, trust Permission API state and proceed.
      try {
        if (navigator.permissions?.query) {
          const perm = await navigator.permissions.query({ name: "microphone" as PermissionName });
          if (perm.state === "granted") {
            setStatus("granted");
            return;
          }
        }
      } catch {
        // Ignore permission-query failures and fall back to error message.
      }

      const reason = err instanceof Error && err.message ? ` (${err.message})` : "";
      setStatus("denied");
      setError(`${formatMicError(err)} Please allow access and try again${reason}.`);
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
            {status === "requesting" ? "Requesting..." : status === "denied" ? "Retry microphone access" : "Allow microphone and continue"}
          </button>

          <Link
            href={`/exam/${exam.meta.exam_id}/normal`}
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-500"
          >
            Continue in normal mode
          </Link>

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
