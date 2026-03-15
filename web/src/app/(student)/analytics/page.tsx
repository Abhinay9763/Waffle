"use client";

import { useState, useEffect } from "react";
import { getCookie } from "cookies-next";
import { Loader2 } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface MyResponse {
  id: number;
  exam_name: string;
  exam_start: string;
  score: number;
  total_marks: number;
  percentage: number;
}

function fmtShort(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3.5 space-y-0.5">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-2xl font-bold text-zinc-100 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-zinc-600">{sub}</p>}
    </div>
  );
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs shadow-xl">
      <p className="text-zinc-400 mb-1">{label}</p>
      <p className="text-yellow-400 font-semibold">{payload[0].value}%</p>
      <p className="text-zinc-500">{payload[0].payload.score} / {payload[0].payload.total}</p>
    </div>
  );
}

export default function AnalyticsPage() {
  const [responses, setResponses] = useState<MyResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) { setLoading(false); return; }

    fetch(`${API}/response/my`, { headers: { "x-session-token": token } })
      .then((r) => (r.ok ? r.json() : { responses: [] }))
      .then((d) => setResponses(d.responses ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
      </div>
    );
  }

  if (responses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
        <p className="text-zinc-300 text-sm font-medium">No data yet</p>
        <p className="text-zinc-600 text-xs">Analytics will appear after your first exam.</p>
      </div>
    );
  }

  // Oldest → newest for the chart
  const sorted = [...responses].sort(
    (a, b) => new Date(a.exam_start).getTime() - new Date(b.exam_start).getTime(),
  );

  const chartData = sorted.map((r) => ({
    name:  fmtShort(r.exam_start),
    pct:   r.percentage,
    score: r.score,
    total: r.total_marks,
  }));

  const avg  = Math.round(responses.reduce((s, r) => s + r.percentage, 0) / responses.length);
  const best = Math.max(...responses.map((r) => r.percentage));
  const bestExam = responses.find((r) => r.percentage === best);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">

        <h1 className="text-xl font-semibold text-zinc-100">Analytics</h1>

        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Exams taken"    value={responses.length} />
          <StatCard label="Average score"  value={`${avg}%`} />
          <StatCard label="Best score"     value={`${best}%`} sub={bestExam?.exam_name} />
        </div>

        {/* Chart */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <p className="text-sm font-medium text-zinc-300">Score trend</p>
          {sorted.length < 2 ? (
            <div className="flex items-center justify-center h-[220px]">
              <p className="text-sm text-zinc-600">Take at least 2 exams to see your trend.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="pctGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#facc15" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#facc15" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: "#71717a", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: "#71717a", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#3f3f46" }} />
              <Area
                type="monotone"
                dataKey="pct"
                stroke="#facc15"
                strokeWidth={2}
                fill="url(#pctGrad)"
                dot={{ fill: "#facc15", strokeWidth: 0, r: 3 }}
                activeDot={{ fill: "#facc15", r: 5, strokeWidth: 0 }}
              />
            </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

      </div>
    </div>
  );
}
