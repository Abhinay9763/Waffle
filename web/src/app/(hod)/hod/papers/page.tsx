"use client";

import type { ChangeEvent } from "react";
import { useEffect, useState } from "react";
import { getCookie } from "cookies-next";
import Link from "next/link";
import { Download, FileDown, FileText, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { API, PAPER_TEMPLATE_FILE } from "@/lib/config";

interface Paper {
  id: number;
  name: string;
  total_marks: number;
  in_use: boolean;
  can_edit: boolean;
}

export default function HodPapersPage() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingDocId, setDownloadingDocId] = useState<number | null>(null);
  const [downloadingXlsxId, setDownloadingXlsxId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);

  const loadPapers = async () => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) {
      setPapers([]);
      setLoading(false);
      return;
    }

    const res = await fetch(`${API}/paper/list`, { headers: { "x-session-token": token } }).catch(() => null);
    if (!res?.ok) {
      setPapers([]);
      setLoading(false);
      return;
    }

    const d = await res.json().catch(() => ({ papers: [] }));
    setPapers(d.papers ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void loadPapers();
  }, []);

  const downloadDoc = async (paper: Paper) => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) return;
    setDownloadingDocId(paper.id);
    const res = await fetch(`${API}/paper/${paper.id}/download`, {
      headers: { "x-session-token": token },
    }).catch(() => null);
    setDownloadingDocId(null);

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

  const downloadXlsx = async (paper: Paper) => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) return;
    setDownloadingXlsxId(paper.id);
    const res = await fetch(`${API}/paper/${paper.id}/download-xlsx`, {
      headers: { "x-session-token": token },
    }).catch(() => null);
    setDownloadingXlsxId(null);

    if (!res?.ok) {
      toast.error("Failed to download paper.");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${paper.name}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadTemplate = async () => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) {
      toast.error("Session expired. Please log in again.");
      return;
    }

    const res = await fetch(`${API}/paper/template/${PAPER_TEMPLATE_FILE}`, {
      headers: { "x-session-token": token },
    }).catch(() => null);
    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      toast.error(body?.detail ?? "Template not available yet.");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = PAPER_TEMPLATE_FILE;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (file: File) => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) {
      toast.error("Session expired. Please log in again.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast.error("Please upload an .xlsx file.");
      return;
    }

    const form = new FormData();
    form.append("file", file);
    setImporting(true);

    const res = await fetch(`${API}/paper/import`, {
      method: "POST",
      headers: { "x-session-token": token },
      body: form,
    }).catch(() => null);

    setImporting(false);

    if (!res) {
      toast.error("Network error while importing paper.");
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = body?.detail;
      if (typeof detail === "string") {
        toast.error(detail);
        return;
      }
      if (detail && typeof detail === "object") {
        const message = typeof detail.message === "string" ? detail.message : `Import failed (${res.status})`;
        const errors = Array.isArray(detail.errors) ? detail.errors : [];
        toast.error(`${message}${errors.length ? ` | ${errors.join(" | ")}` : ""}`);
        return;
      }
      toast.error(`Import failed (${res.status})`);
      return;
    }

    await loadPapers();
  };

  const handleImportInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (file) {
      void handleImport(file);
    }
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

  if (papers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
        <p className="text-zinc-500 text-sm">No question papers yet.</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleDownloadTemplate()}
            className="flex items-center gap-2 border border-zinc-700 hover:border-zinc-500 text-zinc-300 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" />
            Download template
          </button>
          <label className="flex items-center gap-2 border border-zinc-700 hover:border-zinc-500 text-zinc-300 text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {importing ? "Importing..." : "Import paper"}
            <input
              type="file"
              accept=".xlsx"
              className="hidden"
              disabled={importing}
              onChange={handleImportInputChange}
            />
          </label>
          <Link
            href="/hod/papers/new"
            className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 text-zinc-900 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create your first paper
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-10 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <h1 className="text-xl font-semibold text-zinc-100">Question Papers</h1>
            <p className="text-sm text-zinc-500">{papers.length} paper{papers.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <Link href="/hod/papers/new" className="flex items-center gap-1.5 rounded-lg bg-yellow-400 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-yellow-300">
              <Plus className="h-3.5 w-3.5" /> New paper
            </Link>
            <button
              type="button"
              onClick={() => void handleDownloadTemplate()}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 text-zinc-300 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Template
            </button>
            <label className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 text-zinc-300 transition-colors cursor-pointer">
              {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {importing ? "Importing..." : "Import paper"}
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                disabled={importing}
                onChange={handleImportInputChange}
              />
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 overflow-hidden divide-y divide-zinc-800/60">
          {papers.map((paper) => (
            <div key={paper.id} className="flex items-center gap-4 px-4 py-3.5 hover:bg-zinc-800/30 transition-colors">
              <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center"><FileText className="w-4 h-4 text-zinc-500" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-200 truncate">{paper.name}</p>
                <p className="text-xs text-zinc-600">{paper.total_marks} marks {paper.in_use ? "· in use" : ""}</p>
              </div>
              <button
                onClick={() => void downloadDoc(paper)}
                disabled={downloadingDocId !== null}
                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-blue-400 border border-zinc-700 hover:border-blue-700 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {downloadingDocId === paper.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} .docx
              </button>
              <button
                onClick={() => void downloadXlsx(paper)}
                disabled={downloadingXlsxId !== null}
                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-emerald-400 border border-zinc-700 hover:border-emerald-700 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {downloadingXlsxId === paper.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} .xlsx
              </button>
              <Link href={`/hod/papers/${paper.id}`} className="text-xs text-zinc-500 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 px-2.5 py-1 rounded-lg transition-colors">View</Link>
              {paper.can_edit ? (
                <Link
                  href={`/hod/exams/new?paper=${paper.id}`}
                  className="text-xs text-zinc-500 hover:text-yellow-400 border border-zinc-700 hover:border-yellow-600 px-2.5 py-1 rounded-lg transition-colors"
                >
                  Schedule exam
                </Link>
              ) : (
                <span className="text-[11px] text-zinc-600 border border-zinc-800 px-2.5 py-1 rounded-lg">View only</span>
              )}
              <button
                onClick={() => void handleDelete(paper)}
                disabled={!paper.can_edit || paper.in_use || deletingId === paper.id}
                className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
                title={!paper.can_edit ? "You can only view other faculty papers" : (paper.in_use ? "Paper in use" : "Delete paper")}
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
