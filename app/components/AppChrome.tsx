"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
      <path d="M9 1.5 10.5 7.5 16.5 9 10.5 10.5 9 16.5 7.5 10.5 1.5 9 7.5 7.5Z" fillOpacity="0.92" />
      <circle cx="14.5" cy="3" r="1.1" fillOpacity="0.5" />
      <circle cx="14" cy="14" r="0.8" fillOpacity="0.4" />
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

function NavItem({
  item,
  pathname,
  compact = false,
  collapsed = false,
}: {
  item: NavDef;
  pathname: string;
  compact?: boolean;
  collapsed?: boolean;
}) {
  const active = isActivePath(pathname, item.href);

  return (
    <Link
      href={item.href}
      className={`daylens-nav-item ${active ? "daylens-nav-item--active" : ""} ${compact ? "daylens-nav-item--compact" : ""} ${collapsed ? "daylens-nav-item--collapsed" : ""}`}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
    >
      <span className="daylens-nav-item__icon">{item.icon}</span>
      <span className="daylens-nav-item__label">{item.label}</span>
    </Link>
  );
}

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("daylens-web:sidebar-collapsed");
    if (stored === "1") {
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("daylens-web:sidebar-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  return (
    <div className={`daylens-shell ${collapsed ? "daylens-shell--collapsed" : ""}`}>
      <div className="glass-bg" aria-hidden="true" />
      <aside className="daylens-sidebar">
        <div className="daylens-sidebar__frame">
          <div className="daylens-sidebar__header">
            <Link href="/dashboard" className="daylens-brand" title="Daylens">
              <Image src="/app-icon.png" alt="Daylens" width={30} height={30} style={{ borderRadius: 8 }} />
              <span>Daylens</span>
            </Link>
            <button
              type="button"
              className="daylens-sidebar__toggle"
              onClick={() => setCollapsed((current) => !current)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                {collapsed ? <path d="m6 3.5 4.5 4.5L6 12.5" /> : <path d="M10 3.5 5.5 8 10 12.5" />}
              </svg>
            </button>
          </div>
          <nav className="daylens-sidebar__nav">
            {PRIMARY_NAV.map((item) => (
              <NavItem key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
            ))}
          </nav>
          <div className="daylens-sidebar__footer">
            <NavItem
              item={{ href: "/settings", label: "Settings", icon: <IconSettings /> }}
              pathname={pathname}
              collapsed={collapsed}
            />
          </div>
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
