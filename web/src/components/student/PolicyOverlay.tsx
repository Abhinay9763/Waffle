"use client";

export default function PolicyOverlay({
  lockSeconds,
  reason,
  warningCount,
  maxWarnings,
}: {
  lockSeconds: number;
  reason: string;
  warningCount: number;
  maxWarnings: number;
}) {
  if (lockSeconds <= 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-md">
      <div className="w-full max-w-md rounded-2xl border border-amber-700/50 bg-zinc-900 p-6 text-center shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-400">Warning</p>
        <h2 className="mt-2 text-lg font-semibold text-zinc-100">Policy violation detected</h2>
        <p className="mt-2 text-sm text-zinc-400">{reason}</p>
        <p className="mt-3 text-xs text-amber-300">Warnings {warningCount}/{maxWarnings}</p>
        <p className="mt-4 text-sm text-amber-300">Please wait {lockSeconds}s</p>
      </div>
    </div>
  );
}
