"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { Check, ChevronLeftIcon, ChevronRightIcon, ZoomIn, X } from "lucide-react";
import { Counter } from "./Counter";
import { ThemeToggle } from "./ThemeToggle";
import { assetPath } from "@/app/lib/basePath";
import {
  MAC_DOWNLOAD_HREF,
  WINDOWS_DOWNLOAD_HREF,
  LINUX_STATUS_HREF,
} from "@/app/lib/platformLinks";

import { Swiper, SwiperSlide } from "swiper/react";
import { Autoplay, EffectCoverflow, Navigation, Pagination } from "swiper/modules";
import { cn } from "@/app/lib/cn";

// Import Swiper styles
import "swiper/css";
import "swiper/css/effect-coverflow";
import "swiper/css/pagination";
import "swiper/css/navigation";

const GITHUB_URL = "https://github.com/irachrist1/daylens-v1";

// ─── Content ────────────────────────────────────────────────────────────────

const STATS = [
  { label: "Sessions watched this week", value: 397, suffix: "" },
  { label: "Apps in active orbit", value: 28, suffix: "" },
  { label: "Data shared with anyone else", value: 0, suffix: "%" },
];

const QUERIES = [
  {
    q: "What did I learn about machine learning this week?",
    a: "Neural network fundamentals, forward propagation, L-layer networks, plus the hands-on Coursera labs from Tuesday and Wednesday.",
    img: "/hackathon/05-ai-ml-query.png",
    tag: "ai chat",
    zoom: "1.35",
    origin: "80% 35%"
  },
  {
    q: "What did I work on today?",
    a: "13h 22m tracked, 24 blocks, 28 apps and 22 sites. Right-side narrative reads back the shape of the day, not just the totals.",
    img: "/hackathon/01-timeline-day.png",
    tag: "timeline",
    zoom: "1.25",
    origin: "85% 35%"
  },
  {
    q: "How long was I in Ghostty during Building & Testing blocks?",
    a: "5h 20m across three days. Broken down to the minute per session. The query routes to block + app intersections.",
    img: "/hackathon/06-ai-ghostty-query.png",
    tag: "ai chat",
    zoom: "1.35",
    origin: "80% 20%"
  },
  {
    q: "Show me what I actually consumed in Dia.",
    a: "Domain breakdown for every browser app, with a generated summary of what each app was used for — not just hours-in-tab.",
    img: "/hackathon/03-apps-all.png",
    tag: "apps",
    zoom: "1.3",
    origin: "85% 35%"
  },
];

const PILLARS = [
  {
    title: "Content Indexer",
    body: "A background job sends every new browser session to Claude with a two-sentence, topic-tagged prompt. Results land in a local SQLite table the chat can search. Built this week.",
  },
  {
    title: "Tool-calling chat",
    body: "Claude with SQLite tables and the content index as tools. Deterministic router handles common shapes first. searchContentByTopic returns what you actually consumed.",
  },
  {
    title: "MCP server",
    body: "Opt-in MCP exposes Daylens to Claude Desktop, Cursor, and Claude Code. Your work history becomes context for any agent. Off by default, revocable from Settings.",
  },
  {
    title: "Local-first by design",
    body: "Every byte lives in a single SQLite file on your laptop. The only thing that leaves the device is the question you choose to ask.",
  },
];

const SUPPORTED_APPS = [
  { name: "VS Code", src: "/brands/vscode.ico" },
  { name: "Claude", src: "/brands/claude-app.png" },
  { name: "Dia", src: "/brands/dia.png" },
  { name: "Chrome", src: "/brands/chrome.svg" },
  { name: "Notion", src: "/brands/notion.svg" },
  { name: "Figma", src: "/brands/figma.svg" },
  { name: "Linear", src: "/brands/linear.svg" },
  { name: "Slack", src: "/brands/slack.png" },
];

// ─── UI primitives ──────────────────────────────────────────────────────────

function Button({
  children,
  variant = "primary",
  href,
  className = "",
  target,
  rel,
  ...props
}: {
  children: React.ReactNode;
  variant?: "primary" | "outline";
  href?: string;
  className?: string;
  target?: string;
  rel?: string;
}) {
  const base =
    "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition-colors";
  const styles =
    variant === "primary"
      ? "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      : "border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-transparent dark:text-zinc-100 dark:hover:bg-zinc-900";
  const cls = `${base} ${styles} ${className}`;
  // Plain <a> rather than next/link: these hrefs are downloads, external links,
  // and in-page hash scrolls — none need client-side routing. Using next/link
  // here would re-apply the configured basePath on top of hrefs that already
  // carry it (via withBasePath), producing /daylens/daylens/... 404s.
  return href ? (
    <a href={href} target={target} rel={rel} className={cls} {...props}>
      {children}
    </a>
  ) : (
    <button className={cls} {...props}>
      {children}
    </button>
  );
}

function AppleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.36-1.09-.46-2.08-.48-3.22 0-1.43.62-2.18.44-3.04-.36C2.82 15.22 3.54 7.59 9.09 7.31c1.35.07 2.3.74 3.09.8 1.18-.24 2.3-.93 3.56-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.3 2.98-2.57 4.08ZM12.09 7.27c-.15-2.23 1.66-4.07 3.75-4.27.29 2.58-2.07 4.52-3.75 4.27Z" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M0 2.357L6.545 1.5v6H0V2.357zM7.273 1.393L16 0v7.5H7.273V1.393zM0 8.5h6.545v6L0 13.643V8.5zM7.273 8.5H16V16l-8.727-1.393V8.5z" />
    </svg>
  );
}

function LinuxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.84-.41 1.66-.401 2.49a4.85 4.85 0 0 0 .03.484c-.27.272-.61.61-.86 1.024-.32.529-.665 1.157-.665 1.835v.013c0 .35.099.706.282 1.013.27.448.74.798 1.276 1.041.535.244 1.207.392 1.974.392.62 0 1.176-.097 1.65-.273.422-.156.78-.385 1.039-.674.245-.273.448-.547.59-.832.176-.358.301-.74.347-1.137l.146-1.51c.05-.547.275-1.06.685-1.405.42-.351.973-.557 1.529-.557.555 0 1.108.206 1.527.557.41.345.636.858.687 1.405l.144 1.51c.046.397.171.778.348 1.137.142.285.345.56.59.832.259.289.617.518 1.039.674.474.176 1.03.273 1.65.273.768 0 1.439-.148 1.974-.392.535-.243 1.006-.593 1.276-1.041.183-.307.282-.663.282-1.013v-.013c0-.678-.346-1.306-.665-1.835-.25-.414-.59-.752-.86-1.024.02-.16.03-.32.03-.484.009-.83-.123-1.65-.4-2.49-.59-1.771-1.831-3.47-2.717-4.521-.75-1.067-.973-1.928-1.05-3.02C16.103 4.808 17.224.334 12.998.021 12.83.008 12.667 0 12.504 0z" />
    </svg>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function HackathonLanding() {
  const [zoomImage, setZoomImage] = useState<{ img: string; q: string; a: string; tag: string; zoom: string; origin: string } | null>(null);

  useEffect(() => {
    if (!zoomImage) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setZoomImage(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [zoomImage]);

  return (
    <div className="min-h-screen bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
      {/* NAVBAR */}
      <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-full border border-zinc-200 bg-white/80 p-2 pl-4 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/70">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src={assetPath("/app-icon.png")}
              alt="Daylens"
              width={28}
              height={28}
              className="size-7 rounded-md"
            />
            <span className="text-sm font-medium tracking-tight">Daylens</span>
          </Link>
          <nav className="hidden gap-7 lg:flex">
            {[
              { label: "Demos", href: "#demos" },
              { label: "Privacy", href: "#privacy" },
              { label: "Architecture", href: "#architecture" },
              { label: "GitHub", href: GITHUB_URL },
            ].map((l) => (
              <a
                key={l.label}
                href={l.href}
                target={l.href.startsWith("http") ? "_blank" : undefined}
                rel={l.href.startsWith("http") ? "noreferrer" : undefined}
                className="text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button href="#download" variant="primary" className="h-9 text-xs">
              Download
            </Button>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative px-4 pt-32 pb-16 lg:pt-40 lg:pb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="mx-auto flex max-w-6xl flex-col items-center gap-14 lg:items-stretch"
        >
          <section className="flex w-full flex-col items-start justify-between gap-8 lg:flex-row lg:gap-12">
            <h1 className="max-w-2xl text-balance text-4xl font-medium leading-[1.05] tracking-tighter md:text-6xl lg:text-7xl">
              Your digital life, made searchable on demand.
            </h1>
            <div className="flex max-w-md flex-col gap-6 lg:pt-3">
              <p className="text-base leading-relaxed text-zinc-600 dark:text-zinc-400 md:text-lg">
                Daylens is a local-first memory system for your laptop. It
                watches what you do, enriches it with Claude, and lets you ask
                anything in plain language.
              </p>
              <div className="flex flex-row gap-2">
                <Button href="#demos" variant="primary">
                  See it answer
                </Button>
                <Button href="#download" variant="outline">
                  Download
                </Button>
              </div>
            </div>
          </section>

          <div className="relative mx-auto w-full max-w-6xl overflow-hidden rounded-xl border border-zinc-200 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.12)] dark:border-zinc-800 dark:shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] lg:rounded-[2rem]">
            <Image
              src={assetPath("/hackathon/01-timeline-day.png")}
              alt="Daylens today view — a reconstructed timeline of your work"
              width={2538}
              height={1802}
              priority
              quality={95}
              sizes="(max-width: 768px) calc(100vw - 2rem), (max-width: 1280px) calc(100vw - 2rem), 1152px"
              className="h-auto w-full"
              style={{
                imageRendering: "-webkit-optimize-contrast",
              }}
            />
          </div>
        </motion.div>
      </section>

      {/* SUPPORTED APPS */}
      <section className="px-4 py-16">
        <div className="mx-auto flex max-w-6xl flex-col gap-8">
          <div className="flex flex-col items-center text-center">
            <h2 className="text-3xl font-medium tracking-tight md:text-4xl">
              The apps you already live in.
            </h2>
            <p className="mt-3 max-w-md text-base text-zinc-500 dark:text-zinc-400">
              Daylens watches without integrations, plug-ins, or permissions
              you'll regret.
            </p>
          </div>

          <div className="grid grid-cols-2 border-l border-t border-zinc-200 dark:border-zinc-800 md:grid-cols-4">
            {SUPPORTED_APPS.map((app) => (
              <div
                key={app.name}
                className="flex h-24 items-center justify-center border-b border-r border-zinc-200 grayscale transition-all duration-300 hover:grayscale-0 dark:border-zinc-800 lg:h-32"
              >
                <Image
                  src={assetPath(app.src)}
                  alt={app.name}
                  width={32}
                  height={32}
                  className="size-8 opacity-90"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="px-4 py-20 lg:py-28">
        <div className="mb-16 flex flex-col items-center gap-3 text-center">
          <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">
            Memory over surveillance.
          </h2>
          <p className="max-w-md text-base text-zinc-500 dark:text-zinc-400">
            The data you generate every day should belong to you. So it does.
          </p>
        </div>

        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-1 border-l border-t border-zinc-200 dark:border-zinc-800 md:grid-cols-3">
            {STATS.map((stat) => (
              <div
                key={stat.label}
                className="flex flex-col items-center justify-center border-b border-r border-zinc-200 px-6 py-12 text-center dark:border-zinc-800"
              >
                <div className="text-4xl font-medium tracking-tight md:text-5xl">
                  <Counter value={stat.value} suffix={stat.suffix} />
                </div>
                <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DEMOS */}
      <section id="demos" className="px-4 py-20 lg:py-28 overflow-hidden">
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center lg:mb-24">
            <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">
              Ask anything. Get a real answer.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-zinc-500 dark:text-zinc-400">
              Four queries, four real answers from real data on a real laptop.
              No mocks. No edits.
            </p>
          </div>

          <div className="relative mx-auto max-w-5xl px-4 md:px-8">
            {/* Custom Carousel Styles */}
            <style>{`
              .demos-swiper {
                width: 100%;
                padding-bottom: 50px !important;
                overflow: visible !important;
              }
              .demos-swiper .swiper-slide {
                width: 100%;
                max-width: 600px;
                opacity: 0.35;
                filter: blur(4px);
                transform: scale(0.93);
                transition: opacity 0.4s ease, filter 0.4s ease, transform 0.4s ease;
              }
              .demos-swiper .swiper-slide-active {
                opacity: 1;
                filter: blur(0px);
                transform: scale(1);
              }
              .demos-swiper img {
                image-rendering: -webkit-optimize-contrast;
                image-rendering: crisp-edges;
              }
              .demos-swiper .swiper-pagination-bullet {
                background: #71717a !important; /* zinc-400 */
                opacity: 0.4;
                transition: opacity 0.2s ease, background-color 0.2s ease;
              }
              .demos-swiper .swiper-pagination-bullet-active {
                background: #18181b !important; /* zinc-900 */
                opacity: 1;
              }
              .dark .demos-swiper .swiper-pagination-bullet-active {
                background: #f4f4f5 !important; /* zinc-100 */
                opacity: 1;
              }
            `}</style>

            <Swiper
              modules={[Autoplay, Pagination, Navigation]}
              grabCursor={true}
              centeredSlides={true}
              slidesPerView="auto"
              loop={true}
              autoplay={{
                delay: 4000,
                disableOnInteraction: false,
                pauseOnMouseEnter: true,
              }}
              pagination={{
                clickable: true,
              }}
              navigation={{
                nextEl: ".demos-swiper-button-next",
                prevEl: ".demos-swiper-button-prev",
              }}
              className="demos-swiper"
            >
              {QUERIES.map((query, i) => (
                <SwiperSlide key={query.q}>
                  <motion.article
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{
                      duration: 0.45,
                      ease: [0.25, 0.46, 0.45, 0.94],
                    }}
                    className="flex h-full min-h-[420px] min-w-0 flex-col justify-between gap-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 md:p-8"
                  >
                    <header className="flex flex-col gap-2.5">
                      <p className="text-lg font-medium leading-snug tracking-tight text-zinc-900 dark:text-zinc-100 md:text-xl">
                        "{query.q}"
                      </p>
                    </header>

                    <div
                      onClick={() => setZoomImage(query)}
                      className="group/img relative mt-auto overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 cursor-pointer aspect-[16/10]"
                    >
                      {/* Animated Scale Wrapper on Hover */}
                      <div className="w-full h-full overflow-hidden transition-transform duration-300 group-hover/img:scale-[1.02]">
                        <Image
                          src={assetPath(query.img)}
                          alt={query.q}
                          width={1280}
                          height={800}
                          quality={95}
                          sizes="(max-width: 768px) 100vw, 1000px"
                          className="w-full h-full object-cover"
                          style={{
                            transform: `scale(${query.zoom})`,
                            transformOrigin: query.origin,
                          }}
                        />
                      </div>
                      {/* Hover Overlay */}
                      <div className="absolute inset-0 bg-black/0 transition-all duration-300 group-hover/img:bg-black/20 flex items-center justify-center">
                        <div className="p-2.5 rounded-full bg-white/90 dark:bg-zinc-900/90 shadow-md border border-zinc-200 dark:border-zinc-800 opacity-0 scale-90 transition-all duration-300 group-hover/img:opacity-100 group-hover/img:scale-100 flex items-center gap-1.5 text-xs font-medium text-zinc-900 dark:text-zinc-100">
                          <ZoomIn className="size-4" />
                          <span>Click to expand</span>
                        </div>
                      </div>
                    </div>
                  </motion.article>
                </SwiperSlide>
              ))}
            </Swiper>

            {/* Custom Navigation Buttons */}
            <div className="absolute left-0 top-1/2 z-10 w-full -translate-y-1/2 pointer-events-none hidden md:flex justify-between px-0 md:-px-4">
              <button className="demos-swiper-button-prev p-3 rounded-full bg-white/90 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 shadow-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all active:scale-95 pointer-events-auto -translate-x-1/2">
                <ChevronLeftIcon className="h-5 w-5 text-zinc-800 dark:text-zinc-200" />
              </button>
              <button className="demos-swiper-button-next p-3 rounded-full bg-white/90 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 shadow-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all active:scale-95 pointer-events-auto translate-x-1/2">
                <ChevronRightIcon className="h-5 w-5 text-zinc-800 dark:text-zinc-200" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* PRIVACY */}
      <section id="privacy" className="px-4 py-20 lg:py-28">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="mx-auto w-full max-w-7xl rounded-[2rem] bg-zinc-900 px-6 pt-16 pb-8 dark:bg-zinc-100 md:px-12 md:py-20"
        >
          <div className="mx-auto max-w-4xl">
            <div className="mb-12 flex flex-col items-center text-center">
              <h2 className="text-3xl font-medium tracking-tight text-white dark:text-zinc-900 sm:text-4xl">
                Nothing leaves your device unless you ask.
              </h2>
              <p className="mt-4 max-w-md text-sm text-white/70 dark:text-zinc-600 sm:text-base">
                The privacy model is not a feature. It is the constraint that
                makes the rest of the product trustworthy.
              </p>
            </div>

            <div className="overflow-hidden rounded-2xl bg-white dark:bg-zinc-950">
              <div className="flex flex-col md:flex-row">
                <div className="flex flex-col border-b border-zinc-200 p-8 dark:border-zinc-800 md:basis-2/5 md:border-b-0 md:border-r md:p-10">
                  <h3 className="text-center text-3xl font-medium tracking-tight">
                    Local-first
                  </h3>
                  <p className="mt-2 text-center text-base text-zinc-500 dark:text-zinc-400">
                    A single SQLite file on your laptop. No cloud. No account.
                  </p>
                  <p className="mt-8 text-center text-lg font-medium">
                    Free, forever, on every Mac.
                  </p>
                  <div className="mt-8 flex flex-col gap-3">
                    <Button href={MAC_DOWNLOAD_HREF} variant="primary" className="w-full">
                      <AppleIcon /> Download for Mac
                    </Button>
                    <Button href={GITHUB_URL} target="_blank" rel="noreferrer" variant="outline" className="w-full">
                      Read the source
                    </Button>
                  </div>
                  <p className="mt-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
                    Open source. CBC Spring 2026 Hackathon submission.
                  </p>
                </div>

                <div className="flex flex-col justify-between p-8 md:basis-3/5 md:p-10">
                  <ul className="flex flex-col gap-3">
                    {[
                      "Every byte stored locally in SQLite",
                      "Zero background telemetry",
                      "Zero third-party analytics",
                      "Only your question is sent to Claude, per query",
                      "MCP access is opt-in and revocable",
                      "Settings shows every captured field",
                      "Delete the database, delete every byte",
                    ].map((line) => (
                      <li key={line} className="flex items-center gap-3">
                        <Check className="size-4" strokeWidth={2} />
                        <span className="text-sm font-medium">{line}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-8 border-t border-zinc-200 pt-6 dark:border-zinc-800">
                    <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                      Daylens is designed around the inverse of surveillance.
                      You see what is captured. You decide what your AI can
                      read. The product is self-knowledge under your control.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ARCHITECTURE */}
      <section id="architecture" className="px-4 py-20 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">
              Three Claude integrations, not one.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-zinc-500 dark:text-zinc-400">
              Substantive use of the API. Not a chatbot wrapped around your
              schedule.
            </p>
          </div>

          <div className="grid grid-cols-1 border-l border-t border-zinc-200 dark:border-zinc-800 md:grid-cols-2">
            {PILLARS.map((pillar) => (
              <div
                key={pillar.title}
                className="flex flex-col gap-3 border-b border-r border-zinc-200 p-10 dark:border-zinc-800"
              >
                <h3 className="text-xl font-medium tracking-tight">
                  {pillar.title}
                </h3>
                <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {pillar.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DEMO VIDEO PLACEHOLDER */}
      <section id="video" className="px-4 py-20 lg:py-28">
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">
            See it answer in real time.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-zinc-500 dark:text-zinc-400">
            A three-minute walkthrough against live data. Same four queries.
            Real answers.
          </p>

          <div className="mt-12 overflow-hidden rounded-2xl border border-zinc-200 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.12)] dark:border-zinc-800">
            <div className="flex aspect-video flex-col items-center justify-center bg-zinc-50 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              <p className="mt-3 font-mono text-xs uppercase tracking-widest">
                demo · uploading
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* DOWNLOAD */}
      <section id="download" className="px-4 py-24 lg:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-4xl font-medium tracking-tighter md:text-6xl">
            Get your history back.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base text-zinc-500 dark:text-zinc-400">
            Open source. Local-first. Available now for macOS. Windows and
            Linux are next.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button href={MAC_DOWNLOAD_HREF} variant="primary">
              <AppleIcon /> Download for Mac
            </Button>
            <Button href={WINDOWS_DOWNLOAD_HREF} variant="outline">
              <WindowsIcon /> Download for Windows
            </Button>
            <Button href={LINUX_STATUS_HREF} variant="outline">
              <LinuxIcon /> Linux status
            </Button>
          </div>
          <p className="mt-6 text-xs text-zinc-400 dark:text-zinc-500">
            Source on{" "}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              GitHub
            </a>
            .
          </p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-zinc-200 px-4 py-10 dark:border-zinc-800">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-zinc-500 dark:text-zinc-400 md:flex-row">
          <div className="flex items-center gap-2">
            <Image
              src={assetPath("/app-icon.png")}
              alt="Daylens"
              width={20}
              height={20}
              className="size-5"
            />
            <span className="font-medium tracking-tight text-zinc-900 dark:text-zinc-100">
              Daylens
            </span>
          </div>
          <p className="font-mono text-[11px] uppercase tracking-widest">
            CBC Spring 2026 · ALU · Christian Tonny
          </p>
        </div>
      </footer>

      {/* LIGHTBOX MODAL */}
      <AnimatePresence>
        {zoomImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-4 md:p-8 bg-zinc-950/80 backdrop-blur-md cursor-zoom-out"
            onClick={() => setZoomImage(null)}
          >
            {/* Modal Content */}
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative w-full max-w-5xl bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col cursor-default"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button */}
              <button
                onClick={() => setZoomImage(null)}
                className="absolute right-4 top-4 z-10 p-2.5 rounded-full bg-zinc-950/60 hover:bg-zinc-800 border border-zinc-800/80 text-zinc-400 hover:text-white transition-all active:scale-95 shadow-md cursor-pointer"
              >
                <X className="size-5" />
              </button>

              {/* High-res Image Wrapper */}
              <div className="relative w-full aspect-[16/10] overflow-hidden bg-zinc-950 flex items-center justify-center">
                <img
                  src={assetPath(zoomImage.img)}
                  alt={zoomImage.q}
                  className="w-full h-full object-cover select-none"
                  style={{
                    imageRendering: "-webkit-optimize-contrast",
                    transform: `scale(${zoomImage.zoom})`,
                    transformOrigin: zoomImage.origin,
                  }}
                />
              </div>

              {/* Bottom Caption Bar */}
              <div className="p-5 md:p-6 bg-zinc-950 border-t border-zinc-900 flex flex-col gap-2">
                <h4 className="text-base font-semibold leading-snug text-white md:text-lg">
                  "{zoomImage.q}"
                </h4>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
