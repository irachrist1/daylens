import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Blocks,
  Bot,
  Check,
  Code2,
  Database,
  Download,
  EyeOff,
  Layers3,
  MonitorDown,
  MousePointer2,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { assetPath } from "@/app/lib/basePath";
import {
  LINUX_STATUS_HREF,
  MAC_DOWNLOAD_HREF,
  WINDOWS_DOWNLOAD_HREF,
} from "@/app/lib/platformLinks";
import styles from "./V2Landing.module.css";

const GITHUB_URL = "https://github.com/irachrist1/daylens";

const surfaces = [
  {
    icon: Layers3,
    title: "Timeline",
    body: "One honest view of the day, grouped by what you were doing instead of which app happened to be open.",
    accent: "blue",
  },
  {
    icon: Blocks,
    title: "Apps",
    body: "Open any app and see the work inside it. Projects, pages, and threads stay connected to the same blocks.",
    accent: "violet",
  },
  {
    icon: Bot,
    title: "AI",
    body: "Ask what got done, where the afternoon went, or when you last touched a project. Answers cite your real day.",
    accent: "cyan",
  },
  {
    icon: Sparkles,
    title: "Wraps",
    body: "Daily and weekly stories built from the same facts, with real milestones worth remembering.",
    accent: "pink",
  },
] as const;

const proof = [
  "Runs on your computer",
  "Stores history locally",
  "Works across apps",
  "Exports when you ask",
];

const privacyCards = [
  {
    icon: Database,
    title: "Local by default",
    body: "Your work history lives in a SQLite database on your computer.",
  },
  {
    icon: EyeOff,
    title: "Noise stays invisible",
    body: "System processes and idle time do not get dressed up as meaningful work.",
  },
  {
    icon: ShieldCheck,
    title: "You choose the boundary",
    body: "Cloud sync is optional, filtered, and limited to the facts needed by your linked devices.",
  },
  {
    icon: MousePointer2,
    title: "Corrections always win",
    body: "Rename, merge, or hide a block once. Daylens keeps your version.",
  },
  {
    icon: Search,
    title: "Evidence before answers",
    body: "AI reads the same blocks as Timeline and Apps. If the evidence is thin, it says so.",
  },
  {
    icon: MonitorDown,
    title: "Built for every desktop",
    body: "Daylens is one product across macOS, Windows, and Linux.",
  },
];

function Mark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={styles.mark} aria-hidden="true">
      <span />
      <span />
      {!compact && <span />}
    </span>
  );
}

function SectionLabel({ number, children }: { number: string; children: React.ReactNode }) {
  return (
    <div className={styles.sectionLabel}>
      <span>{number}.</span>
      <span>{children}</span>
    </div>
  );
}

function ProductFrame({
  src,
  alt,
  className = "",
  priority = false,
}: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <div className={`${styles.productFrame} ${className}`}>
      <div className={styles.windowBar}>
        <span />
        <span />
        <span />
        <div>Daylens</div>
      </div>
      <Image
        src={assetPath(src)}
        alt={alt}
        width={2538}
        height={1802}
        priority={priority}
        quality={95}
        sizes="(max-width: 900px) 94vw, 1280px"
      />
    </div>
  );
}

export function V2Landing() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.logo} aria-label="Daylens home">
            <Mark />
            <span>Daylens</span>
          </Link>
          <nav className={styles.nav} aria-label="Main navigation">
            <a href="#product">Product</a>
            <Link href="/docs">Docs</Link>
            <Link href="/roadmap">Roadmap</Link>
            <Link href="/changelog">Changelog</Link>
          </nav>
          <div className={styles.headerActions}>
            <a className={styles.githubButton} href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Code2 size={16} />
              <span>GitHub</span>
            </a>
            <a className={`${styles.headerPlatform} ${styles.headerPlatformPrimary}`} href={MAC_DOWNLOAD_HREF}>macOS</a>
            <a className={styles.headerPlatform} href={WINDOWS_DOWNLOAD_HREF}>Windows</a>
            <a className={styles.headerPlatform} href={LINUX_STATUS_HREF}>Linux</a>
          </div>
        </div>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={styles.heroRail}>
            <div className={styles.heroCornerLeft} />
            <div className={styles.heroCornerRight} />
            <div className={styles.heroContent}>
              <div className={styles.releasePill}>
                <span>New</span>
                Daylens v2 is taking shape
                <ArrowRight size={13} />
              </div>
              <h1>
                Your day,
                <br />
                finally <em>makes sense</em>
              </h1>
              <p>
                Daylens turns the work scattered across your computer into one clear, searchable memory.
              </p>
              <div className={styles.heroActions}>
                <a className={styles.heroDownload} href={MAC_DOWNLOAD_HREF}>
                  <Download size={17} />
                  macOS
                </a>
                <a className={`${styles.heroDownload} ${styles.heroDownloadSecondary}`} href={WINDOWS_DOWNLOAD_HREF}>
                  <Download size={17} />
                  Windows
                </a>
                <a className={`${styles.heroDownload} ${styles.heroDownloadSecondary}`} href={LINUX_STATUS_HREF}>
                  <Download size={17} />
                  Linux
                </a>
              </div>
            </div>
            <div className={styles.heroFrameWrap}>
              <ProductFrame
                src="/hackathon/01-timeline-day.png"
                alt="Daylens Timeline showing a reconstructed day"
                priority
              />
            </div>
          </div>
        </section>

        <section className={`${styles.rail} ${styles.proofSection}`}>
          <div className={styles.cornerNodes} />
          <div className={styles.proofIntro}>
            <div>
              <SectionLabel number="02">The promise</SectionLabel>
              <h2>
                Built for people who want to know
                <br />
                <em>where the day went</em>
              </h2>
            </div>
            <p>
              Daylens watches the shape of your work, then gives it back as blocks you can read, correct, and ask questions about.
            </p>
          </div>
          <div className={styles.proofGrid}>
            {proof.map((item, index) => (
              <div key={item}>
                <span className={styles.proofNumber}>0{index + 1}</span>
                <Check size={18} />
                <strong>{item}</strong>
              </div>
            ))}
          </div>
        </section>

        <section id="product" className={`${styles.rail} ${styles.stackSection}`}>
          <div className={styles.centerHeading}>
            <SectionLabel number="03">The whole day</SectionLabel>
            <h2>
              Everything to understand
              <br />
              <em>what you actually did</em>
            </h2>
          </div>
          <div className={styles.surfaceTabs}>
            {surfaces.map((surface, index) => (
              <span key={surface.title} className={index === 0 ? styles.activeTab : undefined}>
                {surface.title}
              </span>
            ))}
          </div>
          <div className={styles.surfaceGrid}>
            {surfaces.map((surface, index) => {
              const Icon = surface.icon;
              return (
                <article key={surface.title} className={styles.surfaceCard} data-accent={surface.accent}>
                  <div className={styles.cardMeta}>VIEW. [0{index + 1}]</div>
                  <Icon size={22} />
                  <h3>{surface.title}</h3>
                  <p>{surface.body}</p>
                  <div className={styles.cardSketch}>
                    <span />
                    <span />
                    <span />
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className={`${styles.rail} ${styles.thesisSection}`}>
          <Mark compact />
          <blockquote>
            “Your tools are evidence. <em>Your work is the story.</em> Daylens keeps the two connected without confusing one for the other.”
          </blockquote>
          <p>One truth across Timeline, Apps, and AI</p>
        </section>

        <section id="how-it-works" className={`${styles.rail} ${styles.transitionSection}`}>
          <div className={styles.centerHeading}>
            <SectionLabel number="04">One truth</SectionLabel>
            <h2>
              Designed around your intent,
              <br />
              <em>not your app history</em>
            </h2>
          </div>
          <div className={styles.transitionFrame}>
            <ProductFrame
              src="/landing/v2/timeline-recap.png"
              alt="Daylens Timeline and day recap"
            />
          </div>
        </section>

        <section className={styles.navyWorld}>
          <div className={`${styles.rail} ${styles.navyIntro}`}>
            <div className={styles.connector} />
            <div className={styles.centerHeading}>
              <SectionLabel number="05">The day, reconstructed</SectionLabel>
              <h2>
                See the work in the <em>Timeline</em>,
                <br />
                through <em>Apps</em>, or ask <em>AI</em>
              </h2>
            </div>
            <div className={styles.darkSplit}>
              <article>
                <span className={styles.miniIcon}><Layers3 size={18} /></span>
                <h3>One block for one stretch of intent</h3>
                <p>Writing in Cursor, checking a reference in Dia, and replying in Slack can still be one piece of work.</p>
                <ul>
                  <li><Check size={15} /> Brief detours fold into the surrounding work</li>
                  <li><Check size={15} /> Same-intent neighbours merge</li>
                  <li><Check size={15} /> Block height always matches duration</li>
                </ul>
              </article>
              <article>
                <span className={styles.miniIcon}><Sparkles size={18} /></span>
                <h3>A clear picture, from day to month</h3>
                <p>Move from the exact shape of today to the larger threads carrying across your week.</p>
                <ul>
                  <li><Check size={15} /> Day, week, and month views</li>
                  <li><Check size={15} /> Meaningful work stays connected</li>
                  <li><Check size={15} /> Corrections survive every rebuild</li>
                </ul>
              </article>
            </div>
            <div className={styles.darkImagePair}>
              <ProductFrame src="/landing/v2/timeline-detail.png" alt="Daylens block detail view" />
              <ProductFrame src="/landing/v2/timeline-week.png" alt="Daylens week view" />
            </div>
          </div>

          <div className={`${styles.rail} ${styles.navyQuote}`}>
            <div className={styles.quoteLine} />
            <blockquote>
              The timeline is not a prettier activity log. It is the answer to one question: <em>what did I actually get done?</em>
            </blockquote>
            <Mark compact />
          </div>

          <div className={`${styles.rail} ${styles.capabilitiesSection}`}>
            <div className={styles.centerHeading}>
              <h2>
                Everything you need
                <br />
                to <em>remember the work</em>
              </h2>
            </div>
            <div className={styles.capabilityGrid}>
              {[
                ["Follow a project", "See the same thread return across the day or week."],
                ["Open the evidence", "Inspect the apps and pages supporting every block."],
                ["Correct the story", "Rename, merge, and hide without losing your changes."],
                ["Ask naturally", "Use plain language instead of building reports and filters."],
                ["Remember later", "Search the day you actually had, not the one you planned."],
                ["Take it with you", "Export your history in useful, readable formats."],
              ].map(([title, body], index) => (
                <article key={title}>
                  <span>MEM. [0{index + 1}]</span>
                  <div className={styles.orbit}>
                    <i />
                    <i />
                    <i />
                  </div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                  <div><Check size={14} /> Built from the same block facts</div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="privacy" className={`${styles.rail} ${styles.localSection}`}>
          <div className={styles.localHeading}>
            <div>
              <SectionLabel number="06">Local by design</SectionLabel>
              <h2>
                Your history should help you,
                <br />
                <em>without owning you</em>
              </h2>
            </div>
            <p>
              Daylens starts with a local database and a visible evidence trail. Sync and AI sit on top of that foundation, never underneath it.
            </p>
          </div>
          <div className={styles.localVisual}>
            <div className={styles.dataBars}>
              {Array.from({ length: 34 }, (_, index) => <span key={index} style={{ height: `${18 + ((index * 19) % 84)}%` }} />)}
            </div>
            <div className={styles.localStats}>
              <div><span>Source of truth</span><strong>Your computer</strong></div>
              <div><span>Background upload</span><strong>None</strong></div>
              <div><span>Corrections</span><strong>Permanent</strong></div>
            </div>
            <ProductFrame src="/landing/v2/timeline-month.png" alt="Daylens month view" />
          </div>
        </section>

        <section className={styles.blackWorld}>
          <div className={`${styles.rail} ${styles.privacySection}`}>
            <div className={styles.privacyHeading}>
              <div>
                <SectionLabel number="07">Yours, end to end</SectionLabel>
                <h2>
                  Private by default,
                  <br />
                  <em>useful out of the box</em>
                </h2>
              </div>
              <a href="#download" className={styles.blueButton}>Get Daylens <ArrowRight size={16} /></a>
            </div>
            <div className={styles.privacyGrid}>
              {privacyCards.map(({ icon: Icon, title, body }) => (
                <article key={title}>
                  <Icon size={24} />
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
            <blockquote>
              “A memory tool only earns its place when you can see what it knows, correct what it got wrong, and leave with your data.”
            </blockquote>
          </div>
        </section>

        <section id="download" className={`${styles.rail} ${styles.downloadSection}`}>
          <SectionLabel number="08">Ready?</SectionLabel>
          <h2>
            Get a clearer picture
            <br />
            <em>of your day</em>
          </h2>
          <div className={styles.downloadButtons}>
            <a className={styles.platformButton} href={MAC_DOWNLOAD_HREF}><Download size={16} /> macOS <ArrowRight size={16} /></a>
            <a className={`${styles.platformButton} ${styles.platformButtonSecondary}`} href={WINDOWS_DOWNLOAD_HREF}><Download size={16} /> Windows <ArrowRight size={16} /></a>
            <a className={`${styles.platformButton} ${styles.platformButtonSecondary}`} href={LINUX_STATUS_HREF}><Download size={16} /> Linux <ArrowRight size={16} /></a>
          </div>
        </section>

        <section className={`${styles.rail} ${styles.gallerySection}`}>
          <SectionLabel number="09">The product</SectionLabel>
          <h2>
            One day,
            <br />
            <em>seen from every angle</em>
          </h2>
          <div className={styles.galleryFrame}>
            <ProductFrame src="/hackathon/03-apps-all.png" alt="Daylens Apps view" />
          </div>
          <div className={styles.galleryLogos}>
            <span>Timeline</span>
            <span>Apps</span>
            <span>AI</span>
            <span>Wraps</span>
          </div>
        </section>
      </main>

      <footer className={`${styles.rail} ${styles.footer}`}>
        <div className={styles.footerTop}>
          <Link href="/" className={styles.logo}><Mark /><span>Daylens</span></Link>
          <div>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
            <Link href="/docs">Docs</Link>
            <Link href="/roadmap">Roadmap</Link>
            <Link href="/changelog">Changelog</Link>
          </div>
        </div>
        <div className={styles.footerWordmark}>daylens</div>
        <div className={styles.footerBottom}>
          <span>Built in Rwanda</span>
          <span>Local first, open source</span>
        </div>
      </footer>
    </div>
  );
}
