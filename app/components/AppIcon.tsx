"use client";

import { useEffect, useState } from "react";

import {
  appInitials,
  formatDisplayAppName,
  formatVisibleAppName,
  normalizeAppNameKey,
} from "@/app/lib/apps";
import { CATEGORY_COLORS } from "@/app/lib/format";

/**
 * Map well-known macOS bundle IDs to website domains.
 * Google's favicon API (https://www.google.com/s2/favicons?domain=X&sz=64)
 * reliably returns icons for any domain — no CORS, no hotlink blocking.
 */
const BUNDLE_TO_DOMAIN: Record<string, string> = {
  // Browsers
  "com.google.Chrome": "chrome.google.com",
  "com.apple.Safari": "apple.com",
  "company.thebrowser.Browser": "arc.net",
  "org.mozilla.firefox": "mozilla.org",
  "com.brave.Browser": "brave.com",
  "com.microsoft.edgemac": "microsoft.com",
  "com.operasoftware.Opera": "opera.com",
  "com.vivaldi.Vivaldi": "vivaldi.com",

  // Development
  "com.microsoft.VSCode": "code.visualstudio.com",
  "com.apple.dt.Xcode": "developer.apple.com",
  "dev.warp.Warp-Stable": "warp.dev",
  "com.todesktop.230313mzl4w4u92": "cursor.com",
  "com.googlecode.iterm2": "iterm2.com",
  "com.sublimetext.4": "sublimetext.com",
  "com.jetbrains.intellij": "jetbrains.com",
  "ai.dia.mac": "diabrowser.com",
  "app.dia.desktop": "diabrowser.com",
  "com.dia.app": "diabrowser.com",
  "company.thebrowser.dia": "diabrowser.com",

  // Communication
  "com.tinyspeck.slackmacgap": "slack.com",
  "us.zoom.xos": "zoom.us",
  "com.microsoft.teams2": "teams.microsoft.com",
  "ru.keepcoder.Telegram": "telegram.org",
  "com.hnc.Discord": "discord.com",
  "WhatsApp": "whatsapp.com",
  "com.readdle.SparkDesktop": "sparkmailapp.com",

  // Productivity
  "com.microsoft.Word": "word.office.com",
  "com.microsoft.Excel": "excel.office.com",
  "com.microsoft.Powerpoint": "powerpoint.office.com",
  "com.microsoft.onenote.mac": "onenote.com",
  "com.microsoft.Outlook": "outlook.com",
  "notion.id": "notion.so",
  "com.figma.Desktop": "figma.com",
  "com.linear": "linear.app",
  "com.todoist.mac.Todoist": "todoist.com",

  // Apple system apps
  "com.apple.finder": "apple.com",
  "com.apple.mail": "apple.com",
  "com.apple.Notes": "apple.com",
  "com.apple.AppStore": "apple.com",
  "com.apple.Terminal": "apple.com",
  "com.apple.MobileSMS": "apple.com",
  "com.apple.Preview": "apple.com",
  "com.apple.systempreferences": "apple.com",
  "com.apple.Music": "music.apple.com",

  // Media
  "com.spotify.client": "spotify.com",
  "com.apple.TV": "tv.apple.com",

  // AI tools
  "com.openai.chat": "chatgpt.com",
  "com.anthropic.claudefordesktop": "claude.ai",
};

/** Display-name based fallback for apps without matching bundle IDs */
const NAME_TO_DOMAIN: Record<string, string> = {
  "arc": "arc.net",
  "google chrome": "chrome.google.com",
  "chrome": "chrome.google.com",
  "safari": "apple.com",
  "firefox": "mozilla.org",
  "brave": "brave.com",
  "edge": "microsoft.com",
  "vscode": "code.visualstudio.com",
  "visual studio code": "code.visualstudio.com",
  "code": "code.visualstudio.com",
  "xcode": "developer.apple.com",
  "cursor": "cursor.com",
  "warp": "warp.dev",
  "iterm2": "iterm2.com",
  "iterm": "iterm2.com",
  "slack": "slack.com",
  "zoom": "zoom.us",
  "discord": "discord.com",
  "telegram": "telegram.org",
  "whatsapp": "whatsapp.com",
  "microsoft excel": "microsoft.com",
  "excel": "microsoft.com",
  "microsoft word": "microsoft.com",
  "word": "microsoft.com",
  "powerpoint": "microsoft.com",
  "outlook": "outlook.com",
  "notion": "notion.so",
  "figma": "figma.com",
  "linear": "linear.app",
  "todoist": "todoist.com",
  "finder": "apple.com",
  "terminal": "apple.com",
  "app store": "apple.com",
  "system preferences": "apple.com",
  "system settings": "apple.com",
  "notes": "apple.com",
  "mail": "apple.com",
  "preview": "apple.com",
  "messages": "apple.com",
  "music": "music.apple.com",
  "spotify": "spotify.com",
  "spark": "sparkmailapp.com",
  "chatgpt": "chatgpt.com",
  "claude": "claude.ai",
  "codex": "openai.com",
  "daylens": "daylens.app",
  "dia": "diabrowser.com",
};

const NORMALIZED_NAME_TO_DOMAIN = Object.fromEntries(
  Object.entries(NAME_TO_DOMAIN).map(([name, domain]) => [normalizeAppNameKey(name), domain]),
);

function resolveDomain(bundleID: string, displayName: string) {
  const bundleDomain = BUNDLE_TO_DOMAIN[bundleID];
  if (bundleDomain) return bundleDomain;

  const candidates = [
    displayName,
    formatVisibleAppName(bundleID),
    formatDisplayAppName(bundleID),
    bundleID,
  ].filter((value): value is string => Boolean(value?.trim()));

  for (const candidate of candidates) {
    const normalized = normalizeAppNameKey(candidate);
    if (!normalized) continue;

    const directBundleDomain = BUNDLE_TO_DOMAIN[candidate];
    if (directBundleDomain) return directBundleDomain;

    const normalizedBundleDomain = BUNDLE_TO_DOMAIN[normalized];
    if (normalizedBundleDomain) return normalizedBundleDomain;

    const nameDomain = NORMALIZED_NAME_TO_DOMAIN[normalized];
    if (nameDomain) return nameDomain;
  }

  return null;
}

function resolveIconSrc(bundleID: string, displayName: string, iconBase64?: string | null) {
  // 1. Try iconBase64 from snapshot
  const trimmed = iconBase64?.trim();
  if (trimmed) {
    return trimmed.startsWith("data:image/")
      ? trimmed
      : `data:image/png;base64,${trimmed}`;
  }

  // 2. Try known bundle/app aliases → domain
  const resolvedDomain = resolveDomain(bundleID, displayName);
  if (resolvedDomain) {
    return `https://www.google.com/s2/favicons?domain=${resolvedDomain}&sz=128`;
  }

  return null;
}

export function AppIcon({
  bundleID,
  displayName,
  category,
  iconBase64,
  size = 32,
}: {
  bundleID: string;
  displayName: string;
  category: string;
  iconBase64?: string | null;
  size?: number;
}) {
  const px = `${size / 16}rem`;
  const safeDisplayName =
    formatVisibleAppName(displayName || bundleID) ??
    formatDisplayAppName(displayName || bundleID);
  const iconSrc = resolveIconSrc(bundleID, safeDisplayName, iconBase64);
  const [didFail, setDidFail] = useState(false);

  useEffect(() => {
    setDidFail(false);
  }, [iconSrc]);

  if (iconSrc && !didFail) {
    return (
      <div
        className="shrink-0 overflow-hidden rounded-lg bg-surface-high/60 ring-1 ring-white/8"
        style={{ width: px, height: px }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={iconSrc}
          alt={safeDisplayName || bundleID}
          className="block h-full w-full object-contain"
          onLoad={(event) => {
            if (
              event.currentTarget.naturalWidth <= 1 ||
              event.currentTarget.naturalHeight <= 1
            ) {
              setDidFail(true);
            }
          }}
          onError={() => setDidFail(true)}
        />
      </div>
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg text-xs font-bold"
      style={{
        width: px,
        height: px,
        backgroundColor: (CATEGORY_COLORS[category] || "#475569") + "20",
        color: CATEGORY_COLORS[category] || "#475569",
      }}
    >
      {appInitials(safeDisplayName || bundleID).slice(0, 2) || "?"}
    </div>
  );
}
