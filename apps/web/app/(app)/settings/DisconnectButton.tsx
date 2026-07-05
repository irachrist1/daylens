"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Id } from "../../../convex/_generated/dataModel";
import { apiPath } from "@/app/lib/basePath";

export function DisconnectButton({ deviceId }: { deviceId: Id<"devices"> }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleDisconnect() {
    if (!confirm("Disconnect this device?") || submitting) return;

    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(apiPath("/api/devices/disconnect"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error || `Disconnect failed (${response.status})`);
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleDisconnect}
        disabled={submitting}
        className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-xs text-on-surface-variant hover:text-error hover:border-error/30 transition-colors disabled:opacity-50"
      >
        {submitting ? "Removing…" : "Remove"}
      </button>
      {error ? <p className="text-[0.6875rem] text-error">{error}</p> : null}
    </div>
  );
}
