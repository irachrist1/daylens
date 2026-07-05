import Link from "next/link";
import { Code2 } from "lucide-react";
import {
  LINUX_STATUS_HREF,
  MAC_DOWNLOAD_HREF,
  UNIFIED_DESKTOP_REPO_URL,
  WINDOWS_DOWNLOAD_HREF,
} from "../lib/platformLinks";

type MarketingNavKey = "home" | "docs" | "roadmap" | "changelog";

const NAV_LINKS: Array<{ href: string; label: string; key: MarketingNavKey }> = [
  { href: "/", label: "Product", key: "home" },
  { href: "/docs", label: "Docs", key: "docs" },
  { href: "/roadmap", label: "Roadmap", key: "roadmap" },
  { href: "/changelog", label: "Changelog", key: "changelog" },
];

function DaylensMark() {
  return (
    <span className="v2-site-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export function MarketingInnerNav({ current }: { current: MarketingNavKey; theme?: "dark" | "light"; variant?: "default" | "capsule"; landing?: boolean }) {
  return (
    <header className="v2-site-header">
      <div className="v2-site-header-inner">
        <Link href="/" className="v2-site-logo" aria-label="Daylens home">
          <DaylensMark />
          <span>Daylens</span>
        </Link>
        <nav className="v2-site-nav" aria-label="Public site">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} aria-current={current === link.key ? "page" : undefined}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="v2-site-actions">
          <a href={UNIFIED_DESKTOP_REPO_URL} target="_blank" rel="noopener noreferrer" className="v2-site-source">
            <Code2 size={15} />
            <span>GitHub</span>
          </a>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter({ variant = "full" }: { variant?: "full" | "minimal" }) {
  return (
    <footer className={`v2-site-footer${variant === "minimal" ? " is-minimal" : ""}`}>
      <div className="v2-site-footer-inner">
        <div className="v2-site-footer-top">
          <Link href="/" className="v2-site-logo"><DaylensMark /><span>Daylens</span></Link>
          <nav aria-label="Footer">
            <Link href="/docs">Docs</Link>
            <Link href="/roadmap">Roadmap</Link>
            <Link href="/changelog">Changelog</Link>
            <a href={MAC_DOWNLOAD_HREF}>macOS</a>
            <a href={WINDOWS_DOWNLOAD_HREF}>Windows</a>
            <a href={LINUX_STATUS_HREF}>Linux</a>
            <a href={UNIFIED_DESKTOP_REPO_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
          </nav>
        </div>
        {variant === "full" && <div className="v2-site-wordmark">daylens</div>}
        <div className="v2-site-footer-bottom">
          <span>Built in Rwanda</span>
          <span>Local first, open source</span>
        </div>
      </div>
    </footer>
  );
}
