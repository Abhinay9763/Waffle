"use client";

import { useEffect, useState } from "react";
import { getCookie } from "cookies-next";
import Link from "next/link";
import { FileDown, FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/lib/config";

interface Paper {
  id: number;
  name: string;
  total_marks: number;
  in_use: boolean;
}

export default function HodPapersPage() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) { setLoading(false); return; }

    fetch(`${API}/paper/list`, { headers: { "x-session-token": token } })
      .then((r) => (r.ok ? r.json() : { papers: [] }))
      .then((d) => setPapers(d.papers ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const downloadDoc = async (paper: Paper) => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) return;
    setDownloadingId(paper.id);
    const res = await fetch(`${API}/paper/${paper.id}/download`, {
      headers: { "x-session-token": token },
    }).catch(() => null);
    setDownloadingId(null);

    if (!res?.ok) {
      toast.error("Failed to download paper.");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${paper.name}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (paper: Paper) => {
    if (!confirm(`Delete "${paper.name}"?`)) return;
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) return;

    setDeletingId(paper.id);
    const res = await fetch(`${API}/paper/${paper.id}`, {
      method: "DELETE",
      headers: { "x-session-token": token },
    }).catch(() => null);
    setDeletingId(null);

    if (res?.ok) {
      setPapers((prev) => prev.filter((p) => p.id !== paper.id));
      return;
    }
    const body = await res?.json().catch(() => ({}));
    toast.error(body?.detail ?? "Failed to delete paper.");
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-600" /></div>;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">Question Papers</h1>
            <p className="text-sm text-zinc-500">{papers.length} paper{papers.length !== 1 ? "s" : ""}</p>
          </div>
          <Link href="/hod/papers/new" className="flex items-center gap-1.5 rounded-lg bg-yellow-400 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-yellow-300">
            <Plus className="h-3.5 w-3.5" /> New paper
          </Link>
        </div>

        <div className="rounded-xl border border-zinc-800 overflow-hidden divide-y divide-zinc-800/60">
          {papers.map((paper) => (
            <div key={paper.id} className="flex items-center gap-4 px-4 py-3.5 hover:bg-zinc-800/30 transition-colors">
              <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center"><FileText className="w-4 h-4 text-zinc-500" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-200 truncate">{paper.name}</p>
                <p className="text-xs text-zinc-600">{paper.total_marks} marks {paper.in_use ? "· in use" : ""}</p>
              </div>
              <Link href={`/hod/papers/${paper.id}`} className="text-xs text-sky-400 hover:text-sky-300">Open</Link>
              <button onClick={() => void downloadDoc(paper)} disabled={downloadingId !== null} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
                {downloadingId === paper.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} .docx
              </button>
              <button
                onClick={() => void handleDelete(paper)}
                disabled={paper.in_use || deletingId === paper.id}
                className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
                title={paper.in_use ? "Paper in use" : "Delete paper"}
              >
                {deletingId === paper.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
          {papers.length === 0 && <div className="px-4 py-10 text-center text-sm text-zinc-500">No papers available.</div>}
        </div>
      </div>
    </div>
  );
}
