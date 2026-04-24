"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MarketingFooter, MarketingInnerNav } from "./MarketingChrome";
import { MarketingCursor } from "./MarketingEffects";

type RoadmapStatus =
  | "Shipped"
  | "Implemented pending verification"
  | "Active work"
  | "Future ideas";

type RoadmapSurface = "Cross-platform" | "macOS" | "Windows" | "Linux" | "Website";

type RoadmapItem = {
  title: string;
  status: RoadmapStatus;
  surface: RoadmapSurface;
  updated: string;
  summary: string;
  tags: string[];
  truthNow: string[];
  nextProof: string[];
};

const ROADMAP_ORDER: RoadmapStatus[] = [
  "Shipped",
  "Implemented pending verification",
  "Active work",
  "Future ideas",
];

const SURFACE_FILTERS: RoadmapSurface[] = [
  "Cross-platform",
  "macOS",
  "Windows",
  "Linux",
  "Website",
];

const ROADMAP_ITEMS: RoadmapItem[] = [
  {
    title: "Full-text search across your entire history",
    status: "Shipped",
    surface: "Cross-platform",
    updated: "2026-04-24",
    summary:
      "Type any word into the AI view's search box and instantly see every app session, work block, browser page, and AI artifact where it appeared — with highlighted excerpts and timestamps. No AI, no cloud, pure local SQLite FTS5.",
    tags: ["Search", "Recall", "FTS5"],
    truthNow: [
      "FTS5 virtual tables index app_sessions, timeline_blocks, website_visits, and ai_artifacts on first launch.",
      "Insert, update, and delete triggers keep the index in sync with no manual maintenance.",
      "Results are ranked by recency and include highlighted excerpt snippets with the matched term marked.",
      "The search input lives at the top of the AI view with a 150ms debounce; clicking a result navigates to the relevant day or opens the artifact.",
    ],
    nextProof: [
      "Index size and query speed on very large histories (3+ years) have not been stress-tested in production.",
      "Block and artifact result counts are low for new users until more history accumulates.",
    ],
  },
  {
    title: "Onboarding name capture and goals wiring",
    status: "Shipped",
    surface: "Cross-platform",
    updated: "2026-04-24",
    summary:
      "Set your name once in onboarding or Settings and the AI uses it every time. Picking 'less distractions' or 'deep work' during onboarding now shapes what context the AI includes in every chat response.",
    tags: ["Onboarding", "Personalization", "AI context"],
    truthNow: [
      "Display name persists in Settings and appears in the AI persona line.",
      "The 'less-distraction' goal prepends a live distraction summary (minutes + top domains today) to every AI response.",
      "The 'deep-work' goal prepends deep-work percentage, session count, and longest streak to every AI response.",
      "The 'understand-habits' and 'ai-insights' goals are collected but do not yet change AI behavior — noted honestly in the app.",
    ],
    nextProof: [
      "The two wired goals improve grounding but the AI still uses pre-aggregated stats, not live query results.",
      "Goal behavior is only visible after enough tracking data exists for the day.",
    ],
  },
  {
    title: "Honest focus score",
    status: "Shipped",
    surface: "Cross-platform",
    updated: "2026-04-24",
    summary:
      "The old four-term weighted formula returned ~20 even on idle days. The new score is a single honest percentage: time spent in continuous 25-minute deep-work sessions divided by total active time. Returns 'Not enough data' when the day is too short to measure.",
    tags: ["Focus score", "Deep work", "Honesty"],
    truthNow: [
      "deepWorkPct replaces the old coherence/switchPenalty/artifactProgress/deepWorkDensity formula.",
      "A deep-work session is any 25+ minute continuous stretch within a focused app category without a category switch.",
      "Supporting numbers (longest streak, switch count, session count) are shown below the main percentage.",
      "Returns null — displayed as 'Not enough data' — when total active time is under 30 minutes.",
    ],
    nextProof: [
      "Category classification quality on the new schema still needs broader real-user validation.",
      "The 25-minute threshold is a reasonable default but may need tuning based on user feedback.",
    ],
  },
  {
    title: "AI tool-use recall layer",
    status: "Active work",
    surface: "Cross-platform",
    updated: "2026-04-24",
    summary:
      "The next step for Recall is letting the AI call structured tools against your local SQLite instead of relying on pre-aggregated context. A kill-gate spike is underway to confirm frontier models can reliably choose the right tool and parameters before any integration code is written.",
    tags: ["AI", "Tool use", "Recall", "SQLite"],
    truthNow: [
      "The FTS5 search layer (Task A) provides the raw query infrastructure the tools will call.",
      "Tool schemas (searchSessions, getDaySummary, getAppUsage, searchArtifacts, getWeekSummary) are being designed.",
      "A spike tests whether current models score ≥12/15 on representative recall questions before integration begins.",
    ],
    nextProof: [
      "The kill gate must pass before any production integration code is written.",
      "If tool-use scores <12/15, the fallback is expanded static context rather than forcing tool calls.",
    ],
  },
  {
    title: "Unified cross-platform desktop source of truth",
    status: "Shipped",
    surface: "Cross-platform",
    updated: "2026-04-19",
    summary:
      "Daylens now moves as one desktop product across macOS, Windows, and Linux, with the unified Electron repo acting as the canonical source of truth.",
    tags: ["Source of truth", "Cross-platform", "Product shape"],
    truthNow: [
      "The desktop source of truth lives in the unified repo, even though the repository name is still historical.",
      "Shared navigation, timeline, apps, AI, and settings decisions now belong to one product contract.",
      "Public status should point back to the canonical desktop docs instead of fragmenting across older repos.",
    ],
    nextProof: [
      "Keep public copy and issue tracking aligned as validation status changes.",
      "Do not describe shared work as done if it only feels finished on one platform.",
    ],
  },
  {
    title: "Deterministic local-first timeline foundation",
    status: "Shipped",
    surface: "Cross-platform",
    updated: "2026-04-19",
    summary:
      "Tracking, persistence, timeline reconstruction, and AI-over-evidence remain the core product contract rather than optional polish.",
    tags: ["Timeline", "Persistence", "Local-first"],
    truthNow: [
      "The database is the source of truth and the timeline is the proof surface.",
      "Apps, tabs, files, meetings, and windows are treated as evidence for work sessions rather than vanity metrics.",
      "AI is layered on top of tracked local data instead of becoming the primary runtime of the product.",
    ],
    nextProof: [
      "Keep public pages from collapsing back into app-tracker or dashboard language.",
      "Protect reconstruction quality as more validation passes come in.",
    ],
  },
  {
    title: "Truthful public status model",
    status: "Shipped",
    surface: "Website",
    updated: "2026-04-19",
    summary:
      "The website now has a cleaner status model: shipped work, implemented work that still needs proof, active validation, and future ideas are treated as different things.",
    tags: ["Website", "Docs", "Truthfulness"],
    truthNow: [
      "Roadmap direction is no longer meant to read like current product reality.",
      "Linux, recap, and provider-backed AI work can be described without pretending they are fully proven.",
      "The public changelog can act like a release journal instead of synthetic commit filler.",
    ],
    nextProof: [
      "Keep the public pages updated as validation closes or uncovers gaps.",
      "Avoid slipping back into launch-sounding certainty when only code exists.",
    ],
  },
  {
    title: "macOS install, onboarding, and menu-bar polish",
    status: "Implemented pending verification",
    surface: "macOS",
    updated: "2026-04-19",
    summary:
      "The shell work is in place: DMG polish, onboarding refinement, tray behavior, and launch-at-login affordances have all been implemented.",
    tags: ["macOS", "Onboarding", "Menu bar"],
    truthNow: [
      "The DMG background, onboarding flow, and menu-bar refinements are in the codebase.",
      "Legacy userData preservation and shell hardening work has been wired into the desktop app.",
      "This is the most polished install path Daylens has today.",
    ],
    nextProof: [
      "A real human still needs to judge the DMG, tray feel, and first-run flow in the packaged app.",
      "Updater behavior needs proof against a real signed and notarized release.",
    ],
  },
  {
    title: "Deterministic daily, weekly, and monthly recap in AI",
    status: "Implemented pending verification",
    surface: "Cross-platform",
    updated: "2026-04-19",
    summary:
      "A recap surface now exists in the AI view, backed by deterministic aggregation instead of provider-only generation.",
    tags: ["AI", "Recap", "Deterministic"],
    truthNow: [
      "The AI surface opens with daily, weekly, and monthly recap cards built from tracked evidence.",
      "The recap implementation is deterministic first, with targeted tests around the aggregation logic.",
      "This work exists today and should no longer be described as pure roadmap.",
    ],
    nextProof: [
      "It is not yet fully shipped and proven as a polished user experience.",
      "Real user validation still matters before the site should talk about recap as settled product truth.",
    ],
  },
  {
    title: "Persistent AI threads, artifacts, and report/export flow",
    status: "Implemented pending verification",
    surface: "Cross-platform",
    updated: "2026-04-19",
    summary:
      "The AI surface now carries durable threads and artifacts rather than acting like a disposable prompt box.",
    tags: ["AI", "Artifacts", "Reports"],
    truthNow: [
      "AI threads and generated artifacts persist in local storage and on disk.",
      "Reports and exports live inside the AI surface instead of becoming a separate top-level reporting product.",
      "Focus-session review, artifacts, and grounded chat now share one surface.",
    ],
    nextProof: [
      "Provider-backed generation, export handoff, and file-opening flows still need broader real-world validation.",
      "The website should keep describing this as implemented pending verification, not fully proven.",
    ],
  },
  {
    title: "Provider-backed AI orchestration and packaging parity",
    status: "Implemented pending verification",
    surface: "Cross-platform",
    updated: "2026-04-19",
    summary:
      "Streaming, prompt-caching request shaping, model selectors, and packaged AI paths exist, but live provider proof is still limited.",
    tags: ["AI", "Providers", "Streaming"],
    truthNow: [
      "Provider orchestration happens through the backend layer rather than ad hoc renderer calls.",
      "Anthropic and OpenAI model controls, request-shape guardrails, and streaming paths are implemented.",
      "The product is stricter now about deterministic evidence first and AI second.",
    ],
    nextProof: [
      "Packaged provider-backed flows still need honest end-to-end validation with real credentials.",
      "Prompt-caching behavior should not be marketed as proven until live cache reads and writes are observed.",
    ],
  },
  {
    title: "Linux packaging, diagnostics, and focused-window parity",
    status: "Implemented pending verification",
    surface: "Linux",
    updated: "2026-04-19",
    summary:
      "Linux is represented by real product work now, including fallbacks, diagnostics, and packaging targets in the unified repo.",
    tags: ["Linux", "Packaging", "Diagnostics"],
    truthNow: [
      "Linux remains part of the product, not an abandoned branch of the story.",
      "Focused-window fallback work and platform diagnostics are wired into the shared app.",
      "Packaging surfaces exist for Linux and are part of the unified release scaffolding.",
    ],
    nextProof: [
      "Real-machine validation on X11 and Wayland is still incomplete.",
      "Public copy should continue routing Linux users through status rather than a finished install claim.",
    ],
  },
  {
    title: "Real macOS validation pass",
    status: "Active work",
    surface: "macOS",
    updated: "2026-04-19",
    summary:
      "The next honest step is not more copy or code polish. It is proving the packaged macOS experience end to end with a human in the loop.",
    tags: ["macOS", "Validation", "Packaging"],
    truthNow: [
      "The packaged macOS path is materially stronger than it was before the latest launch-gate pass.",
      "The app still needs someone to exercise install, permission handoff, relaunch, tray behavior, and recap feel honestly.",
    ],
    nextProof: [
      "Drive the first-run flow from a fresh packaged app.",
      "Confirm the menu-bar and close-to-tray behavior feel correct in normal use.",
    ],
  },
  {
    title: "Windows real-machine runtime proof",
    status: "Active work",
    surface: "Windows",
    updated: "2026-04-19",
    summary:
      "Windows claims now stop at the right line: the shared work is there, but the latest runtime behavior still needs confirmation on a real Windows machine.",
    tags: ["Windows", "Validation", "Runtime"],
    truthNow: [
      "Packaging and release workflow surfaces can be reviewed from the unified repo.",
      "The current shared product work should carry over to Windows once validated there.",
    ],
    nextProof: [
      "Run the latest build on Windows hardware.",
      "Verify install, persistence, AI flows, and shell behavior in the native environment.",
    ],
  },
  {
    title: "Linux real-machine runtime proof",
    status: "Active work",
    surface: "Linux",
    updated: "2026-04-19",
    summary:
      "Linux remains public and intentional, but the product still needs honest runtime validation on real Linux sessions before stronger claims are warranted.",
    tags: ["Linux", "Validation", "X11", "Wayland"],
    truthNow: [
      "The shared codebase now contains Linux-specific work worth validating.",
      "CI packaging success is useful, but it is not the same thing as runtime proof.",
    ],
    nextProof: [
      "Validate real installs and runtime behavior on X11 and Wayland.",
      "Confirm diagnostics, fallbacks, and provider-backed flows in actual Linux environments.",
    ],
  },
  {
    title: "Packaged AI flow proof with real providers",
    status: "Active work",
    surface: "Cross-platform",
    updated: "2026-04-19",
    summary:
      "The hardest truthfulness gap left is not implementation but proof: packaged, provider-backed AI needs honest end-to-end validation.",
    tags: ["AI", "Validation", "Providers"],
    truthNow: [
      "The app has real provider-backed flows and orchestration surfaces.",
      "The launch docs already acknowledge that these are not fully proven from the current environment.",
    ],
    nextProof: [
      "Run starter prompts, freeform chat, streaming, recap follow-ups, and report generation with live credentials.",
      "Confirm the behavior from packaged builds rather than only dev paths.",
    ],
  },
  {
    title: "MCP server for coding tools and agents",
    status: "Future ideas",
    surface: "Cross-platform",
    updated: "2026-04-24",
    summary:
      "An opt-in local MCP server would let Claude Code, Cursor, and similar tools query your Daylens history directly via tool calls. Gated on genuine community interest — if fewer than 5 developers ask follow-up questions after a public probe, the slot goes to accessibility-API metadata enrichment instead.",
    tags: ["MCP", "Editors", "Agents", "stdio"],
    truthNow: [
      "The FTS5 search layer and AI tool schemas (Task A and Task C) provide the underlying query surface the MCP server would expose.",
      "The product contract for a read-only stdio MCP server is drafted and ready to implement once the gate passes.",
      "No network surface, no auth — stdio between local processes only.",
    ],
    nextProof: [
      "Community probe must produce ≥5 developers with genuine follow-up questions, not polite emoji.",
      "AI tool-use recall (Task C/D) must ship first so the MCP server reuses proven schemas rather than inventing its own.",
    ],
  },
  {
    title: "Attribution beyond clients and projects",
    status: "Future ideas",
    surface: "Cross-platform",
    updated: "Direction only",
    summary:
      "Daylens still wants better first-class attribution for repos, research topics, classes, and internal workstreams, but that should not be confused with what is already structured today.",
    tags: ["Attribution", "Entities", "Evidence"],
    truthNow: [
      "Clients and projects are the clearest first-class entities today.",
      "Other workstreams still rely more heavily on work-block and artifact evidence.",
    ],
    nextProof: [
      "Expand attribution without losing truthfulness in labels and AI answers.",
      "Only upgrade public claims when structured support actually exists.",
    ],
  },
  {
    title: "Richer recap storytelling and evidence packs",
    status: "Future ideas",
    surface: "Cross-platform",
    updated: "Direction only",
    summary:
      "The current recap foundation opens the door to richer storytelling later, but the present priority is proving the existing deterministic recap well before expanding it.",
    tags: ["Recap", "Storytelling", "Exports"],
    truthNow: [
      "A recap surface already exists in the AI view.",
      "That makes future seasonal storytelling and scheduled evidence packs plausible, but not current product truth.",
    ],
    nextProof: [
      "Finish validating the current recap and report/export surface.",
      "Add richer storytelling only after the base experience is stable and useful.",
    ],
  },
];

const STATUS_TONES: Record<RoadmapStatus, string> = {
  Shipped: "blue",
  "Implemented pending verification": "rose",
  "Active work": "violet",
  "Future ideas": "sand",
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
        item.surface,
        item.updated,
        ...item.tags,
        ...item.truthNow,
        ...item.nextProof,
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
                This page is literal. It separates what Daylens has already earned, what exists in
                code but still needs proof, what is actively being validated, and what is still
                directional.
              </p>
              <p className="lp-ray-board-note">
                Status buckets are fixed on purpose: shipped, implemented pending verification,
                active work, and future ideas.
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
                    placeholder="Search initiatives, surfaces, and status notes"
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
                            <span className="lp-ray-roadmap-card-count">{item.updated}</span>
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
                  <h3 className="lp-ray-roadmap-modal-label">What is true today</h3>
                  <ul className="lp-ray-roadmap-modal-list">
                    {selectedItem.truthNow.map((item) => (
                      <li key={`${selectedItem.title}-${item}`}>{item}</li>
                    ))}
                  </ul>
                </section>

                <section className="lp-ray-roadmap-modal-section">
                  <h3 className="lp-ray-roadmap-modal-label">What still needs proof</h3>
                  <ul className="lp-ray-roadmap-modal-list">
                    {selectedItem.nextProof.map((item) => (
                      <li key={`${selectedItem.title}-${item}-proof`}>{item}</li>
                    ))}
                  </ul>
                </section>
              </div>

              <aside className="lp-ray-roadmap-modal-side">
                <div className="lp-ray-roadmap-side-row">
                  <span>Status</span>
                  <strong>{selectedItem.status}</strong>
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
                  <span>Focus</span>
                  <strong>{selectedItem.tags.slice(0, 2).join(" · ")}</strong>
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
