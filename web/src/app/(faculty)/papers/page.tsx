"use client";

import type { ChangeEvent } from "react";
import { useState, useEffect } from "react";
import { getCookie } from "cookies-next";
import Link from "next/link";
import { Copy, Download, FileDown, FileText, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { API, PAPER_TEMPLATE_FILE } from "@/lib/config";

interface Paper {
  id: number;
  name: string;
  total_marks: number;
  in_use: boolean;
}

async function downloadDoc(paperId: number, paperName: string, token: string) {
  try {
    const res = await fetch(`${API}/paper/${paperId}/download`, {
      headers: { "x-session-token": token },
    });
    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${paperName}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    throw e;
  }
}

async function downloadXlsx(paperId: number, paperName: string, token: string) {
  try {
    const res = await fetch(`${API}/paper/${paperId}/download-xlsx`, {
      headers: { "x-session-token": token },
    });
    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${paperName}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    throw e;
  }
}

export default function PapersPage() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingDocId, setDownloadingDocId] = useState<number | null>(null);
  const [downloadingXlsxId, setDownloadingXlsxId] = useState<number | null>(null);
  const [cloningId, setCloningId] = useState<number | null>(null);
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
    loadPapers();
  }, []);

  const handleDownload = async (paper: Paper) => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token || downloadingDocId !== null) return;
    setDownloadingDocId(paper.id);
    await downloadDoc(paper.id, paper.name, token).catch(() => {});
    setDownloadingDocId(null);
  };

  const handleDownloadXlsx = async (paper: Paper) => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token || downloadingXlsxId !== null) return;
    setDownloadingXlsxId(paper.id);
    await downloadXlsx(paper.id, paper.name, token).catch(() => {});
    setDownloadingXlsxId(null);
  };

  const handleDelete = async (paper: Paper) => {
    if (!window.confirm(`Delete "${paper.name}"? This cannot be undone.`)) return;
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) return;
    setDeletingId(paper.id);
    const res = await fetch(`${API}/paper/${paper.id}`, {
      method: "DELETE",
      headers: { "x-session-token": token },
    }).catch(() => null);
    setDeletingId(null);
    if (!res) { toast.error("Network error - could not reach server."); return; }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.detail ?? `Delete failed (${res.status})`);
      return;
    }
    setPapers(prev => prev.filter(p => p.id !== paper.id));
  };

  const handleClone = async (paper: Paper) => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token || cloningId !== null) return;

    setCloningId(paper.id);
    const res = await fetch(`${API}/paper/${paper.id}/clone`, {
      method: "POST",
      headers: { "x-session-token": token },
    }).catch(() => null);
    setCloningId(null);

    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      toast.error(body?.detail ?? "Failed to clone paper.");
      return;
    }

    toast.success("Paper cloned.");
    await loadPapers();
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
        const extra = typeof detail.error_count === "number" && detail.error_count > errors.length
          ? `\n...and ${detail.error_count - errors.length} more error(s).`
          : "";
        toast.error(`${message}${errors.length ? ` | ${errors.join(" | ")}` : ""}${extra ? ` | ${extra.replace(/\n/g, " ")}` : ""}`);
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

    // Reset immediately so selecting same file again still triggers onChange.
    input.value = "";

    if (file) {
      void handleImport(file);
    }
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
      </div>
    );
  }

  if (papers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
        <p className="text-zinc-500 text-sm">No question papers yet.</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleDownloadTemplate}
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
            href="/papers/new"
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
      <div className="px-4 py-6 sm:px-8 sm:py-10 space-y-6">

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <h1 className="text-xl font-semibold text-zinc-100">Question Papers</h1>
            <p className="text-sm text-zinc-500">{papers.length} paper{papers.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <Link
              href="/papers/new"
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-zinc-900 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New paper
            </Link>
            <button
              type="button"
              onClick={handleDownloadTemplate}
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

        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          {papers.map((paper, i) => (
            <div
              key={paper.id}
              className={`flex items-center gap-4 px-4 py-3.5 hover:bg-zinc-800/30 transition-colors ${
                i !== papers.length - 1 ? "border-b border-zinc-800/60" : ""
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4 text-zinc-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-200 truncate">{paper.name}</p>
                <p className="text-xs text-zinc-600">{paper.total_marks} marks</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleDownload(paper)}
                  disabled={downloadingDocId !== null}
                  className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-blue-400 border border-zinc-700 hover:border-blue-700 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {downloadingDocId === paper.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <FileDown className="w-3.5 h-3.5" />}
                  {downloadingDocId === paper.id ? "Generating…" : ".docx"}
                </button>
                <button
                  onClick={() => handleDownloadXlsx(paper)}
                  disabled={downloadingXlsxId !== null}
                  className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-emerald-400 border border-zinc-700 hover:border-emerald-700 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {downloadingXlsxId === paper.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <FileDown className="w-3.5 h-3.5" />}
                  {downloadingXlsxId === paper.id ? "Generating…" : ".xlsx"}
                </button>
                <Link
                  href={`/papers/${paper.id}`}
                  className="text-xs text-zinc-500 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 px-2.5 py-1 rounded-lg transition-colors"
                >
                  View
                </Link>
                <button
                  type="button"
                  onClick={() => void handleClone(paper)}
                  disabled={cloningId !== null}
                  className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-indigo-300 border border-zinc-700 hover:border-indigo-700 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {cloningId === paper.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Copy className="w-3.5 h-3.5" />}
                  {cloningId === paper.id ? "Cloning…" : "Clone"}
                </button>
                <Link
                  href={`/exams/new?paper=${paper.id}`}
                  className="text-xs text-zinc-500 hover:text-yellow-400 border border-zinc-700 hover:border-yellow-600 px-2.5 py-1 rounded-lg transition-colors"
                >
                  Schedule exam
                </Link>
                <button
                  onClick={() => handleDelete(paper)}
                  disabled={paper.in_use || deletingId === paper.id}
                  title={paper.in_use ? "In use by an exam — cannot delete" : "Delete paper"}
                  className="flex items-center justify-center w-7 h-7 rounded-lg border border-zinc-700 text-zinc-600 hover:text-red-400 hover:border-red-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {deletingId === paper.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
