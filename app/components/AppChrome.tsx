"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Poller } from "@/app/components/Poller";

type NavDef = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

function IconTimeline() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="4" x2="12" y2="4" />
      <line x1="4" y1="8" x2="10" y2="8" />
      <line x1="4" y1="12" x2="13" y2="12" />
      <circle cx="2.5" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle cx="2.5" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="2.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconApps() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="5" height="5" rx="1.5" />
      <rect x="9" y="2" width="5" height="5" rx="1.5" />
      <rect x="2" y="9" width="5" height="5" rx="1.5" />
      <rect x="9" y="9" width="5" height="5" rx="1.5" />
    </svg>
  );
}

function IconAI() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2c-.8 2-3 3-3 5.5a3 3 0 0 0 6 0C11 5 8.8 4 8 2z" />
      <path d="M6.5 13.5h3" />
      <path d="M8 13v2" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.4v1.2M8 13.4v1.2M1.4 8h1.2M13.4 8h1.2M3.25 3.25l.85.85M11.9 11.9l.85.85M3.25 12.75l.85-.85M11.9 4.1l.85-.85" />
      <circle cx="8" cy="8" r="5.1" opacity="0.7" />
    </svg>
  );
}

const PRIMARY_NAV: NavDef[] = [
  { href: "/dashboard", label: "Timeline", icon: <IconTimeline /> },
  { href: "/apps", label: "Apps", icon: <IconApps /> },
  { href: "/chat", label: "AI", icon: <IconAI /> },
];

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname.startsWith("/dashboard") || pathname.startsWith("/history");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({ item, pathname, compact = false }: { item: NavDef; pathname: string; compact?: boolean }) {
  const active = isActivePath(pathname, item.href);

  return (
    <Link
      href={item.href}
      className={`daylens-nav-item ${active ? "daylens-nav-item--active" : ""} ${compact ? "daylens-nav-item--compact" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      <span className="daylens-nav-item__icon">{item.icon}</span>
      <span className="daylens-nav-item__label">{item.label}</span>
    </Link>
  );
}

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="daylens-shell">
      <div className="glass-bg" aria-hidden="true" />
      <aside className="daylens-sidebar">
        <Link href="/dashboard" className="daylens-brand">
          <Image src="/app-icon.png" alt="Daylens" width={30} height={30} style={{ borderRadius: 8 }} />
          <span>Daylens</span>
        </Link>
        <nav className="daylens-sidebar__nav">
          {PRIMARY_NAV.map((item) => (
            <NavItem key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
        <div className="daylens-sidebar__footer">
          <NavItem item={{ href: "/settings", label: "Settings", icon: <IconSettings /> }} pathname={pathname} />
        </div>
      </aside>

      <div className="daylens-mobile-top md:hidden">
        <Link href="/dashboard" className="daylens-brand daylens-brand--mobile">
          <Image src="/app-icon.png" alt="Daylens" width={28} height={28} style={{ borderRadius: 8 }} />
          <span>Daylens</span>
        </Link>
      </div>

      <div className="daylens-shell__content">
        <main className="daylens-main">{children}</main>
      </div>

      <nav className="daylens-mobile-nav md:hidden">
        {PRIMARY_NAV.map((item) => (
          <NavItem key={item.href} item={item} pathname={pathname} compact />
        ))}
        <NavItem item={{ href: "/settings", label: "Settings", icon: <IconSettings /> }} pathname={pathname} compact />
      </nav>

      <Poller />
    </div>
  );
}
