"use client";

import Link from "next/link";
import posthog from "posthog-js";
import { type ReactNode, useEffect, useRef } from "react";
import { MarketingFooter, MarketingInnerNav } from "./MarketingChrome";
import {
  LINUX_STATUS_HREF,
  MAC_DOWNLOAD_HREF,
  WINDOWS_DOWNLOAD_HREF,
} from "../lib/platformLinks";

const heroPills = [
  "macOS",
  "Windows",
  "Linux",
  "Local-first",
  "Evidence-grounded",
];

const guidingQuestions = [
  "How much time did I actually spend on Client X this month?",
  "What did I do between 2 and 4 pm on Wednesday?",
  "Show me everything I touched for Project X and what changed around it.",
];

const workflowSteps = [
  {
    step: "01",
    title: "Capture local evidence quietly",
    body:
      "Track apps, windows, browser activity, files, and other desktop signals while you work without turning your day into manual logging.",
  },
  {
    step: "02",
    title: "Reconstruct real work sessions",
    body:
      "Group the evidence into coherent blocks so one task can span multiple tools and still read like one piece of work.",
  },
  {
    step: "03",
    title: "Query or review what happened",
    body:
      "Open the timeline for proof, or ask grounded questions, summaries, and exports from the same underlying work history.",
  },
];

const featureCards = [
  {
    eyebrow: "Timeline first",
    title: "The proof surface is your workday history",
    body:
      "Daylens is built around sessions, artifacts, and context you can inspect directly, not a decorative dashboard of app counts.",
  },
  {
    eyebrow: "Cross-platform",
    title: "One product direction across laptop OSes",
    body:
      "The unified product direction is macOS, Windows, and Linux, with platform-specific validation where it matters.",
  },
  {
    eyebrow: "AI-ready",
    title: "Ask grounded questions about real work",
    body:
      "Use AI to investigate a client, repo, class, project, or workstream from tracked history instead of a vague memory.",
  },
  {
    eyebrow: "Desktop plus companion",
    title: "Pair the desktop app when browser access helps",
    body:
      "The desktop timeline stays primary, while the web companion gives you connected history, chat, and recovery flows when you need them.",
  },
];

const integrationCards = [
  {
    title: "Grounded AI today",
    body:
      "Freeform work-history questions, summaries, and exports should come from tracked local evidence, not a blank assistant prompt.",
  },
  {
    title: "Editor integrations by design",
    body:
      "Daylens is being shaped for editor-facing workflows too, including MCP-style context for tools like Claude Code and Cursor.",
  },
  {
    title: "Deterministic first, AI second",
    body:
      "The timeline and session reconstruction stay useful on their own. AI is an orchestration layer over local data, not the source of truth.",
  },
];

const privacyCards = [
  {
    title: "Raw capture belongs on your laptop",
    body:
      "The local database is the source of truth for what happened in your day, so your history stays inspectable even without cloud services.",
  },
  {
    title: "Sync should be explicit",
    body:
      "When you connect the companion, only the data you choose to sync should leave the device. Privacy is part of the product contract.",
  },
  {
    title: "Use AI on your terms",
    body:
      "Daylens should remain valuable without AI turned on, and grounded when you do enable it with the provider setup you trust.",
  },
];

const faqItems = [
  {
    question: "Is Daylens just an app-usage tracker?",
    answer:
      "No. Apps, tabs, files, websites, meetings, and windows are evidence. The main unit is the work session, so the goal is understanding what you were doing, how long it took, and what context surrounded it.",
  },
  {
    question: "Which platforms are part of the product?",
    answer:
      "Daylens is being built as one cross-platform product for macOS, Windows, and Linux. Platform-specific packaging and real-machine validation still matter, but the direction is unified.",
  },
  {
    question: "Do I need AI to get value from it?",
    answer:
      "No. The timeline is the primary proof surface. AI is there to help you query, summarize, and export grounded history once the underlying evidence already exists.",
  },
  {
    question: "Is the Spotify Wrapped-style recap fully shipped?",
    answer:
      "Not as the whole polished recap surface yet. Wrapped-style review is part of the product direction, but the launch-critical experience is the evidence-backed timeline and grounded AI over work history.",
  },
  {
    question: "Can Daylens feed tools like Claude Code or Cursor?",
    answer:
      "That is an explicit product direction. Daylens is being built to expose grounded work-history context for editor and agent workflows, including MCP-style integrations where they make sense.",
  },
];

type DownloadLinkProps = {
  href: string;
  label: string;
  platform: "mac" | "windows" | "linux";
  variant: "primary" | "glass" | "white" | "ghost";
  source?: string;
  children: ReactNode;
};

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

        const hero = Math.min(1, Math.max(0, y / (vh * 0.9)));
        const journey = docH > 0 ? Math.min(1, Math.max(0, y / docH)) : 0;

        root.style.setProperty("--hero-t", hero.toFixed(4));
        root.style.setProperty("--journey", journey.toFixed(4));

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
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("rv--visible");
              obs.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
      );
      els.forEach((el) => obs.observe(el));
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
      <path d="M20 3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-8 14H8v-2h4v2Zm6-4H6v-2h12v2Zm0-4H6V7h12v2Z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 8h9M8.5 4l4 4-4 4" />
    </svg>
  );
}

function DownloadLink({ href, label, platform, variant, source, children }: DownloadLinkProps) {
  return (
    <a
      href={href}
      className={`dl-btn dl-btn--${variant}`}
      onClick={() => posthog.capture("download_clicked", { platform, ...(source ? { source } : {}) })}
    >
      {children}
      {label}
    </a>
  );
}

/* ── Main ───────────────────────────────────────────────────────────── */
export function LandingClient() {
  useReveal();
  const { rootRef, screenshotRef } = useLandingScroll();

  return (
    <div ref={rootRef} className="dl">
      <div className="dl__sky" aria-hidden="true" />

      <MarketingInnerNav current="home" variant="capsule" landing />

      <main>
        <section className="dl-hero">
          <div className="dl-hero__content">
            <p className="dl-hero__tag lp-overline--recording rv">
              <span className="dl-hero__dot lp-recording-dot" aria-hidden="true" />
              Cross-platform laptop activity tracker
            </p>

            <h1 className="dl-hero__h1 rv rv--d1">
              Search your workday like it happened five minutes ago.
            </h1>

            <p className="dl-hero__sub rv rv--d2">
              Daylens quietly logs apps, windows, browser activity, files, and reconstructed work
              sessions so you and your AI tools can ask grounded questions about what actually
              happened. Local-first, evidence-grounded, and built as one product for macOS,
              Windows, and Linux.
            </p>

            <p className="dl-hero__meta rv rv--d3">
              Google for your workday history. Spotify Wrapped for how you actually spend your
              time.
            </p>

            <div className="dl-hero__pills rv rv--d3" aria-label="Product highlights">
              {heroPills.map((pill) => (
                <span key={pill} className="dl-chip">
                  {pill}
                </span>
              ))}
            </div>

            <div className="dl-hero__cta rv rv--d4">
              <DownloadLink
                href={MAC_DOWNLOAD_HREF}
                label="Download for Mac"
                platform="mac"
                variant="primary"
              >
                <AppleIcon />
              </DownloadLink>
              <DownloadLink
                href={WINDOWS_DOWNLOAD_HREF}
                label="Download for Windows"
                platform="windows"
                variant="glass"
              >
                <WindowsIcon />
              </DownloadLink>
              <DownloadLink
                href={LINUX_STATUS_HREF}
                label="Linux Status"
                platform="linux"
                variant="glass"
              >
                <LinuxIcon />
              </DownloadLink>
            </div>

            <div className="dl-links dl-links--hero rv rv--d4">
              <a href="#how-it-works" className="dl-link">
                How it works <ArrowIcon />
              </a>
              <Link href="/docs" className="dl-link">
                Read the docs <ArrowIcon />
              </Link>
              <Link href="/link" className="dl-link">
                Connect desktop app <ArrowIcon />
              </Link>
            </div>
          </div>

          <div className="dl-screenshot rv rv--d4" ref={screenshotRef}>
            <div className="dl-screenshot__glow" aria-hidden="true" />
            <div className="dl-screenshot__frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/daylens/screenshots/screenshot-timeline.png"
                alt="Daylens timeline showing reconstructed work sessions and supporting evidence"
                className="dl-screenshot__img"
                width={1200}
                height={800}
                loading="eager"
                decoding="async"
              />
            </div>
          </div>
        </section>

        <section className="dl-section dl-section--light" id="story">
          <div className="dl-shell dl-story">
            <div className="dl-prose dl-prose--left">
              <p className="dl-label rv">Why Daylens</p>
              <h2 className="dl-heading rv rv--d1">
                Work sessions first.
                <br />
                <span className="dl-heading--muted">Not app vanity metrics.</span>
              </h2>
              <p className="dl-body rv rv--d2">
                Daylens is for understanding a client, repo, class, research thread, or internal
                project across all the tools that touched it. Apps, tabs, files, meetings, and
                windows are evidence. The story is the work.
              </p>
            </div>

            <div className="dl-question-grid">
              {guidingQuestions.map((question, index) => (
                <article key={question} className={`dl-question rv rv--d${index + 1}`}>
                  <span className="dl-question__kicker">Question {index + 1}</span>
                  <p className="dl-question__body">{question}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="dl-section dl-section--mist" id="how-it-works">
          <div className="dl-shell">
            <div className="dl-section-head dl-section-head--center">
              <p className="dl-label rv">How it works</p>
              <h2 className="dl-heading rv rv--d1">A timeline that stays grounded in evidence.</h2>
              <p className="dl-body rv rv--d2">
                The local database on your laptop is the source of truth. Daylens captures desktop
                evidence quietly, reconstructs coherent work blocks, and then lets you inspect or
                query them without pretending AI is the product.
              </p>
            </div>

            <div className="dl-steps">
              {workflowSteps.map((item, index) => (
                <article key={item.step} className={`dl-step rv rv--d${index + 1}`}>
                  <span className="dl-step__num">{item.step}</span>
                  <h3 className="dl-step__title">{item.title}</h3>
                  <p className="dl-step__body">{item.body}</p>
                </article>
              ))}
            </div>

            <p className="dl-caption rv rv--d3">
              Timeline first. AI second. The goal is honest answers backed by what your day
              actually contained.
            </p>
          </div>
        </section>

        <section className="dl-section dl-section--cards" id="features">
          <div className="dl-shell">
            <div className="dl-section-head">
              <p className="dl-label rv">Product shape</p>
              <h2 className="dl-heading rv rv--d1">
                Built for desktop work, companion access, and grounded recall.
              </h2>
              <p className="dl-body rv rv--d2">
                The current product story is simple: track locally, reconstruct clearly, and make
                that history useful to you and your tools later.
              </p>
            </div>

            <div className="dl-features dl-features--wide">
              {featureCards.map((card, index) => (
                <article key={card.title} className={`dl-feature rv rv--d${(index % 3) + 1}`}>
                  <p className="dl-feature__eyebrow">{card.eyebrow}</p>
                  <h3 className="dl-feature__title">{card.title}</h3>
                  <p className="dl-feature__body">{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="dl-section dl-section--plain" id="integrations">
          <div className="dl-shell dl-split">
            <div className="dl-panel dl-panel--dark rv">
              <p className="dl-label dl-label--light">AI and editors</p>
              <h2 className="dl-panel__title">
                Built to feed tools context,
                <br />
                not trap it in another dashboard.
              </h2>
              <p className="dl-panel__body">
                Daylens is AI-ready now and being shaped for editor-facing workflows too, including
                MCP-style context paths for tools like Claude Code and Cursor. The idea is to let
                your tools ask what actually happened in your day instead of guessing from fragments.
              </p>
            </div>

            <div className="dl-stack">
              {integrationCards.map((card, index) => (
                <article key={card.title} className={`dl-mini-card rv rv--d${index + 1}`}>
                  <h3 className="dl-mini-card__title">{card.title}</h3>
                  <p className="dl-mini-card__body">{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="dl-section dl-section--privacy" id="privacy">
          <div className="dl-shell">
            <div className="dl-section-head">
              <p className="dl-label rv">Privacy</p>
              <h2 className="dl-heading rv rv--d1">Local-first by default.</h2>
              <p className="dl-body rv rv--d2">
                Raw capture belongs on your machine, and the same evidence should stay useful even
                if you never turn on AI. Privacy is not a settings afterthought. It is part of the
                product contract.
              </p>
            </div>

            <div className="dl-privacy-grid">
              {privacyCards.map((card, index) => (
                <article key={card.title} className={`dl-privacy-card rv rv--d${index + 1}`}>
                  <h3 className="dl-privacy-card__title">{card.title}</h3>
                  <p className="dl-privacy-card__body">{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="dl-section dl-section--faq" id="faq">
          <div className="dl-shell dl-shell--narrow">
            <div className="dl-section-head dl-section-head--center">
              <p className="dl-label rv">FAQ</p>
              <h2 className="dl-heading rv rv--d1">What Daylens is, and what it is not.</h2>
            </div>

            <div className="dl-faq">
              {faqItems.map((item, index) => (
                <details key={item.question} className={`dl-faq__item rv rv--d${(index % 3) + 1}`}>
                  <summary className="dl-faq__question">{item.question}</summary>
                  <p className="dl-faq__answer">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="dl-final">
          <div className="dl-final__inner rv">
            <h2 className="dl-final__h2">Build your work history once.</h2>
            <p className="dl-final__sub">
              Install Daylens on macOS or Windows today, and track Linux rollout through the
              unified Daylens repo.
            </p>
            <div className="dl-final__cta">
              <DownloadLink
                href={MAC_DOWNLOAD_HREF}
                label="Download for Mac"
                platform="mac"
                variant="white"
                source="finale"
              >
                <AppleIcon />
              </DownloadLink>
              <DownloadLink
                href={WINDOWS_DOWNLOAD_HREF}
                label="Download for Windows"
                platform="windows"
                variant="ghost"
                source="finale"
              >
                <WindowsIcon />
              </DownloadLink>
              <DownloadLink
                href={LINUX_STATUS_HREF}
                label="Linux Status"
                platform="linux"
                variant="ghost"
                source="finale"
              >
                <LinuxIcon />
              </DownloadLink>
            </div>
            <div className="dl-links dl-links--final">
              <Link href="/docs" className="dl-link">
                Read documentation <ArrowIcon />
              </Link>
              <Link href="/link" className="dl-link">
                Connect the companion <ArrowIcon />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter variant="minimal" />
    </div>
  );
}
