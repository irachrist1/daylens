"use client";

import { useState } from "react";
import { apiPath } from "@/app/lib/basePath";

export function DownloadButton({ disabled = false }: { disabled?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleDownload() {
    if (disabled || loading) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(apiPath("/api/snapshots?full=1"));
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error || `Export failed (${res.status})`);
      }
      const data = await res.json();

      const blob = new Blob([JSON.stringify(data.snapshots, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `daylens-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleDownload}
        disabled={disabled || loading}
        className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-sm text-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
      >
        {loading ? "Preparing…" : "Download JSON"}
      </button>
      {error ? <p className="text-[0.6875rem] text-error">{error}</p> : null}
    </div>
  );
}
