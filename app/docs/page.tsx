import Link from "next/link";
import { MarketingFooter, MarketingInnerNav } from "../components/MarketingChrome";
import { MarketingCursor } from "../components/MarketingEffects";
import { LINUX_STATUS_HREF } from "../lib/platformLinks";

export const metadata = {
  title: "Docs — Daylens",
  description:
    "Everything you need to know about Daylens: getting started, features, the web companion, privacy, and FAQ.",
};

const TOC = [
  { href: "#getting-started", label: "Getting Started" },
  { href: "#timeline", label: "The Timeline" },
  { href: "#session-detail", label: "Session Detail" },
  { href: "#stats", label: "Stats and Focus Score" },
  { href: "#ai-analysis", label: "AI Analysis" },
  { href: "#insights", label: "Insights Chat" },
  { href: "#web-companion", label: "Web Companion" },
  { href: "#privacy", label: "Privacy and Data" },
  { href: "#faq", label: "FAQ" },
];

export default function DocsPage() {
  return (
    <div className="lp">
      <MarketingCursor />
      <MarketingInnerNav current="docs" theme="light" variant="capsule" />

      {/* ── Hero ── */}
      <section className="lp-docs-hero">
        <div className="lp-container" style={{ position: "relative", zIndex: 1 }}>
          <div className="lp-accent-rule" style={{ marginBottom: "1.5rem" }} />
          <p className="text-label" style={{ color: "var(--lp-accent)", marginBottom: "1rem" }}>Documentation</p>
          <h1 className="text-display-lg" style={{ color: "var(--lp-bone)", margin: "0 0 1rem", maxWidth: "18ch" }}>
            Everything about Daylens.
          </h1>
          <p style={{ fontSize: "1rem", fontWeight: 400, lineHeight: 1.65, color: "rgba(10,22,40,0.5)", margin: 0, maxWidth: "44ch" }}>
            From first install to asking questions about your week — all in one place.
          </p>
        </div>
      </section>

      {/* ── Content ── */}
      <section className="lp-section lp-section--light">
        <div className="lp-container">
          <div className="lp-docs-layout">

            {/* Sidebar TOC */}
            <aside className="lp-docs-sidebar">
              <span className="text-label lp-docs-toc-heading">On this page</span>
              {TOC.map(({ href, label }) => (
                <a key={href} href={href} className="lp-docs-toc-link">{label}</a>
              ))}
            </aside>

            {/* Article */}
            <article className="lp-docs-content">

              {/* Getting Started */}
              <section id="getting-started" style={{ scrollMarginTop: 80 }} className="lp-docs-section">
                <h2 className="text-headline lp-docs-section-title">Getting Started</h2>
                <p className="lp-docs-body">
                  Daylens starts working without setup because the point is to see what your day actually looked like, not to spend the first hour configuring categories. Download it, open it, and let it watch. By the end of the day you will have a timeline of named work blocks, session detail, and a clearer picture of where your attention went.
                </p>
                <div className="lp-docs-steps">
                  <div className="lp-docs-step">
                    <span className="text-label lp-docs-step-num">01</span>
                    <div>
                      <p className="lp-docs-step-title">Download Daylens</p>
                      <p className="lp-docs-step-body">
                        Get the macOS or Windows app from{" "}
                        <a href="https://christian-tonny.dev/daylens" className="lp-docs-link">christian-tonny.dev/daylens</a>.
                        Linux remains part of the unified product direction, and the current rollout
                        status lives on the{" "}
                        <a href={LINUX_STATUS_HREF} className="lp-docs-link">Linux status page</a>.
                      </p>
                    </div>
                  </div>
                  <div className="lp-docs-step">
                    <span className="text-label lp-docs-step-num">02</span>
                    <div>
                      <p className="lp-docs-step-title">Open and let it run</p>
                      <p className="lp-docs-step-body">
                        Daylens runs in the background from the menu bar. No extensions, no screenshot prompts, no categories to train. It starts building the evidence of your day immediately.
                      </p>
                    </div>
                  </div>
                  <div className="lp-docs-step">
                    <span className="text-label lp-docs-step-num">03</span>
                    <div>
                      <p className="lp-docs-step-title">Check your timeline</p>
                      <p className="lp-docs-step-body">
                        Open Daylens later in the day and you will already see named blocks like real work, not just app totals. Each block is grouped automatically and analyzed as it completes.
                      </p>
                    </div>
                  </div>
                  <div className="lp-docs-step">
                    <span className="text-label lp-docs-step-num">04</span>
                    <div>
                      <p className="lp-docs-step-title">Connect the web companion (optional)</p>
                      <p className="lp-docs-step-body">
                        To view your data from your phone or any browser, go to Settings, tap <strong style={{ fontWeight: 500, color: "var(--lp-ink)" }}>Connect to Web</strong>, and scan the QR code. No account or email needed.
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              {/* Timeline */}
              <section id="timeline" style={{ scrollMarginTop: 80 }} className="lp-docs-section">
                <h2 className="text-headline lp-docs-section-title">The Timeline</h2>
                <p className="lp-docs-body">
                  The timeline is the answer to a more useful question than Screen Time asks. Not which apps were open, but what you were actually doing. Daylens watches your apps and browser activity natively, detects when the work shifts, and turns the day into labeled blocks that read like real sessions.
                </p>
                <p className="lp-docs-body">
                  A block like "Tax Filing and Email" or "Mixed Development and Research Work" is not something you typed in. It came from analyzing the evidence of the session itself, so the timeline feels closer to memory than to a raw activity log.
                </p>
                <div className="lp-docs-infobox">
                  <span className="lp-docs-infobox-label">Note:</span>
                  You can jump to any past day from the date picker and ask the same question again: what was I doing at 2pm last Tuesday? The full history stays stored locally on your device.
                </div>
              </section>

              {/* Session Detail */}
              <section id="session-detail" style={{ scrollMarginTop: 80 }} className="lp-docs-section">
                <h2 className="text-headline lp-docs-section-title">Session Detail</h2>
                <p className="lp-docs-body">
                  Click any block and the rough picture turns precise. This is where Daylens moves past "you spent time in this app" and shows what was really inside the session.
                </p>
                <ul className="lp-docs-bullets">
                  {[
                    "The sites and pages that were open, with time spent on each",
                    "Primary and supporting apps inside the session",
                    "Context switches detected while the work was unfolding",
                    "The AI-generated explanation of what the block was actually about",
                  ].map((item) => (
                    <li key={item}>
                      <span className="lp-docs-bullet-dot" />
                      {item}
                    </li>
                  ))}
                </ul>
                <p className="lp-docs-body">
                  Context switches are counted every time the active tab or window changes. A high switch count usually means the work was fragmented, research-heavy, or both. That gap between effort and output is often sitting right there in the switch count.
                </p>
              </section>

              {/* Stats */}
              <section id="stats" style={{ scrollMarginTop: 80 }} className="lp-docs-section">
                <h2 className="text-headline lp-docs-section-title">Stats and Focus Score</h2>
                <p className="lp-docs-body">
                  The stats view compresses the day into the numbers that matter most: total active time, category allocation, switching behavior, and whether the day felt calmer or more fragmented than usual.
                </p>
                <p className="lp-docs-body">
                  The <strong style={{ fontWeight: 500, color: "var(--lp-ink)" }}>focus score</strong> is based on your own switching behavior relative to your own history. It is not judging you against some external benchmark. It is measuring whether this day was more scattered or more settled than your normal.
                </p>
                <p className="lp-docs-body">
                  The <strong style={{ fontWeight: 500, color: "var(--lp-ink)" }}>intelligence insight</strong> reads the actual shape of the day and surfaces one thing worth noticing. It is not a generic productivity tip generator. It is grounded in what Daylens saw happen.
                </p>
              </section>

              {/* AI Analysis */}
              <section id="ai-analysis" style={{ scrollMarginTop: 80 }} className="lp-docs-section">
                <h2 className="text-headline lp-docs-section-title">AI Analysis</h2>
                <p className="lp-docs-body">
                  The AI layer is not a separate mode you have to turn on. It runs on every completed block automatically, building the understanding that makes the timeline useful in the first place.
                </p>
                <p className="lp-docs-body">
                  It distinguishes primary tools from supporting ones, spots when you were researching versus actively building, and names the session from the evidence instead of from a template. The goal is to make the product already understand the shape of your day before you ask anything.
                </p>
                <div className="lp-docs-infobox">
                  <span className="lp-docs-infobox-label">Note:</span>
                  The AI analysis requires an internet connection to run. The data sent is your session metadata (app names, site titles, durations) — not screenshots, keystrokes, or file contents.
                </div>
              </section>

              {/* Insights Chat */}
              <section id="insights" style={{ scrollMarginTop: 80 }} className="lp-docs-section">
                <h2 className="text-headline lp-docs-section-title">Insights Chat</h2>
                <p className="lp-docs-body">
                  The Insights tab is where the tracked history becomes queryable. Ask questions in plain language across any day, week, or custom range without having to reconstruct your context from scratch.
                </p>
                <div className="lp-docs-examples">
                  {[
                    "What was I doing Thursday afternoon?",
                    "Where did my focus go this week?",
                    "Which days did I have the most context switches?",
                    "How much time did I spend in the browser vs. my editor this week?",
                  ].map((q) => (
                    <div key={q} className="lp-docs-example">
                      <span className="lp-docs-example-q">Q</span>
                      {q}
                    </div>
                  ))}
                </div>
                <p className="lp-docs-body">
                  Answers are grounded in your actual activity data, and follow-up questions keep the thread alive. That is the broader direction of Daylens: help that starts with the picture already in view instead of making you relay it manually every time.
                </p>
              </section>

              {/* Web Companion */}
              <section id="web-companion" style={{ scrollMarginTop: 80 }} className="lp-docs-section">
                <h2 className="text-headline lp-docs-section-title">Web Companion</h2>
                <p className="lp-docs-body">
                  The web companion lets you view your Daylens data from any device — your phone, a tablet, another computer.
                </p>
                <div className="lp-docs-steps">
                  <div className="lp-docs-step">
                    <span className="text-label lp-docs-step-num">01</span>
                    <div>
                      <p className="lp-docs-step-title">Open Settings in the desktop app</p>
                      <p className="lp-docs-step-body">
                        Go to the Settings tab and tap <strong style={{ fontWeight: 500, color: "var(--lp-ink)" }}>Connect to Web</strong>. A QR code and link token will appear.
                      </p>
                    </div>
                  </div>
                  <div className="lp-docs-step">
                    <span className="text-label lp-docs-step-num">02</span>
                    <div>
                      <p className="lp-docs-step-title">Scan or paste the token</p>
                      <p className="lp-docs-step-body">
                        On your phone or browser, go to{" "}
                        <a href="https://christian-tonny.dev/daylens/link" className="lp-docs-link">christian-tonny.dev/daylens/link</a>.
                        Scan the QR code or paste the token manually.
                      </p>
                    </div>
                  </div>
                  <div className="lp-docs-step">
                    <span className="text-label lp-docs-step-num">03</span>
                    <div>
                      <p className="lp-docs-step-title">You&apos;re connected</p>
                      <p className="lp-docs-step-body">
                        Your dashboard, history, and AI chat are now accessible from that device. The desktop app syncs data in the background.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="lp-docs-infobox">
                  <span className="lp-docs-infobox-label">Note:</span>
                  Your recovery phrase is shown once during setup. Save it somewhere safe — it is the only way to restore access to your web companion account if you disconnect.
                </div>
              </section>

              {/* Privacy */}
              <section id="privacy" style={{ scrollMarginTop: 80 }} className="lp-docs-section">
                <h2 className="text-headline lp-docs-section-title">Privacy and Data</h2>
                <p className="lp-docs-body">
                  Daylens is built around a simple rule: the default is local. The product is meant to explain your work, not quietly export your life.
                </p>
                <div className="lp-docs-privacy-list">
                  {[
                    ["No screenshots", "Daylens reads window titles and browser tab titles. It never captures what is on screen."],
                    ["No keylogging", "Daylens does not record what you type."],
                    ["No cloud storage by default", "All data is stored locally. The web companion sync only activates when you explicitly connect it."],
                    ["No account required", "The web companion uses a QR code pairing. No email, no password, no profile."],
                    ["Open source", "The entire codebase is public. You can read exactly what Daylens does."],
                  ].map(([title, body]) => (
                    <div key={title as string} className="lp-docs-privacy-item">
                      <span className="lp-docs-check">✓</span>
                      <div>
                        <p className="lp-docs-privacy-title">{title}.</p>
                        <p className="lp-docs-privacy-body">{body}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="lp-docs-body" style={{ marginTop: "1rem" }}>
                  AI analysis and the Insights chat send session metadata to process queries. This data is your activity summary (app names, site titles, durations) — not the content of pages or files.
                </p>
              </section>

              {/* FAQ */}
              <section id="faq" style={{ scrollMarginTop: 80 }} className="lp-docs-section">
                <h2 className="text-headline lp-docs-section-title">FAQ</h2>
                <div className="lp-docs-faq">
                  {[
                    {
                      q: "Does Daylens work on Windows?",
                      a: "Yes. Daylens is available for both macOS and Windows. Both platforms support all features including AI analysis and the web companion.",
                    },
                    {
                      q: "Does it work on Linux?",
                      a: "Linux is part of the unified Daylens direction, but the public installer path is still transitioning into the unified desktop repo and still needs real-machine validation.",
                    },
                    {
                      q: "What browser activity does Daylens track?",
                      a: "Daylens reads the active tab title from your browser natively — no extension required. It captures the page title and domain, not the full URL or page content.",
                    },
                    {
                      q: "How is the focus score calculated?",
                      a: "The focus score is based on your context switch rate relative to your own historical average. A lower switch rate than your average produces a higher score. It is personal, not a fixed benchmark.",
                    },
                    {
                      q: "Can I delete my data?",
                      a: "Yes. Your data is stored locally and you can clear it at any time from Settings. Disconnecting the web companion removes the synced copy from the server.",
                    },
                    {
                      q: "Is Daylens free?",
                      a: "Yes. Daylens is free and open source. There is no subscription, no premium tier, and no trial period.",
                    },
                    {
                      q: "Where is the source code?",
                      a: "GitHub: github.com/irachrist1/daylens",
                    },
                  ].map(({ q, a }) => (
                    <details key={q} className="lp-docs-faq-item">
                      <summary>
                        <span className="lp-docs-faq-q">{q}</span>
                        <svg className="lp-docs-faq-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </summary>
                      <p className="lp-docs-faq-a">{a}</p>
                    </details>
                  ))}
                </div>
              </section>

              {/* Footer CTA */}
              <div className="lp-docs-cta">
                <p className="lp-docs-body" style={{ marginBottom: "1.25rem" }}>Something not covered here?</p>
                <a
                  href="https://github.com/irachrist1/daylens/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lp-btn-ghost-dark"
                >
                  Open an issue on GitHub →
                </a>
              </div>

            </article>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
