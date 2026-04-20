"use client";

import { useState } from "react";
import { SnapshotContent, type SnapshotShape } from "@/app/components/SnapshotContent";

export interface DeviceTabEntry {
  deviceId: string;
  displayName: string;
  platform: string;
  syncedAt: number;
  snapshot: SnapshotShape;
}

interface DeviceTabsProps {
  tabs: DeviceTabEntry[];
  date: string;
}

function PlatformBadge({ platform }: { platform: string }) {
  if (platform === "macos") {
    return (
      <span className="inline-flex items-center gap-1 text-[0.6875rem] text-on-surface-variant">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
        </svg>
        macOS
      </span>
    );
  }
  if (platform === "windows") {
    return (
      <span className="inline-flex items-center gap-1 text-[0.6875rem] text-on-surface-variant">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M3 12V6.75l6-1.32v6.57H3zm17 0V5.09l-9 1.98V12h9zm-17 1h6v6.43L3 18.09V13zm17 0h-9v6.43L20 18.09V13z" />
        </svg>
        Windows
      </span>
    );
  }
  if (platform === "linux") {
    return (
      <span className="inline-flex items-center gap-1 text-[0.6875rem] text-on-surface-variant">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 2a3 3 0 013 3v1.1c2.86 1.04 5 3.78 5 7.04 0 2.61-1.38 4.94-3.45 6.25.08.19.12.41.12.61a1.5 1.5 0 01-3 0c0-.2.04-.42.12-.61-.58.14-1.18.21-1.79.21-.61 0-1.21-.07-1.79-.21.08.19.12.41.12.61a1.5 1.5 0 01-3 0c0-.2.04-.42.12-.61A7.46 7.46 0 014 13.14c0-3.26 2.14-6 5-7.04V5a3 3 0 013-3zm0 2a1 1 0 00-1 1v.56c.33-.04.66-.06 1-.06s.67.02 1 .06V5a1 1 0 00-1-1zm-4.5 9.14a1.25 1.25 0 101.25-1.25 1.25 1.25 0 00-1.25 1.25zm7.75-1.25a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5z" />
        </svg>
        Linux
      </span>
    );
  }
  return (
    <span className="text-[0.6875rem] text-on-surface-variant">{platform}</span>
  );
}

export function DeviceTabs({ tabs, date }: DeviceTabsProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const active = tabs[activeIdx];

  return (
    <div className="space-y-6">
      {/* Device Tab Bar */}
      <div
        className="flex gap-1 overflow-x-auto rounded-xl bg-surface-low p-1"
        role="tablist"
        aria-label="Device"
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.deviceId}
            role="tab"
            aria-selected={i === activeIdx}
            onClick={() => setActiveIdx(i)}
            className={`flex flex-col items-start whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              i === activeIdx
                ? "bg-surface-high text-on-surface shadow-sm"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <span>{tab.displayName}</span>
            <PlatformBadge platform={tab.platform} />
          </button>
        ))}
      </div>

      {/* Selected device snapshot */}
      <SnapshotContent snapshot={active.snapshot} date={date} />
    </div>
  );
}
