"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refresh on return-to-tab without forcing a background polling loop. */
export function Poller() {
  const router = useRouter();

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [router]);

  return null;
}
