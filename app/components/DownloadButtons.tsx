'use client'

import posthog from 'posthog-js'

export function DownloadButtons() {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        justifyContent: "center",
        flexWrap: "wrap",
        marginBottom: 20,
      }}
    >
      <a
        href="/daylens/api/download/mac"
        onClick={() => posthog.capture('download_clicked', { platform: 'mac' })}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "13px 24px",
          borderRadius: 10,
          background: "linear-gradient(180deg, #68AEFF 0%, #003EB7 100%)",
          color: "#fff",
          fontWeight: 600,
          fontSize: 14,
          textDecoration: "none",
          transition: "opacity 200ms",
        }}
      >
        <AppleIcon />
        Download for Mac
      </a>
      <a
        href="/daylens/api/download/windows"
        onClick={() => posthog.capture('download_clicked', { platform: 'windows' })}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "13px 24px",
          borderRadius: 0,
          background: "linear-gradient(180deg, #68AEFF 0%, #003EB7 100%)",
          color: "#fff",
          fontWeight: 600,
          fontSize: 14,
          textDecoration: "none",
          transition: "opacity 200ms",
        }}
      >
        <WindowsIcon />
        Download for Windows
      </a>
      <a
        href="/daylens/api/download/linux"
        onClick={() => posthog.capture('download_clicked', { platform: 'linux' })}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "13px 24px",
          borderRadius: 0,
          background: "linear-gradient(180deg, #68AEFF 0%, #003EB7 100%)",
          color: "#fff",
          fontWeight: 600,
          fontSize: 14,
          textDecoration: "none",
          transition: "opacity 200ms",
        }}
      >
        <LinuxIcon />
        Download for Linux
      </a>
    </div>
  )
}

function AppleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.36-1.09-.46-2.08-.48-3.22 0-1.43.62-2.18.44-3.04-.36C2.82 15.22 3.54 7.59 9.09 7.31c1.35.07 2.3.74 3.09.8 1.18-.24 2.3-.93 3.56-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.3 2.98-2.57 4.08ZM12.09 7.27c-.15-2.23 1.66-4.07 3.75-4.27.29 2.58-2.07 4.52-3.75 4.27Z" />
    </svg>
  )
}

function WindowsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M0 2.357L6.545 1.5v6H0V2.357zM7.273 1.393L16 0v7.5H7.273V1.393zM0 8.5h6.545v6L0 13.643V8.5zM7.273 8.5H16V16l-8.727-1.393V8.5z" />
    </svg>
  )
}

function LinuxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-8 14H8v-2h4v2Zm6-4H6v-2h12v2Zm0-4H6V7h12v2Z"/>
    </svg>
  )
}
