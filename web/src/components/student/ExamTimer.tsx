"use client";

import { useEffect, useMemo, useState } from "react";

function formatSeconds(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function ExamTimer({
  endTime,
  onTimeUp,
}: {
  endTime: string;
  onTimeUp: () => void;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const compute = () => {
      const diff = Math.floor((new Date(endTime).getTime() - Date.now()) / 1000);
      return Math.max(0, diff);
    };

    setRemaining(compute());
    const id = setInterval(() => {
      const next = compute();
      setRemaining(next);
      if (next <= 0) {
        clearInterval(id);
        onTimeUp();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [endTime, onTimeUp]);

  const low = useMemo(() => (remaining ?? 0) <= 300, [remaining]);

  return (
    <div className={`rounded-lg border px-3 py-1.5 text-sm font-semibold tabular-nums ${low ? "border-amber-600/60 bg-amber-950/30 text-amber-300" : "border-zinc-700 bg-zinc-900 text-zinc-200"}`}>
      {remaining === null ? "--:--:--" : formatSeconds(remaining)}
    </div>
  );
}
