"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MarketingFooter, MarketingInnerNav } from "./MarketingChrome";
import { MarketingCursor } from "./MarketingEffects";

type RoadmapStatus =
  | "Backlog"
  | "Next up"
  | "In progress"
  | "Implemented pending verification";

type RoadmapSurface = "Cross-platform" | "Windows" | "macOS" | "Linux" | "Web companion";

type RoadmapItem = {
  title: string;
  status: RoadmapStatus;
  summary: string;
  whyItMatters: string;
  currentFocus: string[];
  tags: string[];
  surface: RoadmapSurface;
  deliverables: number;
  board: string;
  updated: string;
  owner: string;
};

const ROADMAP_ORDER: RoadmapStatus[] = [
  "Backlog",
  "Next up",
  "In progress",
  "Implemented pending verification",
];

const SURFACE_FILTERS: RoadmapSurface[] = [
  "Cross-platform",
  "Windows",
  "macOS",
  "Linux",
  "Web companion",
];

const ROADMAP_ITEMS: RoadmapItem[] = [
  {
    title: "Tracking and persistence hardening",
    status: "In progress",
    summary:
      "Keep raw capture, activity segments, work sessions, and timeline reconstruction stable enough that relaunches still show real history instead of a fresh slate.",
    whyItMatters:
      "If tracking or persistence breaks, the rest of the product becomes presentation over missing evidence.",
    currentFocus: [
      "Keep the database as the source of truth rather than renderer state.",
      "Protect history reconstruction across restart, sleep, wake, and idle edges.",
      "Tighten the proof surface before polishing secondary UI.",
    ],
    tags: ["Tracking", "Persistence", "Timeline"],
    surface: "Cross-platform",
    deliverables: 3,
    board: "Launch closure",
    updated: "Active launch-closure pass",
    owner: "Christian",
  },
  {
    title: "Timeline cleanup and relabel safety",
    status: "Implemented pending verification",
    summary:
      "Background cleanup now targets unresolved history days, unresolved unpersisted dates, and weak legacy AI labels instead of reopening already-good labels indiscriminately.",
    whyItMatters:
      "The timeline should improve weak history over time without creating label churn or pretending that every old block needs to be rewritten.",
    currentFocus: [
      "Keep cleanup bounded to unresolved dates and legacy weak labels.",
      "Protect user overrides and already-good deterministic labels.",
      "Document the exact cleanup scope honestly.",
    ],
    tags: ["Timeline", "Cleanup", "Labels"],
    surface: "Cross-platform",
    deliverables: 3,
    board: "Launch closure",
    updated: "Implemented pending verification",
    owner: "Christian",
  },
  {
    title: "Grounded AI prompts and provider caching",
    status: "Implemented pending verification",
    summary:
      "Starter prompts, freeform AI queries, and Anthropic prompt-caching request shaping are implemented with deterministic guardrails and clearer truthfulness around what has and has not been provider-validated.",
    whyItMatters:
      "Request-shape tests are useful, but they are not the same thing as live cache-read and cache-write proof. Launch docs need that distinction to stay explicit.",
    currentFocus: [
      "Preserve cache-control request-shape guardrails.",
      "Keep tests focused on payload shape instead of pretending to prove provider behavior.",
      "Validate live provider behavior only when it can be exercised honestly.",
    ],
    tags: ["AI", "Anthropic", "Truthfulness"],
    surface: "Cross-platform",
    deliverables: 3,
    board: "Launch closure",
    updated: "Implemented pending verification",
    owner: "Christian",
  },
  {
    title: "Focus sessions inside AI",
    status: "Implemented pending verification",
    summary:
      "Focus start, stop, and review flows stay inside the AI surface instead of becoming a separate top-level product area.",
    whyItMatters:
      "Daylens works best when timers, grounded review, and work history all live in one evidence-backed flow.",
    currentFocus: [
      "Keep focus actions reachable from AI messages and prompts.",
      "Preserve review context after a session ends.",
      "Validate the full interaction loop in the live app.",
    ],
    tags: ["Focus", "AI", "Product shape"],
    surface: "Cross-platform",
    deliverables: 3,
    board: "Launch closure",
    updated: "Implemented pending verification",
    owner: "Christian",
  },
  {
    title: "Reports and export artifacts from AI",
    status: "Implemented pending verification",
    summary:
      "Report creation and artifact export stay within the AI surface so exports are grounded in tracked evidence instead of split into a separate reporting tab.",
    whyItMatters:
      "The product goal is to answer what happened and produce useful outputs from that evidence, not to grow disconnected report surfaces.",
    currentFocus: [
      "Keep report requests routed through AI orchestration.",
      "Verify exported artifacts land on disk and can be opened.",
      "Document any remaining validation gaps honestly.",
    ],
    tags: ["Reports", "Exports", "AI"],
    surface: "Cross-platform",
    deliverables: 3,
    board: "Launch closure",
    updated: "Implemented pending verification",
    owner: "Christian",
  },
  {
    title: "macOS launch proof pass",
    status: "In progress",
    summary:
      "Use live macOS validation to confirm the desktop app launches, the core navigation is correct, the timeline reconstructs real history, and the main product surfaces behave credibly.",
    whyItMatters:
      "Packaging audits are not enough. The product still needs a real interaction pass on the platform that currently sets the quality bar.",
    currentFocus: [
      "Verify the live desktop build uses Timeline, Apps, AI, and Settings as the top-level navigation.",
      "Confirm persisted prior-day history appears in the Timeline.",
      "Exercise the highest-value flows that can be tested honestly from the current machine.",
    ],
    tags: ["macOS", "Validation", "Launch"],
    surface: "macOS",
    deliverables: 3,
    board: "Launch closure",
    updated: "Active validation pass",
    owner: "Christian",
  },
  {
    title: "Windows packaging and machine validation",
    status: "Next up",
    summary:
      "Audit the Windows build, release workflows, and packaging surfaces now, then finish real-machine runtime validation before calling launch fully closed.",
    whyItMatters:
      "A cross-platform story is only credible if Windows claims stop where real validation stops.",
    currentFocus: [
      "Review installer and release workflow configuration.",
      "Keep docs explicit that runtime validation still needs a Windows machine.",
      "Avoid overclaiming parity from CI alone.",
    ],
    tags: ["Windows", "Packaging", "Validation"],
    surface: "Windows",
    deliverables: 3,
    board: "Platform readiness",
    updated: "Queued behind current launch pass",
    owner: "Christian",
  },
  {
    title: "Linux transition and release truthfulness",
    status: "In progress",
    summary:
      "Keep the Linux transition repo narrow and useful while the unified desktop repo remains the product source of truth.",
    whyItMatters:
      "Linux should still be represented as part of Daylens, but not marketed as a polished fully validated install path if that work is not honestly complete yet.",
    currentFocus: [
      "Keep the MIT-licensed transition repo pointed at the unified source of truth.",
      "Remove stale planning clutter while preserving Linux-specific docs that still help.",
      "Separate packaging audit confidence from real-machine runtime confidence.",
    ],
    tags: ["Linux", "Transition", "Truthfulness"],
    surface: "Linux",
    deliverables: 3,
    board: "Platform readiness",
    updated: "Active launch-closure pass",
    owner: "Christian",
  },
  {
    title: "Linux runtime validation on real machines",
    status: "Next up",
    summary:
      "Audit AppImage, deb, rpm, tarball, and diagnostic surfaces now, then finish X11 and Wayland runtime checks on actual Linux environments.",
    whyItMatters:
      "Linux launch copy should stay grounded in what has really run, not only in what packages build successfully.",
    currentFocus: [
      "Review packaging config, smoke scripts, and release workflows.",
      "Keep fallback diagnostics visible for users who try the transition path early.",
      "Document that real-machine runtime proof is still pending.",
    ],
    tags: ["Linux", "Packaging", "Validation"],
    surface: "Linux",
    deliverables: 3,
    board: "Platform readiness",
    updated: "Queued after audit",
    owner: "Christian",
  },
  {
    title: "Web launch copy and download parity",
    status: "In progress",
    summary:
      "Keep the landing page, docs, roadmap, and download links aligned with the unified Daylens product story instead of a mix of older navigation and overconfident release copy.",
    whyItMatters:
      "Public pages are part of the launch surface. If they overstate Linux, Wrapped, or old navigation, they undercut trust immediately.",
    currentFocus: [
      "Point GitHub and status links at the unified source of truth.",
      "Keep Linux routed through status rather than a polished direct-install story.",
      "Remove outdated product language from docs and roadmap copy.",
    ],
    tags: ["Web", "Copy", "Launch"],
    surface: "Web companion",
    deliverables: 3,
    board: "Public surfaces",
    updated: "Active launch-closure pass",
    owner: "Christian",
  },
  {
    title: "Workspace and sync clarity",
    status: "In progress",
    summary:
      "Keep workspace, sync, browser access, and recovery flows present without making them sound like the primary product or a required setup step.",
    whyItMatters:
      "Daylens is local-first. Optional sync needs to feel additive and clear rather than like a second source of truth.",
    currentFocus: [
      "Keep workspace controls in Settings, not as a separate product layer.",
      "Clarify linking and recovery copy on the website.",
      "Preserve the desktop database as the base truth layer.",
    ],
    tags: ["Sync", "Workspace", "Local-first"],
    surface: "Cross-platform",
    deliverables: 3,
    board: "Public surfaces",
    updated: "Active launch-closure pass",
    owner: "Christian",
  },
  {
    title: "Apps view usefulness",
    status: "Implemented pending verification",
    summary:
      "The Apps surface should explain real work context with artifacts, paired tools, and work-session detail instead of app vanity metrics.",
    whyItMatters:
      "The product is about work sessions, not app rankings. Apps only matter insofar as they help explain the work.",
    currentFocus: [
      "Show linked artifacts and evidence in app detail.",
      "Explain how tools co-occur inside real work sessions.",
      "Keep the Apps view secondary to the Timeline proof surface.",
    ],
    tags: ["Apps", "Evidence", "Launch"],
    surface: "Cross-platform",
    deliverables: 3,
    board: "Launch closure",
    updated: "Implemented pending verification",
    owner: "Christian",
  },
  {
    title: "Editor and MCP handoff direction",
    status: "Backlog",
    summary:
      "Keep moving toward a product that can feed grounded work-history context into editors and agent workflows without losing the local-first base.",
    whyItMatters:
      "One of the long-term promises of Daylens is making your actual work history available to the tools helping you, not forcing you to restate it every time.",
    currentFocus: [
      "Keep launch copy explicit about the editor and MCP direction.",
      "Avoid pretending those integrations are already fully productized.",
      "Preserve evidence-grounded context as the prerequisite for future tooling.",
    ],
    tags: ["MCP", "Editors", "Direction"],
    surface: "Cross-platform",
    deliverables: 2,
    board: "Direction",
    updated: "Backlog",
    owner: "Christian",
  },
  {
    title: "Attribution beyond clients and projects",
    status: "Backlog",
    summary:
      "Improve evidence-backed attribution for repos, classes, research topics, and internal initiatives without pretending every workstream already has structured entity support.",
    whyItMatters:
      "Launch answers should stay honest about where attribution is first-class today and where evidence still does more of the work.",
    currentFocus: [
      "Keep clients and projects as the current first-class entities.",
      "Use work-block and artifact evidence when structured attribution is missing.",
      "Avoid fake certainty in AI answers and labels.",
    ],
    tags: ["Attribution", "Entities", "Evidence"],
    surface: "Cross-platform",
    deliverables: 3,
    board: "Direction",
    updated: "Backlog",
    owner: "Christian",
  },
  {
    title: "Wrapped and year-end storytelling",
    status: "Backlog",
    summary:
      "Keep Wrapped-style storytelling out of the launch path unless a nearly finished implementation is only being wired up or polished safely.",
    whyItMatters:
      "Wrapped fits the product vision, but it should not steal time from tracking, persistence, reconstruction, and grounded AI launch closure.",
    currentFocus: [
      "Keep public copy from overclaiming yearly recap features.",
      "Reuse the idea only when the implementation is already almost there.",
      "Treat it as a later storytelling layer, not a launch blocker.",
    ],
    tags: ["Wrapped", "Storytelling", "Scope"],
    surface: "Cross-platform",
    deliverables: 3,
    board: "Direction",
    updated: "Backlog",
    owner: "Christian",
  },
];

const STATUS_TONES: Record<RoadmapStatus, string> = {
  Backlog: "sand",
  "Next up": "violet",
  "In progress": "blue",
  "Implemented pending verification": "rose",
};

function IconButton({ type }: { type: "search" | "filter" | "share" }) {
  if (type === "search") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path
          d="M8.75 3.5a5.25 5.25 0 1 0 3.302 9.333l3.207 3.208 1.06-1.06-3.208-3.207A5.25 5.25 0 0 0 8.75 3.5Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (type === "filter") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path
          d="M3 5.25a.75.75 0 0 1 .75-.75h12.5a.75.75 0 0 1 .53 1.28l-4.53 4.53v3.44a.75.75 0 0 1-.332.624l-2.5 1.667A.75.75 0 0 1 8.25 15.4v-5.09L3.22 5.78A.75.75 0 0 1 3 5.25Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M12.5 4.25h3.25v3.25h-1.5V6.81l-4.72 4.72-1.06-1.06 4.72-4.72h-.69Zm-8.25 1A1.75 1.75 0 0 1 6 3.5h3.25V5H6a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V10.5h1.5v3.25A1.75 1.75 0 0 1 14.5 15.5H6a1.75 1.75 0 0 1-1.75-1.75v-8.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function RoadmapPageClient() {
  const [selectedItem, setSelectedItem] = useState<RoadmapItem | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "copied">("idle");
  const [searchQuery, setSearchQuery] = useState("");
  const [surfaceFilters, setSurfaceFilters] = useState<RoadmapSurface[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    if (!selectedItem) return undefined;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedItem(null);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedItem]);

  const visibleItems = useMemo(() => {
    return ROADMAP_ITEMS.filter((item) => {
      const matchesSurface =
        surfaceFilters.length === 0 || surfaceFilters.includes(item.surface);
      const search = searchQuery.trim().toLowerCase();
      const haystack = [
        item.title,
        item.summary,
        item.whyItMatters,
        item.surface,
        ...item.tags,
        ...item.currentFocus,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = search.length === 0 || haystack.includes(search);
      return matchesSurface && matchesSearch;
    });
  }, [searchQuery, surfaceFilters]);

  function toggleSurface(surface: RoadmapSurface) {
    setSurfaceFilters((current) =>
      current.includes(surface)
        ? current.filter((value) => value !== surface)
        : [...current, surface]
    );
  }

  async function handleShare() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareState("copied");
      window.setTimeout(() => setShareState("idle"), 1600);
    } catch {
      setShareState("idle");
    }
  }

  return (
    <div className="lp lp-ray-board-page">
      <MarketingCursor />
      <MarketingInnerNav current="roadmap" theme="light" variant="capsule" />

      <main className="lp-ray-board-main">
        <section className="lp-container lp-ray-board-shell" aria-labelledby="roadmap-title">
          <div className="lp-ray-board-header">
            <div className="lp-ray-board-copy">
              <h1 id="roadmap-title" className="lp-ray-board-title">
                Roadmap
              </h1>
              <p className="lp-ray-board-intro">
                This is the clearest view of what Daylens is building now, what
                still needs validation, and what remains queued across the
                unified desktop product and companion web surfaces.
              </p>
              <p className="lp-ray-board-note">
                Please note that these priorities are not guaranteed and will
                keep moving as the product learns from real use.
              </p>
            </div>

            <div className="lp-ray-board-actions">
              <button
                type="button"
                className={`lp-ray-board-action${searchOpen ? " is-active" : ""}`}
                aria-label="Search roadmap"
                onClick={() => {
                  setSearchOpen((current) => !current);
                  if (filterOpen) setFilterOpen(false);
                }}
              >
                <IconButton type="search" />
              </button>
              <button
                type="button"
                className={`lp-ray-board-action${filterOpen ? " is-active" : ""}`}
                aria-label="Filter roadmap"
                onClick={() => {
                  setFilterOpen((current) => !current);
                  if (searchOpen) setSearchOpen(false);
                }}
              >
                <IconButton type="filter" />
              </button>
              <button
                type="button"
                className={`lp-ray-board-action${
                  shareState === "copied" ? " is-active" : ""
                }`}
                aria-label="Copy roadmap link"
                onClick={handleShare}
              >
                <IconButton type="share" />
              </button>
            </div>
          </div>

          {(searchOpen || filterOpen) && (
            <div className="lp-ray-board-toolbar">
              {searchOpen ? (
                <label className="lp-ray-board-search">
                  <span className="sr-only">Search roadmap</span>
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search initiatives, tags, and focus areas"
                  />
                </label>
              ) : null}

              {filterOpen ? (
                <div className="lp-ray-board-filters">
                  {SURFACE_FILTERS.map((surface) => (
                    <button
                      key={surface}
                      type="button"
                      className={`lp-ray-board-filter-chip${
                        surfaceFilters.includes(surface) ? " is-active" : ""
                      }`}
                      onClick={() => toggleSurface(surface)}
                    >
                      {surface}
                    </button>
                  ))}
                  {surfaceFilters.length > 0 ? (
                    <button
                      type="button"
                      className="lp-ray-board-filter-reset"
                      onClick={() => setSurfaceFilters([])}
                    >
                      Clear filters
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          <div className="lp-ray-board-scroll">
            <div className="lp-ray-board-columns">
              {ROADMAP_ORDER.map((status) => {
                const items = visibleItems.filter((item) => item.status === status);

                return (
                  <section key={status} className="lp-ray-board-column">
                    <header className="lp-ray-column-head">
                      <span className={`lp-ray-column-pill is-${STATUS_TONES[status]}`}>
                        {status}
                      </span>
                      <span className="lp-ray-column-count">{items.length}</span>
                    </header>

                    <div className="lp-ray-card-stack">
                      {items.map((item) => (
                        <button
                          key={`${item.status}-${item.title}`}
                          type="button"
                          className="lp-ray-roadmap-card"
                          onClick={() => setSelectedItem(item)}
                        >
                          <h2 className="lp-ray-roadmap-card-title">{item.title}</h2>
                          <p className="lp-ray-roadmap-card-summary">{item.summary}</p>

                          <div className="lp-ray-roadmap-card-tags">
                            {item.tags.map((tag) => (
                              <span key={`${item.title}-${tag}`} className="lp-ray-roadmap-tag">
                                {tag}
                              </span>
                            ))}
                          </div>

                          <div className="lp-ray-roadmap-card-footer">
                            <span className="lp-ray-roadmap-surface">{item.surface}</span>
                            <span className="lp-ray-roadmap-card-count">{item.deliverables}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      {selectedItem ? (
        <div
          className="lp-ray-roadmap-overlay"
          role="presentation"
          onClick={() => setSelectedItem(null)}
        >
          <div
            className="lp-ray-roadmap-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="roadmap-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="lp-ray-roadmap-close"
              aria-label="Close roadmap detail"
              onClick={() => setSelectedItem(null)}
            >
              ×
            </button>

            <div className="lp-ray-roadmap-modal-main">
              <div className="lp-ray-roadmap-modal-copy">
                <h2 id="roadmap-modal-title" className="lp-ray-roadmap-modal-title">
                  {selectedItem.title}
                </h2>
                <p className="lp-ray-roadmap-modal-summary">{selectedItem.summary}</p>

                <div className="lp-ray-roadmap-modal-tags">
                  {selectedItem.tags.map((tag) => (
                    <span
                      key={`${selectedItem.title}-${tag}-detail`}
                      className="lp-ray-roadmap-modal-tag"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <section className="lp-ray-roadmap-modal-section">
                  <h3 className="lp-ray-roadmap-modal-label">Why this matters</h3>
                  <p className="lp-ray-roadmap-modal-paragraph">
                    {selectedItem.whyItMatters}
                  </p>
                </section>

                <section className="lp-ray-roadmap-modal-section">
                  <h3 className="lp-ray-roadmap-modal-label">Current focus</h3>
                  <ul className="lp-ray-roadmap-modal-list">
                    {selectedItem.currentFocus.map((item) => (
                      <li key={`${selectedItem.title}-${item}`}>{item}</li>
                    ))}
                  </ul>
                </section>
              </div>

              <aside className="lp-ray-roadmap-modal-side">
                <div className="lp-ray-roadmap-side-row">
                  <span>Deliverables</span>
                  <strong>{selectedItem.deliverables}</strong>
                </div>
                <div className="lp-ray-roadmap-side-row">
                  <span>Status</span>
                  <strong>{selectedItem.status}</strong>
                </div>
                <div className="lp-ray-roadmap-side-row">
                  <span>Board</span>
                  <strong>{selectedItem.board}</strong>
                </div>
                <div className="lp-ray-roadmap-side-row">
                  <span>Surface</span>
                  <strong>{selectedItem.surface}</strong>
                </div>
                <div className="lp-ray-roadmap-side-row">
                  <span>Updated</span>
                  <strong>{selectedItem.updated}</strong>
                </div>
                <div className="lp-ray-roadmap-side-row">
                  <span>Owner</span>
                  <strong>{selectedItem.owner}</strong>
                </div>
              </aside>
            </div>
          </div>
        </div>
      ) : null}

      <MarketingFooter />
    </div>
  );
}
