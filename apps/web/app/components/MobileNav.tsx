"use client";

import { useState } from "react";
import Link from "next/link";

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="landing-nav-mobile">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="landing-hamburger"
        aria-label="Open menu"
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        )}
      </button>

      {open && (
        <div className="landing-mobile-menu" onClick={() => setOpen(false)}>
          <Link href="/link" className="landing-mobile-link landing-mobile-link-accent">
            Connect Device
          </Link>
          <Link href="/link" className="landing-mobile-link-btn">
            Open Dashboard
          </Link>
        </div>
      )}
    </div>
  );
}
