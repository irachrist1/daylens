"use client";

import { apiPath } from "@/app/lib/basePath";

export function DownloadButton() {
  async function handleDownload() {
    const res = await fetch(apiPath("/api/snapshots?full=1"));
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
  }

  return (
    <button
      onClick={handleDownload}
      className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-sm text-primary hover:bg-primary/5 transition-colors"
    >
      Download JSON
    </button>
  );
}
