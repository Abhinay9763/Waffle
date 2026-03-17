"use client";

import { useState, useEffect } from "react";
import { getCookie } from "cookies-next";
import Link from "next/link";
import { FileDown, FileText, Loader2, Plus } from "lucide-react";
import { API } from "@/lib/config";

interface Paper {
  id: number;
  name: string;
  total_marks: number;
}

async function downloadDoc(paperId: number, paperName: string, token: string) {
  const res = await fetch(`${API}/paper/${paperId}`, {
    headers: { "x-session-token": token },
  });
  if (!res.ok) return;
  const data = await res.json();
  const sections: any[] = data.questions?.sections ?? [];

  const { Document, Packer, Paragraph, TextRun } = await import("docx");

  const paragraphs: InstanceType<typeof Paragraph>[] = [];
  let qNum = 0;

  for (const section of sections) {
    if (sections.length > 1) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: section.name, bold: true, size: 26 })],
          spacing: { before: 320, after: 160 },
        })
      );
    }

    for (const q of section.questions) {
      qNum++;
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: `Q${qNum}.  ${q.text}`, bold: true })],
          spacing: { before: 240, after: 120 },
        })
      );
      const letters = ["A", "B", "C", "D"];
      for (let i = 0; i < 4; i++) {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun(`${letters[i]})  ${q.options[i] ?? ""}`)],
            indent: { left: 360 },
            spacing: { after: 80 },
          })
        );
      }
    }
  }

  const doc = new Document({ sections: [{ children: paragraphs }] });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${paperName}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PapersPage() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  useEffect(() => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) { setLoading(false); return; }

    fetch(`${API}/paper/list`, { headers: { "x-session-token": token } })
      .then((r) => (r.ok ? r.json() : { papers: [] }))
      .then((d) => setPapers(d.papers ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleDownload = async (paper: Paper) => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token || downloadingId !== null) return;
    setDownloadingId(paper.id);
    await downloadDoc(paper.id, paper.name, token).catch(() => {});
    setDownloadingId(null);
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
        <Link
          href="/papers/new"
          className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 text-zinc-900 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create your first paper
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-10 space-y-6">

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h1 className="text-xl font-semibold text-zinc-100">Question Papers</h1>
            <p className="text-sm text-zinc-500">{papers.length} paper{papers.length !== 1 ? "s" : ""}</p>
          </div>
          <Link
            href="/papers/new"
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-zinc-900 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New paper
          </Link>
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
                  disabled={downloadingId !== null}
                  className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-blue-400 border border-zinc-700 hover:border-blue-700 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {downloadingId === paper.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <FileDown className="w-3.5 h-3.5" />}
                  {downloadingId === paper.id ? "Generating…" : ".docx"}
                </button>
                <Link
                  href={`/papers/${paper.id}`}
                  className="text-xs text-zinc-500 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 px-2.5 py-1 rounded-lg transition-colors"
                >
                  View
                </Link>
                <Link
                  href={`/exams/new?paper=${paper.id}`}
                  className="text-xs text-zinc-500 hover:text-yellow-400 border border-zinc-700 hover:border-yellow-600 px-2.5 py-1 rounded-lg transition-colors"
                >
                  Schedule exam
                </Link>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
