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

/* ── Static data ─────────────────────────────────────────────────── */

const timelineBlocks = [
  { label: "VS Code", app: "Code", t: "09:12 — 10:48", kind: "code", w: 14 },
  { label: "Figma", app: "Design", t: "10:48 — 11:30", kind: "design", w: 6 },
  { label: "Meeting", app: "Zoom", t: "11:30 — 12:00", kind: "meet", w: 4 },
  { label: "Lunch", app: "—", t: "12:00 — 12:45", kind: "break", w: 5 },
  { label: "Terminal", app: "iTerm", t: "12:45 — 14:10", kind: "code", w: 12 },
  { label: "Notion", app: "Writing", t: "14:10 — 15:02", kind: "write", w: 7 },
  { label: "Linear", app: "Review", t: "15:02 — 15:40", kind: "write", w: 5 },
  { label: "Browser", app: "Research", t: "15:40 — 17:22", kind: "read", w: 14 },
  { label: "Deep work", app: "Code", t: "17:22 — 19:08", kind: "code", w: 15 },
];

const conversation = [
  {
    q: "Time on Client X this week?",
    a: "Breaks the week into sessions, tools used, and supporting evidence.",
  },
  {
    q: "Wednesday, 2–4pm?",
    a: "Reconstructs the block from windows, browser activity, and artifacts.",
  },
  {
    q: "Everything for Project Atlas.",
    a: "Shows the sessions Daylens can support today, then lets AI summarize or export them.",
  },
];

const pillars = [
  {
    num: "01",
    eyebrow: "Local-first",
    title: "Your machine is the source of truth.",
    body: "A SQLite database on your laptop. Inspectable. Offline. Sync is opt-in.",
    meta: "~/Library/.../daylens.sqlite",
  },
  {
    num: "02",
    eyebrow: "Cross-platform",
    title: "One Daylens, every laptop.",
    body: "Same schema, same timeline, same answers — on Mac, Windows, and Linux.",
    meta: "macOS · Windows · Linux",
  },
  {
    num: "03",
    eyebrow: "AI-ready",
    title: "Grounded in what actually happened.",
    body: "The AI surface works from local evidence first. Editor and MCP-style handoff is real direction, not fake present tense.",
    meta: "Grounded AI today · editor handoff next",
  },
];

const faqItems = [
  {
    question: "Is this just an app-usage tracker?",
    answer: "No. Apps, tabs, files, meetings, windows are evidence. The unit is the work session — what you did, for how long, and what surrounded it.",
  },
  {
    question: "Which platforms?",
    answer: "macOS and Windows have public download paths today. Linux is part of the product too, but real-machine validation is still incomplete.",
  },
  {
    question: "Do I need AI for it to be useful?",
    answer: "No. The timeline is the product. AI sits on top — it never invents history.",
  },
  {
    question: "Is the Wrapped-style recap shipped?",
    answer: "A deterministic daily, weekly, and monthly recap now exists inside AI, but it still needs broader validation before it should be called fully shipped.",
  },
  {
    question: "Can it feed Claude Code or Cursor?",
    answer: "That direction is real. Daylens is being shaped for MCP-style and editor-facing handoff, but those integrations are not the polished finished story yet.",
  },
];

/* ── Hooks ───────────────────────────────────────────────────────── */

function useScrollVar() {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    const tick = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = window.scrollY;
        const vh = window.innerHeight;
        const docH = Math.max(1, document.documentElement.scrollHeight - vh);
        root.style.setProperty("--hero-t", Math.min(1, y / (vh * 0.9)).toFixed(4));
        root.style.setProperty("--journey", Math.min(1, y / docH).toFixed(4));
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
  return rootRef;
}

function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".rv"));
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("rv--in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -60px 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

function useCursorShine() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".lx-shine"));
    const onMove = (e: PointerEvent) => {
      const el = e.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
      el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
    };
    els.forEach((el) => el.addEventListener("pointermove", onMove as EventListener));
    return () => {
      els.forEach((el) => el.removeEventListener("pointermove", onMove as EventListener));
    };
  }, []);
}

/* ── Icons ───────────────────────────────────────────────────────── */

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
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8h9M8.5 4l4 4-4 4" />
    </svg>
  );
}

type BtnProps = {
  href: string;
  label: string;
  platform: "mac" | "windows" | "linux";
  variant: "solid" | "ghost" | "ghost-dark";
  source?: string;
  icon: ReactNode;
};

function DownloadBtn({ href, label, platform, variant, source, icon }: BtnProps) {
  return (
    <a
      href={href}
      className={`lx-btn lx-btn--${variant}`}
      onClick={() => posthog.capture("download_clicked", { platform, ...(source ? { source } : {}) })}
    >
      <span className="lx-btn__ic" aria-hidden="true">{icon}</span>
      <span className="lx-btn__lbl">{label}</span>
      <span className="lx-btn__arr" aria-hidden="true"><ArrowIcon /></span>
    </a>
  );
}

/* ── Timeline strip ──────────────────────────────────────────────── */

function TimelineStrip({ compact = false }: { compact?: boolean }) {
  const total = timelineBlocks.reduce((s, b) => s + b.w, 0);
  return (
    <div className={`lx-timeline ${compact ? "lx-timeline--compact" : ""}`} aria-hidden="true">
      <div className="lx-timeline__axis">
        {["9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19"].map((h) => (
          <span key={h} className="lx-timeline__tick">{h}</span>
        ))}
      </div>
      <div className="lx-timeline__track">
        {timelineBlocks.map((b, i) => (
          <div
            key={i}
            className={`lx-block lx-block--${b.kind} rv`}
            style={{ flex: b.w, animationDelay: `${i * 0.08}s`, ["--pct" as string]: `${(b.w / total) * 100}%` }}
          >
            <span className="lx-block__dot" />
            <span className="lx-block__label">{b.label}</span>
            <span className="lx-block__meta">{b.t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main ────────────────────────────────────────────────────────── */

export function LandingClient() {
  useReveal();
  useCursorShine();
  const rootRef = useScrollVar();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const raf = requestAnimationFrame(() => root.classList.add("lx--ready"));
    return () => cancelAnimationFrame(raf);
  }, [rootRef]);

  return (
    <div ref={rootRef} className="lx">
      <div className="lx__grain" aria-hidden="true" />
      <div className="lx__aurora" aria-hidden="true" />

      <MarketingInnerNav current="home" variant="capsule" landing />

      <main>
        {/* ── HERO ── */}
        <section className="lx-hero">
          <div className="lx-hero__inner">
            <div className="lx-hero__copy">
              <p className="lx-kicker">
                <span className="lx-kicker__dot" />
                <span className="lx-kicker__mono">beta</span>
                <span className="lx-kicker__sep">/</span>
                <span>macOS &amp; Windows</span>
              </p>

              <h1 className="lx-hero__h1">
                <span className="lx-hero__word">Your&nbsp;laptop</span>{" "}
                <span className="lx-hero__word lx-hero__word--serif">remembers.</span>
                <span className="lx-hero__line2">
                  <span className="lx-hero__muted">Just</span>{" "}
                  <span className="lx-hero__word lx-hero__word--serif lx-hero__word--accent">ask.</span>
                </span>
              </h1>

              <p className="lx-hero__sub">
                Quietly captures app, window, browser, and session evidence so yesterday&apos;s
                work is easier to recover without guesswork.
              </p>

              <div className="lx-hero__ctas">
                <DownloadBtn href={MAC_DOWNLOAD_HREF} label="Mac" platform="mac" variant="solid" icon={<AppleIcon />} />
                <DownloadBtn href={WINDOWS_DOWNLOAD_HREF} label="Windows" platform="windows" variant="ghost" icon={<WindowsIcon />} />
                <DownloadBtn href={LINUX_STATUS_HREF} label="Linux" platform="linux" variant="ghost" icon={<LinuxIcon />} />
              </div>

              <ul className="lx-hero__pills">
                <li><span className="lx-hero__pill-mark" /> Free in beta</li>
                <li><span className="lx-hero__pill-mark" /> Local-first</li>
                <li><span className="lx-hero__pill-mark" /> No cloud by default</li>
              </ul>
            </div>

            <aside className="lx-hero__side" aria-hidden="true">
              <div className="lx-side-card">
                <div className="lx-side-card__row">
                  <span className="lx-side-card__lbl">Example day</span>
                  <span className="lx-side-card__val">Reconstructed</span>
                </div>
                <div className="lx-side-card__metric">
                  <span className="lx-side-card__big">8h 47m</span>
                  <span className="lx-side-card__delta">+1h 12m vs. avg</span>
                </div>
                <div className="lx-side-card__bar">
                  <span className="lx-bar lx-bar--code" style={{ flex: 36 }} />
                  <span className="lx-bar lx-bar--write" style={{ flex: 22 }} />
                  <span className="lx-bar lx-bar--design" style={{ flex: 14 }} />
                  <span className="lx-bar lx-bar--meet" style={{ flex: 8 }} />
                  <span className="lx-bar lx-bar--read" style={{ flex: 20 }} />
                </div>
                <dl className="lx-side-card__list">
                  <div><dt>Code</dt><dd>3h 08m</dd></div>
                  <div><dt>Writing</dt><dd>1h 52m</dd></div>
                  <div><dt>Research</dt><dd>1h 44m</dd></div>
                  <div><dt>Design</dt><dd>1h 12m</dd></div>
                  <div><dt>Meetings</dt><dd>51m</dd></div>
                </dl>
              </div>
              <div className="lx-ping" aria-hidden="true">
                <span className="lx-ping__dot" /> live on localhost
              </div>
            </aside>
          </div>

          <div className="lx-hero__ribbon">
            <span className="lx-hero__ribbon-lbl">Today</span>
            <TimelineStrip />
          </div>
        </section>

        {/* ── MARQUEE: contexts ── */}
        <section className="lx-marquee" aria-hidden="true">
          <div className="lx-marquee__track">
            {Array.from({ length: 2 }).map((_, g) => (
              <div key={g} className="lx-marquee__group">
                {["VS Code", "Figma", "Notion", "Linear", "Chrome", "Safari", "iTerm", "Zoom", "Slack", "Claude", "Cursor", "Xcode", "Obsidian", "Arc"].map((w) => (
                  <span key={`${g}-${w}`} className="lx-marquee__item">
                    <span className="lx-marquee__tick" /> {w}
                  </span>
                ))}
              </div>
            ))}
          </div>
          <p className="lx-marquee__caption">Tracked locally. No keystrokes, no screenshots, no cloud by default.</p>
        </section>

        {/* ── PROBLEM ── */}
        <section className="lx-section lx-section--cream" id="problem">
          <div className="lx-shell lx-editorial">
            <div className="lx-editorial__rail">
              <span className="lx-editorial__num">§ 01</span>
              <span className="lx-editorial__tag">The problem</span>
            </div>
            <div className="lx-editorial__lede">
              <h2 className="lx-display">
                You closed your laptop at 7pm.
                <span className="lx-display__italic"> By morning, half is gone.</span>
              </h2>
              <p className="lx-editorial__body">
                Thirty tabs, forty files, a dozen conversations — gone by Monday.
                Daylens remembers them for you. Locally.
              </p>
            </div>
            <aside className="lx-editorial__quote">
              <p>
                <span className="lx-editorial__quote-mark">“</span>
                I need my laptop to <em>tell me what I did.</em>
              </p>
            </aside>
          </div>
        </section>

        {/* ── DEMO: ask anything ── */}
        <section className="lx-section lx-section--dark" id="demo">
          <div className="lx-shell lx-demo">
            <div className="lx-demo__intro">
              <span className="lx-editorial__num lx-editorial__num--light">§ 02</span>
              <h2 className="lx-display lx-display--light">
                Ask what happened.
                <span className="lx-display__italic"> Get real evidence.</span>
              </h2>
              <p className="lx-demo__sub">
                Sessions are the unit. Apps, tabs, files, and follow-up context hang off them.
              </p>
            </div>

            <div className="lx-demo__panes">
              <div className="lx-terminal rv lx-shine">
                <div className="lx-terminal__bar">
                  <span className="lx-terminal__dot" />
                  <span className="lx-terminal__dot" />
                  <span className="lx-terminal__dot" />
                  <span className="lx-terminal__title">daylens — zsh — 92×24</span>
                </div>
                <div className="lx-terminal__body">
                  <p><span className="lx-term-path">~/projects</span> <span className="lx-term-prompt">❯</span> daylens today</p>
                  <p className="lx-term-out">Reconstructed from tracked local evidence: sessions, tools, artifacts, and timeline context.</p>
                  <p><span className="lx-term-path">~/projects</span> <span className="lx-term-prompt">❯</span> daylens ask &quot;what broke the auth flow yesterday?&quot;</p>
                  <p className="lx-term-out">
                    <span className="lx-term-note">15:24</span> traced work across code, browser checks, and follow-up fixes<br />
                    <span className="lx-term-note">15:41</span> the answer stays tied to timeline evidence, not a made-up summary<br />
                    <span className="lx-term-note">16:02</span> exports and follow-up questions can build from the same history
                  </p>
                  <p><span className="lx-term-path">~/projects</span> <span className="lx-term-prompt">❯</span> <span className="lx-term-cursor" /></p>
                </div>
              </div>

              <div className="lx-chat rv lx-shine">
                <div className="lx-chat__head">
                  <span className="lx-chat__avatar">D</span>
                  <div>
                    <p className="lx-chat__name">Daylens</p>
                    <p className="lx-chat__status"><span className="lx-chat__dot" /> local · evidence mode</p>
                  </div>
                </div>
                <div className="lx-chat__feed">
                  {conversation.map((c, i) => (
                    <div key={c.q} className={`lx-chat__pair rv`} style={{ transitionDelay: `${0.1 * i}s` }}>
                      <div className="lx-bubble lx-bubble--q">{c.q}</div>
                      <div className="lx-bubble lx-bubble--a">
                        <span className="lx-bubble__prefix" aria-hidden="true">↳</span>
                        {c.a}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="lx-chat__composer">
                  <span className="lx-chat__composer-mark">/</span>
                  <span>Ask about a client, project, repo, or block…</span>
                  <span className="lx-chat__composer-kbd">⏎</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── PILLARS ── */}
        <section className="lx-section lx-section--bone" id="features">
          <div className="lx-shell lx-pillars">
            <div className="lx-pillars__head">
              <span className="lx-editorial__num">§ 03</span>
              <h2 className="lx-display">
                Three quiet guarantees.
                <span className="lx-display__italic"> The rest follows.</span>
              </h2>
            </div>

            <div className="lx-pillars__grid">
              {pillars.map((p, i) => (
                <article key={p.num} className={`lx-pillar rv lx-shine`} style={{ transitionDelay: `${i * 0.12}s` }}>
                  <div className="lx-pillar__head">
                    <span className="lx-pillar__num">{p.num}</span>
                    <span className="lx-pillar__eyebrow">{p.eyebrow}</span>
                  </div>
                  <h3 className="lx-pillar__title">{p.title}</h3>
                  <p className="lx-pillar__body">{p.body}</p>
                  <p className="lx-pillar__meta">{p.meta}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── AI INTEGRATIONS ── */}
        <section className="lx-section lx-section--dark lx-section--ai" id="integrations">
          <div className="lx-shell lx-ai">
            <div className="lx-ai__copy">
              <span className="lx-editorial__num lx-editorial__num--light">§ 04</span>
              <h2 className="lx-display lx-display--light">
                Context your AI
                <span className="lx-display__italic"> can actually trust.</span>
              </h2>
              <p className="lx-ai__body">
                Daylens feeds tools real evidence instead of trapping your history in another
                dashboard. The AI surface is real today. Editor-facing and MCP-style handoff for
                tools like Claude Code and Cursor is a real direction, but still not something this
                site should overstate as fully shipped.
              </p>
              <div className="lx-ai__tags">
                {["Grounded AI", "Claude Code direction", "Cursor direction", "MCP-style handoff", "CLI"].map((t) => (
                  <span key={t} className="lx-ai__tag">{t}</span>
                ))}
              </div>
            </div>
            <div className="lx-ai__diagram rv lx-shine" aria-hidden="true">
              <div className="lx-diagram">
                <div className="lx-diagram__center">
                  <div className="lx-diagram__core">
                    <span className="lx-diagram__core-mark">D</span>
                    <p className="lx-diagram__core-lbl">Daylens</p>
                    <p className="lx-diagram__core-meta">local.sqlite</p>
                  </div>
                </div>
                {[
                  { label: "Claude Code", angle: -60 },
                  { label: "Cursor", angle: 0 },
                  { label: "CLI", angle: 60 },
                  { label: "Agent", angle: 120 },
                  { label: "Shell", angle: 180 },
                  { label: "Editor", angle: 240 },
                ].map((n, i) => (
                  <span
                    key={n.label}
                    className="lx-diagram__node"
                    style={{
                      transform: `rotate(${n.angle}deg) translateX(140px) rotate(${-n.angle}deg)`,
                      animationDelay: `${i * 0.12}s`,
                    }}
                  >
                    {n.label}
                  </span>
                ))}
                <svg className="lx-diagram__orbit" viewBox="0 0 320 320" aria-hidden="true">
                  <circle cx="160" cy="160" r="140" />
                  <circle cx="160" cy="160" r="100" />
                </svg>
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="lx-section lx-section--cream" id="faq">
          <div className="lx-shell lx-faq-wrap">
            <div className="lx-faq-wrap__head">
              <span className="lx-editorial__num">§ 05</span>
              <h2 className="lx-display">
                Straight answers.
                <span className="lx-display__italic"> No brochure voice.</span>
              </h2>
            </div>
            <div className="lx-faq">
              {faqItems.map((f, i) => (
                <details key={f.question} className="lx-faq__item rv" style={{ transitionDelay: `${i * 0.06}s` }}>
                  <summary className="lx-faq__q">
                    <span className="lx-faq__q-num">0{i + 1}</span>
                    <span className="lx-faq__q-text">{f.question}</span>
                    <span className="lx-faq__q-icon" aria-hidden="true" />
                  </summary>
                  <p className="lx-faq__a">{f.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── FINAL ── */}
        <section className="lx-final">
          <div className="lx-final__bg" aria-hidden="true" />
          <div className="lx-final__inner">
            <p className="lx-kicker lx-kicker--light">
              <span className="lx-kicker__dot" />
              <span className="lx-kicker__mono">ship.yourself</span>
            </p>
            <h2 className="lx-display lx-display--light lx-final__h2">
              Build your work history once.
              <span className="lx-display__italic"> Use it for the rest of your career.</span>
            </h2>
            <p className="lx-final__sub">
              macOS and Windows have public downloads today. Linux stays visible in the open while
              validation catches up.
            </p>

            <div className="lx-final__ctas">
              <DownloadBtn href={MAC_DOWNLOAD_HREF} label="Download for Mac" platform="mac" variant="solid" source="finale" icon={<AppleIcon />} />
              <DownloadBtn href={WINDOWS_DOWNLOAD_HREF} label="Download for Windows" platform="windows" variant="ghost-dark" source="finale" icon={<WindowsIcon />} />
              <DownloadBtn href={LINUX_STATUS_HREF} label="Linux status" platform="linux" variant="ghost-dark" source="finale" icon={<LinuxIcon />} />
            </div>

            <div className="lx-final__links">
              <Link href="/docs" className="lx-textlink">Read the docs <ArrowIcon /></Link>
              <Link href="/link" className="lx-textlink">Connect the companion <ArrowIcon /></Link>
              <Link href="/roadmap" className="lx-textlink">Roadmap <ArrowIcon /></Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter variant="minimal" />
    </div>
  );
}
