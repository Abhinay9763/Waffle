"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Download, Loader2, CheckCircle2, Monitor, RefreshCw, AlertTriangle } from "lucide-react";
import { API, LOGO, APP_NAME } from "@/lib/config";

function WaffleLogo() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOGO} alt="SMEC logo" width={120} height={120} style={{ objectFit: "contain" }} />;
}

interface VersionInfo {
  version: string;
  required: boolean;
  installer_url: string;  // GitHub release URL for installer
  app_url: string;        // GitHub release URL for app ZIP
  release_notes?: string;
  created_at: string;
}

const CLIENT_FEATURES = [
  "Secure offline exam environment",
  "Auto-sync with server database",
  "Real-time progress tracking",
  "Automatic updates and patches",
];

export default function ClientDownload() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    fetchVersionInfo();
  }, []);

  const fetchVersionInfo = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API}/client/version`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch version information");
      }

      const data = await response.json();
      setVersionInfo(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load version info");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!versionInfo?.installer_url) return;

    setDownloading(true);

    try {
      // Open download link in a new window (GitHub release URL)
      window.open(versionInfo.installer_url, '_blank');

      // Show success message after a brief delay
      setTimeout(() => {
        setDownloading(false);
      }, 2000);
    } catch (err) {
      setDownloading(false);
      setError("Failed to start download. Please try again.");
    }
  };

  return (
    <div className="flex min-h-screen bg-[#09090b]">

      {/* ── Left brand panel ─────────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-[42%] flex-col justify-between p-12 relative overflow-hidden border-r border-zinc-800"
        style={{
          backgroundColor: "#0a0a0a",
          backgroundImage: `
            radial-gradient(ellipse 70% 55% at 15% 50%, rgba(168,85,247,0.10) 0%, transparent 70%),
            radial-gradient(ellipse 55% 45% at 85% 20%, rgba(234,179,8,0.08) 0%, transparent 70%),
            radial-gradient(circle, #27272a 1px, transparent 1px)
          `,
          backgroundSize: "100% 100%, 100% 100%, 28px 28px",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 text-yellow-400">
          <WaffleLogo />
          <span className="translate-y-2 text-3xl font-semibold tracking-tight text-zinc-100">
            {APP_NAME}
          </span>
        </div>

        {/* Tagline */}
        <div className="space-y-8">
          <div className="space-y-3">
            <h2 className="text-3xl font-bold text-zinc-100 leading-snug">
              Download the
              <br />
              <span className="text-yellow-400">{APP_NAME} Client</span>
              <br />
              for Windows.
            </h2>
            <p className="text-zinc-400 text-sm leading-relaxed max-w-xs">
              The secure desktop application that provides a
              controlled environment for taking exams.
            </p>
          </div>

          <ul className="space-y-3">
            {CLIENT_FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-sm text-zinc-300">
                <CheckCircle2 className="w-4 h-4 text-yellow-500 shrink-0" />
                {f}
              </li>
            ))}
          </ul>

          {/* System requirements */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-yellow-400">
              <Monitor className="w-4 h-4" />
              <span className="text-sm font-medium">System Requirements</span>
            </div>
            <ul className="space-y-1 text-xs text-zinc-400">
              <li>• Windows 10/11 (64-bit)</li>
              <li>• 4 GB RAM minimum</li>
              <li>• 500 MB free disk space</li>
              <li>• Internet connection</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <p className="text-zinc-500 text-xs">
          © {new Date().getFullYear()} SMEC. All rights reserved.
        </p>
      </div>

      {/* ── Right download panel ──────────────────────────────────── */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-lg space-y-8">

          {/* Mobile-only logo */}
          <div className="flex items-center gap-2.5 text-yellow-400 lg:hidden">
            <WaffleLogo />
            <span className="text-3xl font-semibold text-zinc-100">{APP_NAME}</span>
          </div>

          {/* Card underlay */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-7 py-8 space-y-6">

            {/* Heading */}
            <div className="space-y-1.5 text-center">
              <h1 className="text-2xl font-bold text-zinc-100">Download {APP_NAME} Client</h1>
              <p className="text-sm text-zinc-400">Get the latest version for your device</p>
            </div>

            {/* Loading state */}
            {loading && (
              <div className="flex flex-col items-center justify-center py-8 space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
                <p className="text-sm text-zinc-400">Loading version information...</p>
              </div>
            )}

            {/* Error state */}
            {error && (
              <div className="space-y-4">
                <div className="rounded-lg bg-red-950/50 border border-red-900/60 px-3.5 py-3 text-sm text-red-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
                <button
                  onClick={fetchVersionInfo}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry
                </button>
              </div>
            )}

            {/* Version info and download */}
            {versionInfo && (
              <div className="space-y-6">
                {/* Version info box */}
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-400">Latest Version</span>
                    <span className="text-lg font-mono font-semibold text-yellow-400">
                      v{versionInfo.version}
                    </span>
                  </div>

                  {versionInfo.required && (
                    <div className="flex items-center gap-2 text-amber-400">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-sm">This update is required</span>
                    </div>
                  )}

                  <p className="text-xs text-zinc-500">
                    Released {new Date(versionInfo.created_at).toLocaleDateString()}
                  </p>
                </div>

                {/* Release notes */}
                {versionInfo.release_notes && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-2">
                    <h3 className="text-sm font-medium text-zinc-300">What's New</h3>
                    <p className="text-sm text-zinc-400 leading-relaxed">
                      {versionInfo.release_notes}
                    </p>
                  </div>
                )}

                {/* Download button */}
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="
                    w-full flex items-center justify-center gap-3
                    rounded-lg bg-yellow-400 hover:bg-yellow-300
                    px-6 py-4 text-base font-semibold text-zinc-900
                    transition-all disabled:opacity-60 disabled:cursor-not-allowed
                    focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 focus:ring-offset-[#09090b]
                    transform hover:scale-[1.02] active:scale-[0.98]
                  "
                >
                  {downloading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Starting Download...
                    </>
                  ) : (
                    <>
                      <Download className="w-5 h-5" />
                      Download {APP_NAME} Client
                    </>
                  )}
                </button>

                {/* Installation note */}
                <div className="rounded-lg border border-blue-800/50 bg-blue-950/30 p-3">
                  <p className="text-xs text-blue-300 leading-relaxed">
                    <strong>Installation:</strong> Run the downloaded installer as Administrator.
                    The client will automatically check for updates when launched.
                  </p>
                </div>
              </div>
            )}

            {/* Links */}
            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-zinc-800">
              <Link
                href="/login"
                className="flex-1 text-center rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors"
              >
                Sign In to Web Portal
              </Link>
              <Link
                href="/register"
                className="flex-1 text-center rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors"
              >
                Create Account
              </Link>
            </div>

          </div>{/* end card */}
        </div>
      </div>

    </div>
  );
}