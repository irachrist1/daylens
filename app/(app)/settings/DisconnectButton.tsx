"use client";

import { useRouter } from "next/navigation";
import { Id } from "../../../convex/_generated/dataModel";
import { apiPath } from "@/app/lib/basePath";

export function DisconnectButton({ deviceId }: { deviceId: Id<"devices"> }) {
  const router = useRouter();

  async function handleDisconnect() {
    if (!confirm("Disconnect this device?")) return;

    await fetch(apiPath("/api/devices/disconnect"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });

    router.refresh();
  }

  return (
    <button
      onClick={handleDisconnect}
      className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-xs text-on-surface-variant hover:text-error hover:border-error/30 transition-colors"
    >
      Remove
    </button>
  );
}
