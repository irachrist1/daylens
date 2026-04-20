import Image from "next/image";
import Link from "next/link";
import { Poller } from "@/app/components/Poller";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="glass-bg" aria-hidden="true" />
      {/* Desktop header */}
      <header className="hidden md:flex items-center justify-between px-6 py-4 glass-header">
        <Link href="/dashboard" className="flex items-center gap-2.5 text-xl font-bold text-primary no-underline">
          <Image src="/app-icon.png" alt="Daylens" width={28} height={28} style={{ borderRadius: 7 }} />
          Daylens
        </Link>
        <nav className="flex items-center gap-6">
          <Link href="/dashboard" className="text-sm text-on-surface-variant hover:text-on-surface transition-colors">
            Timeline
          </Link>
          <Link href="/apps" className="text-sm text-on-surface-variant hover:text-on-surface transition-colors">
            Apps
          </Link>
          <Link href="/chat" className="text-sm text-on-surface-variant hover:text-on-surface transition-colors">
            AI
          </Link>
          <Link href="/settings" className="text-sm text-on-surface-variant hover:text-on-surface transition-colors">
            Settings
          </Link>
        </nav>
      </header>

      {/* Main content */}
      <main className="flex-1 pb-20 md:pb-6">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 inset-x-0 md:hidden glass border-t border-outline-variant/15 z-50">
        <div className="flex justify-around py-1.5 px-1">
          <NavItem href="/dashboard" icon="chart" label="Timeline" />
          <NavItem href="/apps" icon="clock" label="Apps" />
          <NavItem href="/chat" icon="chat" label="AI" />
          <NavItem href="/settings" icon="gear" label="Settings" />
        </div>
      </nav>

      <Poller />
    </div>
  );
}

function NavItem({ href, icon, label }: { href: string; icon: string; label: string }) {
  const icons: Record<string, string> = {
    chart: "M3 13h2v8H3zm4-4h2v12H7zm4-3h2v15h-2zm4 5h2v10h-2zm4-8h2v18h-2z",
    clock: "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z",
    chat: "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12zM7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z",
    gear: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
  };

  return (
    <Link href={href} className="flex flex-col items-center gap-0.5 px-4 py-1 text-on-surface-variant hover:text-primary transition-colors">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d={icons[icon]} />
      </svg>
      <span className="text-[0.625rem] font-medium">{label}</span>
    </Link>
  );
}
