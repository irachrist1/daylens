"use client";

import Link from "next/link";
import posthog from "posthog-js";
import { useEffect, useRef } from "react";
import { MarketingFooter, MarketingInnerNav } from "./MarketingChrome";

/* ── Scroll-driven custom properties ────────────────────────────────── */
function useLandingScroll() {
  const rootRef = useRef<HTMLDivElement>(null);
  const screenshotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let raf = 0;
    const tick = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = window.scrollY;
        const vh = window.innerHeight;
        const docH = document.documentElement.scrollHeight - vh;

        // 0→1 over first viewport
        const hero = Math.min(1, Math.max(0, y / (vh * 0.9)));
        // 0→1 over full page
        const journey = docH > 0 ? Math.min(1, Math.max(0, y / docH)) : 0;

        root.style.setProperty("--hero-t", hero.toFixed(4));
        root.style.setProperty("--journey", journey.toFixed(4));

        // Parallax on screenshot
        if (screenshotRef.current) {
          const t = Math.min(1, y / 600);
          const ease = 1 - Math.pow(1 - t, 3);
          screenshotRef.current.style.transform = `translate3d(0, ${ease * 30}px, 0) scale(${1 - ease * 0.03})`;
        }
      });
    };

    tick();
    window.addEventListener("scroll", tick, { passive: true });
    window.addEventListener("resize", tick, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", tick);
      window.removeEventListener("resize", tick);
    };
  }, []);

  return { rootRef, screenshotRef };
}

/* ── Intersection-based reveal ──────────────────────────────────────── */
function useReveal() {
  useEffect(() => {
    const timer = setTimeout(() => {
      const els = document.querySelectorAll(".rv");
      const obs = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add("rv--visible");
              obs.unobserve(e.target);
            }
          });
        },
        { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
      );
      els.forEach((el) => obs.observe(el));
      return () => obs.disconnect();
    }, 100);
    return () => clearTimeout(timer);
  }, []);
}

/* ── Icons ──────────────────────────────────────────────────────────── */
function AppleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.36-1.09-.46-2.08-.48-3.22 0-1.43.62-2.18.44-3.04-.36C2.82 15.22 3.54 7.59 9.09 7.31c1.35.07 2.3.74 3.09.8 1.18-.24 2.3-.93 3.56-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.3 2.98-2.57 4.08ZM12.09 7.27c-.15-2.23 1.66-4.07 3.75-4.27.29 2.58-2.07 4.52-3.75 4.27Z" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M0 2.357L6.545 1.5v6H0V2.357zM7.273 1.393L16 0v7.5H7.273V1.393zM0 8.5h6.545v6L0 13.643V8.5zM7.273 8.5H16V16l-8.727-1.393V8.5z" />
    </svg>
  );
}

function LinuxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20 3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-8 14H8v-2h4v2Zm6-4H6v-2h12v2Zm0-4H6V7h12v2Z"/>
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8h9M8.5 4l4 4-4 4" />
    </svg>
  );
}

/* ── Main ───────────────────────────────────────────────────────────── */
export function LandingClient() {
  useReveal();
  const { rootRef, screenshotRef } = useLandingScroll();

  return (
    <div ref={rootRef} className="dl">
      {/* Gradient sky */}
      <div className="dl__sky" aria-hidden="true" />

      <MarketingInnerNav current="home" variant="capsule" landing />

      <main>
        {/* ─── Hero ─── */}
        <section className="dl-hero">
          <div className="dl-hero__content">
            <p className="dl-hero__tag lp-overline--recording rv">
              <span className="dl-hero__dot lp-recording-dot" aria-hidden="true" />
              Private by design
            </p>

            <h1 className="dl-hero__h1 rv rv--d1">
              Know where your
              <br />
              time goes.
            </h1>

            <p className="dl-hero__sub rv rv--d2">
              Daylens quietly watches your apps and sites, keeps everything on&nbsp;your device, and turns it into a clear timeline — with optional AI on&nbsp;your terms.
            </p>

            <div className="dl-hero__cta rv rv--d3">
              <a
                href="/daylens/api/download/mac"
                className="dl-btn dl-btn--primary"
                onClick={() => posthog.capture("download_clicked", { platform: "mac" })}
              >
                <AppleIcon />
                Download for Mac
              </a>
              <a
                href="/daylens/api/download/windows"
                className="dl-btn dl-btn--glass"
                onClick={() => posthog.capture("download_clicked", { platform: "windows" })}
              >
                <WindowsIcon />
                Download for Windows
              </a>
              <a
                href="/daylens/api/download/linux"
                className="dl-btn dl-btn--glass"
                onClick={() => posthog.capture("download_clicked", { platform: "linux" })}
              >
                <LinuxIcon />
                Download for Linux
              </a>
            </div>
          </div>

          {/* Floating screenshot */}
          <div className="dl-screenshot" ref={screenshotRef}>
            <div className="dl-screenshot__glow" aria-hidden="true" />
            <div className="dl-screenshot__frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/daylens/screenshots/screenshot-dashboard.png"
                alt="Daylens dashboard showing your daily activity timeline"
                className="dl-screenshot__img"
                width={1200}
                height={800}
                loading="eager"
                decoding="async"
              />
            </div>
          </div>
        </section>

        {/* ─── Statement ─── */}
        <section className="dl-section dl-section--light">
          <div className="dl-prose">
            <p className="dl-label rv">Clarity</p>
            <h2 className="dl-heading rv rv--d1">
              Not screen time.<br />
              <span className="dl-heading--muted">Real context.</span>
            </h2>
            <p className="dl-body rv rv--d2">
              Named work sessions across every app and browser tab — no extensions, no screenshots. Open any day and see exactly what you did.
            </p>
          </div>
        </section>

        {/* ─── Features ─── */}
        <section className="dl-section dl-section--cards">
          <div className="dl-features">
            <article className="dl-feature rv">
              <h3 className="dl-feature__title">Local first</h3>
              <p className="dl-feature__body">
                Raw activity stays on your machine. The web companion only sees what you explicitly sync. No account required.
              </p>
            </article>
            <article className="dl-feature rv rv--d1">
              <h3 className="dl-feature__title">AI on your keys</h3>
              <p className="dl-feature__body">
                Ask questions in plain language using your own provider. Grounded in your history, bounded by your rules.
              </p>
            </article>
            <article className="dl-feature rv rv--d2">
              <h3 className="dl-feature__title">Web companion</h3>
              <p className="dl-feature__body">
                Pair once from the desktop app. Dashboard, history, and chat in the browser — where you already are.
              </p>
            </article>
          </div>

          <div className="dl-links rv rv--d3">
            <Link href="/docs" className="dl-link">
              How it works <ArrowIcon />
            </Link>
            <Link href="/link" className="dl-link">
              Connect device <ArrowIcon />
            </Link>
          </div>
        </section>

        {/* ─── Final CTA ─── */}
        <section className="dl-final">
          <div className="dl-final__inner rv">
            <h2 className="dl-final__h2">Start seeing clearly.</h2>
            <p className="dl-final__sub">
              Free for Mac, Windows, and Linux. AI is yours to enable — or&nbsp;ignore.
            </p>
            <div className="dl-final__cta">
              <a
                href="/daylens/api/download/mac"
                className="dl-btn dl-btn--white"
                onClick={() => posthog.capture("download_clicked", { platform: "mac", source: "finale" })}
              >
                <AppleIcon />
                Download for Mac
              </a>
              <a
                href="/daylens/api/download/windows"
                className="dl-btn dl-btn--ghost"
                onClick={() => posthog.capture("download_clicked", { platform: "windows", source: "finale" })}
              >
                <WindowsIcon />
                Windows
              </a>
              <a
                href="/daylens/api/download/linux"
                className="dl-btn dl-btn--ghost"
                onClick={() => posthog.capture("download_clicked", { platform: "linux", source: "finale" })}
              >
                <LinuxIcon />
                Linux
              </a>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter variant="minimal" />
    </div>
  );
}
