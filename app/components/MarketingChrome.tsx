import Link from "next/link";
import { assetPath } from "../lib/basePath";
import {
  LINUX_STATUS_HREF,
  MAC_DOWNLOAD_HREF,
  UNIFIED_DESKTOP_REPO_URL,
  WINDOWS_DOWNLOAD_HREF,
} from "../lib/platformLinks";

type MarketingNavKey = "home" | "docs" | "roadmap" | "changelog";

const NAV_LINKS: Array<{ href: string; label: string; key: MarketingNavKey }> = [
  { href: "/docs", label: "Docs", key: "docs" },
  { href: "/roadmap", label: "Roadmap", key: "roadmap" },
  { href: "/changelog", label: "Changelog", key: "changelog" },
];

export function MarketingInnerNav({
  current,
  theme = "dark",
  variant = "default",
  landing = false,
}: {
  current: MarketingNavKey;
  theme?: "dark" | "light";
  variant?: "default" | "capsule";
  landing?: boolean;
}) {
  return (
    <header
      className={[
        "lp-docs-nav",
        theme === "light" ? "lp-docs-nav--light" : "",
        variant === "capsule" ? "lp-docs-nav--capsule" : "",
        landing ? "lp-docs-nav--landing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Link href="/" className="dl-nav-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={assetPath("/app-icon.png")}
          alt=""
          width={28}
          height={28}
          className="dl-nav-brand__icon"
        />
        <span className="dl-nav-brand__word">Daylens</span>
      </Link>

      <nav className="lp-docs-nav-links dl-nav-links" aria-label="Marketing">
        <Link
          href="/"
          className={`dl-nav-link${landing ? "" : " lp-footer-link"}${current === "home" ? " lp-nav-active" : ""}`}
        >
          Home
        </Link>
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`dl-nav-link${landing ? "" : " lp-footer-link"}${current === link.key ? " lp-nav-active" : ""}`}
          >
            {link.label}
          </Link>
        ))}
        <Link
          href="/link"
          className={landing ? "dl-nav-cta" : "lp-btn-primary dl-nav-cta"}
          style={landing ? undefined : { padding: "0.5rem 1.25rem", fontSize: "0.8125rem" }}
        >
          Connect App
        </Link>
      </nav>
    </header>
  );
}

export function MarketingFooter({ variant = "full" }: { variant?: "full" | "minimal" }) {
  if (variant === "minimal") {
    return (
      <footer className="dl-foot">
        <div className="dl-foot__inner">
          <div className="dl-foot__brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assetPath("/app-icon.png")} alt="" width={18} height={18} className="dl-foot__icon" />
            <span>Daylens</span>
          </div>
          <nav className="dl-foot__links" aria-label="Footer">
            <Link href="/docs">Docs</Link>
            <Link href="/link">Connect App</Link>
            <a href={MAC_DOWNLOAD_HREF}>Mac</a>
            <a href={WINDOWS_DOWNLOAD_HREF}>Windows</a>
            <a href={LINUX_STATUS_HREF}>Linux status</a>
            <a href={UNIFIED_DESKTOP_REPO_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
          </nav>
          <p className="dl-foot__copy">
            <span className="lp-footer-year" title="Click me">&copy; 2026</span>{" "}
            Local-first work history by Christian Tonny
          </p>
        </div>
      </footer>
    );
  }

  return (
    <footer className="lp-footer">
      <div className="lp-container">
        <div className="lp-footer-grid">
          <div className="lp-footer-brand">
            <div className="lp-footer-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={assetPath("/app-icon.png")}
                alt="Daylens"
                width={22}
                height={22}
                style={{ borderRadius: 5 }}
              />
              <span>Daylens</span>
            </div>
            <p className="lp-footer-desc">
              Cross-platform work history with macOS and Windows available now, Linux validation
              still in progress, and a local-first evidence model underneath it all.
            </p>
            <p className="lp-footer-credit">Made by Christian Tonny</p>
          </div>

          <div className="lp-footer-col">
            <span className="text-label lp-footer-heading">Explore</span>
            <Link href="/" className="lp-footer-link">Home</Link>
            <Link href="/docs" className="lp-footer-link">Documentation</Link>
            <Link href="/roadmap" className="lp-footer-link">Roadmap</Link>
            <Link href="/changelog" className="lp-footer-link">Changelog</Link>
          </div>

          <div className="lp-footer-col">
            <span className="text-label lp-footer-heading">Web Access</span>
            <Link href="/link" className="lp-footer-link">Link Desktop App</Link>
            <Link href="/recover" className="lp-footer-link">Recover Access</Link>
            <Link href="/dashboard" className="lp-footer-link">Dashboard</Link>
            <Link href="/history" className="lp-footer-link">History</Link>
            <Link href="/chat" className="lp-footer-link">AI Chat</Link>
          </div>

          <div className="lp-footer-col">
            <span className="text-label lp-footer-heading">Access</span>
            <a href={MAC_DOWNLOAD_HREF} className="lp-footer-link">Download for Mac</a>
            <a href={WINDOWS_DOWNLOAD_HREF} className="lp-footer-link">Download for Windows</a>
            <a href={LINUX_STATUS_HREF} className="lp-footer-link">Linux status</a>
            <a
              href={UNIFIED_DESKTOP_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="lp-footer-link"
            >
              GitHub
            </a>
          </div>
        </div>

        <div className="lp-footer-bar">
          <p className="lp-footer-copy">
            <span className="lp-footer-year" title="Click me">&copy; 2026</span>{" "}
            Daylens. Free and open source.
          </p>
          <p className="lp-footer-copy">Built around work sessions, not app vanity metrics.</p>
        </div>
      </div>
    </footer>
  );
}
