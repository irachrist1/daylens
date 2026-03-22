# Daylens — Technical Architecture

> Complete technical reference for the Daylens cross-platform activity tracking ecosystem.
> Last updated: 2026-03-22

---

## 1. System Overview

Daylens is a three-platform ecosystem: desktop apps produce activity data locally, a cloud backend relays it, and a web dashboard displays it.

```mermaid
graph TB
    subgraph Desktop["Desktop Apps (data producers)"]
        MAC["macOS App<br/>Swift + SwiftUI + GRDB<br/>v1.0.6"]
        WIN["Windows App<br/>Electron + React + better-sqlite3<br/>v1.0.4-win"]
    end

    subgraph Backend["Convex Cloud Backend"]
        HTTP["HTTP Endpoints<br/>/uploadSnapshot<br/>/createWorkspace<br/>/createLinkCode<br/>/storeApiKey"]
        DB["Convex Database<br/>workspaces, devices,<br/>day_snapshots, link_codes,<br/>encrypted_keys, web_chats"]
        AUTH["Auth Layer<br/>ES256 JWT signing<br/>Session validation"]
    end

    subgraph Web["Web Dashboard (read-only consumer)"]
        NEXT["Next.js 16 on Vercel<br/>daylens-web.vercel.app"]
        MW["Middleware<br/>JWT cookie verification"]
        POLL["Poller<br/>30s refresh cycle"]
    end

    subgraph Analytics["Analytics"]
        PH["PostHog<br/>us.i.posthog.com"]
    end

    MAC -- "POST /uploadSnapshot<br/>every 5 min (Bearer JWT)" --> HTTP
    WIN -- "POST /uploadSnapshot<br/>every 5 min (Bearer JWT)" --> HTTP
    HTTP --> DB
    DB -- "Convex queries<br/>(getByDate, list)" --> NEXT
    NEXT --> MW
    MW --> POLL

    MAC -. "QR code / link token<br/>(32-hex, 5-min expiry)" .-> NEXT
    WIN -. "QR code / link token" .-> NEXT

    WIN -- "posthog-node events" --> PH
    NEXT -- "posthog-js pageviews<br/>+ custom events" --> PH
```

### Repositories

| Platform | Repo | Deploy | Branch Model |
|----------|------|--------|-------------|
| macOS | [irachrist1/daylens](https://github.com/irachrist1/daylens) | GitHub Releases (`.dmg`) via CI | `main` + `codex/functional-pass-chromatic-sanctuary` (dev) |
| Windows | [irachrist1/daylens-windows](https://github.com/irachrist1/daylens-windows) | GitHub Releases (`.exe`) via CI | `main` only |
| Web | [irachrist1/daylens-web](https://github.com/irachrist1/daylens-web) | Vercel auto-deploy on push | `main` only |

---

## 2. macOS Tracking Pipeline

Everything runs locally — no network required for core tracking. The app is a native SwiftUI menu bar app using GRDB for SQLite persistence.

```mermaid
flowchart TD
    NSW["NSWorkspace Notifications<br/>didActivateApplication<br/>didDeactivateApplication<br/>activeSpaceDidChange<br/>didTerminateApplication"]
    AT["ActivityTracker<br/>Session state machine<br/>1.5s Space bridge window"]
    ID["IdleDetector<br/>IOKit HIDIdleTime<br/>poll every 5s<br/>idle threshold: 300s"]
    AX["AccessibilityService<br/>Frontmost window title<br/>Browser address bar URL"]
    AS["AppleScript Fallback<br/>activeTab() for Chrome,<br/>Arc, Safari, Brave,<br/>Vivaldi, Opera, Edge"]
    BH["BrowserHistoryReader<br/>Polls SQLite History files<br/>every 60s<br/>Copies WAL/SHM sidecars"]
    TC["TrackingCoordinator<br/>Orchestrates all services<br/>3s URL poll interval"]
    DB[(SQLite via GRDB<br/>~/Library/Application Support/<br/>Daylens/daylens.sqlite)]
    SYNC["SyncUploader<br/>5-min interval<br/>Dirty-day tracking"]
    CONVEX["Convex Backend<br/>POST /uploadSnapshot"]

    TC --> AT
    TC --> ID
    TC --> AX
    TC --> BH

    NSW --> AT
    AT -- "finalizeSession()" --> DB
    ID -- "idle/resume callback" --> TC
    AX -- "URL + title<br/>every 3s" --> TC
    AS -- "fallback when AX<br/>returns no URL" --> TC
    TC -- "finalizeWebVisit()" --> DB
    BH -- "insertWebsiteVisit()" --> DB
    TC -- "computeDailySummary()" --> DB

    DB --> SYNC
    SYNC -- "Bearer JWT<br/>DaySnapshot JSON" --> CONVEX
```

### Session lifecycle

1. **NSWorkspace** fires `didActivateApplication` → `ActivityTracker.handleAppActivation()`
2. Stores app in `currentApp` (bundleID, appName, timestamp)
3. On different app activation → `finalizeSession()` writes `AppSession` row
4. **Space transitions**: same-app deactivate/reactivate within **1.5 seconds** = seamless bridge (no gap)
5. **App termination**: session finalized immediately

### Idle detection state machine

```mermaid
stateDiagram-v2
    [*] --> Active
    Active --> Idle : HIDIdleTime >= 300s
    Idle --> Active : HIDIdleTime < 300s (user returns)

    state Active {
        [*] --> Tracking
        Tracking : Sessions accumulate normally
        Tracking : URL polling active (3s)
        Tracking : Browser history polling (60s)
    }

    state Idle {
        [*] --> Paused
        Paused : Current session finalized
        Paused : Web visit finalized
        Paused : NSWorkspace observers still alive
        Paused : No new sessions recorded
    }
```

### Website tracking (dual-layer)

```mermaid
flowchart LR
    subgraph Layer1["Layer 1: Live URL Polling (every 3s)"]
        AX2["Accessibility API<br/>Read browser address bar<br/>Medium confidence"]
        AS2["AppleScript<br/>activeTab(for: bundleID)<br/>High confidence — replaces AX"]
    end

    subgraph Layer2["Layer 2: Browser History Files (every 60s)"]
        COPY["Copy History + WAL + SHM<br/>from browser profile dirs"]
        SQL["Query urls + visits tables<br/>since last poll timestamp<br/>Up to 5,000 rows per poll"]
        GAP["Navigation-gap estimation<br/>for duration (Chromium<br/>visit_duration is unreliable)"]
    end

    AX2 --> MERGE["TrackingCoordinator<br/>Domain session tracking"]
    AS2 --> MERGE
    MERGE -- "finalizeWebVisit()" --> DB2[(website_visits)]

    COPY --> SQL --> GAP --> DB2
```

**Why two layers?**
- Layer 1 captures what you're looking at *right now* (live URL from the active tab)
- Layer 2 backfills history from browser SQLite files — catches tabs you visited but didn't stay on long enough for polling

**Supported browsers (macOS)**:
Chrome, Arc, Safari, Brave, Vivaldi, Opera, Edge, Firefox (history only)

---

## 3. Windows Tracking Pipeline

Electron app with native modules. Similar architecture, different system APIs.

```mermaid
flowchart TD
    AW["@paymoapp/active-window<br/>Native polling every 5s<br/>Returns: title, path, pid"]
    PM["Electron powerMonitor<br/>getSystemIdleTime()"]
    BH2["Browser History Reader<br/>better-sqlite3 on copied<br/>History + WAL/SHM files"]
    TRACK["Tracking Service<br/>Three-state idle model<br/>15s same-app merge"]
    DB3[(SQLite via better-sqlite3<br/>%APPDATA%/DaylensWindows/<br/>daylens.sqlite)]
    SYNC2["SyncUploader<br/>5-min interval<br/>First sync at 10s"]
    PH["PostHog Analytics<br/>posthog-node via IPC"]

    AW -- "active window info" --> TRACK
    PM -- "idle seconds" --> TRACK

    TRACK -- "insertAppSession()" --> DB3
    BH2 -- "insertWebsiteVisit()" --> DB3

    TRACK -- "events via IPC" --> PH
    DB3 --> SYNC2
```

### Three-state idle model

```mermaid
stateDiagram-v2
    [*] --> active
    active --> provisional_idle : idle >= 120s
    provisional_idle --> active : user returns < 300s
    provisional_idle --> away : idle >= 300s
    away --> active : user returns

    state active {
        [*] --> Polling
        Polling : Session accumulates
        Polling : 5s window polls
    }

    state provisional_idle {
        [*] --> Holding
        Holding : Session stays open
        Holding : No flush yet
        Holding : Covers video/reading
    }

    state away {
        [*] --> Flushed
        Flushed : Session finalized
        Flushed : End time = when idle began
        Flushed : Idle gap excluded from duration
    }
```

**Why three states instead of two?** The provisional_idle state (120–300s) keeps the session open for passive activities — watching videos, reading long articles. Only after 5 full minutes of no input does the session end.

**Supported browsers (Windows)**: Chrome, Edge, Brave (Firefox not supported — different SQLite schema)

---

## 4. Data Storage

### Storage comparison

| Aspect | macOS | Windows | Web Backend | Web Frontend |
|--------|-------|---------|-------------|--------------|
| **Database** | SQLite (GRDB) | SQLite (better-sqlite3) | Convex cloud DB | None (read-only) |
| **DB Path** | `~/Library/Application Support/Daylens/daylens.sqlite` | `%APPDATA%/DaylensWindows/daylens.sqlite` | Convex-managed | — |
| **Credentials** | Keychain (`com.daylens.app` + `com.daylens.sync`) | Windows Credential Manager (keytar, service: `DaylensWindows`) | `CONVEX_ENCRYPTION_SECRET` env var | JWT in HttpOnly cookie |
| **API Key** | Keychain (plaintext, local only) | Credential Manager (plaintext, local only) | AES-256-GCM encrypted in `encrypted_keys` table | Never seen by browser |
| **Backup** | Rolling daily (7 files in `Backups/`) | None | Convex auto-backup | — |
| **Sync** | 5-min upload + on-quit + on focus-session change | 5-min upload + first sync at 10s + on-quit | Receive only | 30s polling via `Poller` component |

### macOS database schema

```mermaid
erDiagram
    app_sessions {
        INTEGER id PK
        TEXT date
        TEXT bundleID
        TEXT appName
        TEXT startTime
        TEXT endTime
        REAL duration
        TEXT category
        BOOLEAN isBrowser
    }

    website_visits {
        INTEGER id PK
        TEXT date
        TEXT domain
        TEXT fullURL
        TEXT pageTitle
        TEXT browserBundleID
        TEXT startTime
        TEXT endTime
        REAL duration
        TEXT confidence
        TEXT source
    }

    daily_summaries {
        INTEGER id PK
        TEXT date
        REAL totalActiveTime
        REAL focusScore
        INTEGER sessionCount
        TEXT topAppBundleID
        TEXT topDomain
        TEXT aiSummary
    }

    focus_sessions {
        INTEGER id PK
        TEXT date
        TEXT startTime
        TEXT endTime
        REAL duration
        TEXT label
    }

    category_overrides {
        TEXT bundleID PK
        TEXT category
    }

    ai_conversations {
        INTEGER id PK
        TEXT date
        TEXT question
        TEXT answer
    }

    activity_events {
        INTEGER id PK
        TEXT timestamp
        TEXT eventType
        TEXT bundleID
        TEXT appName
        BOOLEAN isIdle
        TEXT confidence
        TEXT source
    }

    browser_sessions {
        INTEGER id PK
        TEXT date
        TEXT browserBundleID
        TEXT startTime
        TEXT endTime
        REAL duration
    }
```

**Migrations** (additive only — `eraseDatabaseOnSchemaChange` is permanently banned):

| Version | Adds | Notes |
|---------|------|-------|
| `v1_create_tables` | All base tables | Baseline schema |
| `v2_focus_sessions` | `focus_sessions` | Focus timer feature |
| `v3_category_overrides` | `category_overrides` | User category corrections |

### Convex database schema

```mermaid
erDiagram
    workspaces {
        id _id PK
        number createdAt
        string recoveryKeyHash
    }

    devices {
        id _id PK
        id workspaceId FK
        string deviceId
        string platform
        string displayName
        number lastSyncAt
    }

    day_snapshots {
        id _id PK
        id workspaceId FK
        string deviceId
        string localDate
        any snapshot
        number syncedAt
    }

    link_codes {
        id _id PK
        id workspaceId FK
        string tokenHash
        string displayCode
        number expiresAt
        number failedAttempts
    }

    encrypted_keys {
        id _id PK
        id workspaceId FK
        string encryptedAnthropicKey
    }

    web_chats {
        id _id PK
        id workspaceId FK
        any messages
        number updatedAt
    }

    http_rate_limits {
        id _id PK
        string key
        number count
        number expiresAt
    }

    workspaces ||--o{ devices : "has"
    workspaces ||--o{ day_snapshots : "stores"
    workspaces ||--o{ link_codes : "generates"
    workspaces ||--|| encrypted_keys : "has"
    workspaces ||--|| web_chats : "has"
```

### Keychain / credential storage detail

**macOS Keychain** (`com.daylens.app`):
- `anthropic_api_key` — user's Anthropic API key (local AI chat)

**macOS Keychain** (`com.daylens.sync`):
- `sync-device-id` — UUID identifying this Mac
- `sync-session-token` — Convex JWT (365-day lifetime)
- `sync-public-workspace-id` — workspace identifier
- `sync-convex-url` — Convex HTTP endpoint URL
- `recovery-mnemonic` — BIP39 12-word recovery phrase

**Windows Credential Manager** (service: `DaylensWindows`):
- `workspaceId`, `workspaceToken`, `deviceId`, `recoveryMnemonic`

**Web browser**:
- `daylens_session` cookie — JWT (HttpOnly, Secure, SameSite=Strict, 30-day expiry)

---

## 5. Cross-Platform Sync

### Full linking and sync sequence

```mermaid
sequenceDiagram
    participant Desktop as Desktop App
    participant KC as Keychain / Cred Manager
    participant Convex as Convex Backend
    participant Web as Next.js Web App
    participant Phone as User's Phone Browser

    Note over Desktop: First-time workspace setup
    Desktop->>Desktop: Generate 12-word BIP39 mnemonic
    Desktop->>Desktop: workspaceId = "ws_" + base32(SHA256("daylens-workspace-v1:" + mnemonic))[0:26]
    Desktop->>Convex: POST /createWorkspace {recoveryKeyHash, deviceId, platform}
    Convex-->>Desktop: {sessionToken} (ES256 JWT, 365-day)
    Desktop->>KC: Store mnemonic, sessionToken, workspaceId, deviceId

    Note over Desktop: Generate link code for web pairing
    Desktop->>Desktop: linkToken = 32 random hex chars (128 bits)
    Desktop->>Convex: POST /createLinkCode {SHA256(linkToken), displayCode}
    Desktop->>Desktop: Show QR: https://daylens-web.vercel.app/link?token=<linkToken>

    Note over Phone: User scans QR or pastes code
    Phone->>Web: GET /link?token=<linkToken>
    Web->>Web: useSearchParams() extracts token
    Web->>Convex: POST /api/link → redeemAndIssueSession(SHA256(token))
    Convex->>Convex: Verify hash match, check expiry (<5 min), check attempts (<5)
    Convex-->>Web: {sessionToken} (ES256 JWT, 30-day)
    Web->>Phone: Set-Cookie: daylens_session (HttpOnly, Secure, SameSite=Strict)
    Phone->>Web: Redirect to /dashboard

    Note over Desktop: Ongoing sync (every 5 minutes)
    loop Every 5 minutes (and on quit)
        Desktop->>Desktop: SnapshotExporter.exportSnapshot(for: today)
        Desktop->>Convex: POST /uploadSnapshot {localDate, snapshot} (Bearer JWT)
        Convex->>Convex: Validate device, upsert day_snapshots
    end

    Note over Phone: Dashboard auto-refresh
    loop Every 30 seconds (Poller component)
        Web->>Convex: query snapshots.getByDate(localDate)
        Convex->>Convex: Merge multi-device snapshots
        Convex-->>Web: Merged DaySnapshot
        Web->>Phone: Re-render dashboard
    end
```

### DaySnapshot v1 contract

Every sync upload sends this JSON structure:

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | `1` | Locked — never changes without new version |
| `deviceId` | UUID | Source device identifier |
| `platform` | `"macos"` / `"windows"` | Source platform |
| `date` | `"2026-03-22"` | Local calendar date |
| `generatedAt` | ISO8601 | When this snapshot was built |
| `isPartialDay` | boolean | True if day is still in progress |
| `focusScore` | `0–100` | Integer percentage |
| `focusSeconds` | int | Total focused time in seconds |
| `appSummaries` | array | Per-app: `{appKey, bundleID, displayName, category, totalSeconds, sessionCount}` |
| `categoryTotals` | array | Per-category: `{category, totalSeconds}` |
| `timeline` | array | Ordered: `{appKey, startAt, endAt}` |
| `topDomains` | array | Per-domain: `{domain, seconds, category}` |
| `categoryOverrides` | map | User-corrected: `{bundleID: category}` |
| `aiSummary` | string? | AI-generated day narrative |
| `focusSessions` | array | `{sourceId, startAt, endAt, actualDurationSec, targetMinutes, status}` |

### Multi-device snapshot merging

When the web dashboard queries a date with data from multiple devices (e.g., macOS + Windows):

1. Load all `day_snapshots` for (workspaceId, localDate)
2. For each device's snapshot:
   - Sum `appSummaries` by `appKey` (accumulate totalSeconds, sessionCount)
   - Sum `categoryTotals` by category
   - Concatenate + sort timelines by `startAt`
   - Combine focus sessions (prefix sourceId with deviceId)
   - Merge `categoryOverrides` (latest wins)
   - Keep latest `aiSummary`
3. Recompute `focusScore` from merged data
4. Return merged snapshot + per-device metadata

### Link code security

| Property | Value |
|----------|-------|
| Token length | 32-char hex (128 bits entropy) |
| Server stores | SHA256(token) only — never plaintext |
| Expiry | 5 minutes |
| Rate limiting | 3 failures → 1 min lock, 5 failures → 10 min lock |
| Cleanup | Expired codes deleted when new code is created |

---

## 6. Focus Score

Both platforms use the same formula:

```
score = focusRatio × (1 - switchPenalty)

where:
  focusRatio    = (focusedTime + websiteFocusCredit) / totalTime
  switchRate    = sessionCount / max(totalTime / 3600, 0.1)
  switchPenalty = min(switchRate / 300, 0.15)    ← max 15% penalty
```

### Category classification

| Category | Focused? | Color (dark) |
|----------|----------|-------------|
| development | Yes | `#b4c5ff` |
| research | Yes | `#c084fc` |
| writing | Yes | `#93c5fd` |
| aiTools | Yes | `#e879f9` |
| design | Yes | `#f472b6` |
| productivity | Yes | `#6ee7b7` |
| communication | No | `#4fdbc8` |
| email | No | `#67e8f9` |
| browsing | No | `#fb923c` |
| meetings | No | `#ffb95f` |
| entertainment | No | `#f87171` |
| social | No | `#a78bfa` |
| system | No | `#94a3b8` |
| uncategorized | No | `#64748b` |

Category overrides (user-assigned) take priority over auto-classification in **all** query paths: live UI, persisted summaries, snapshot exports, and AI context.

---

## 7. Web Application Architecture

The web app is a **read-only companion** — it never tracks activity itself. It reads snapshot data uploaded by desktop apps via Convex.

### Route map

```mermaid
graph TD
    subgraph Public["Public Routes (no auth)"]
        LANDING["/ — Landing page<br/>Hero + Web Companion marketing"]
        LINK["/link — Device linking<br/>QR scanner + manual token"]
        RECOVER["/recover — Recovery<br/>12-word mnemonic entry"]
    end

    subgraph Protected["Protected Routes (JWT cookie required)"]
        DASH["/dashboard — Today's data<br/>Focus score, top apps, timeline"]
        HIST["/history — Past days<br/>List of synced days with scores"]
        APPS["/apps/[date] — Day detail<br/>All apps, categories, domains"]
        FOCUS["/focus/[date] — Focus sessions<br/>Timer history for a day"]
        CHAT["/chat — AI Chat<br/>Claude-powered Q&A about activity"]
        SETTINGS["/settings — Account<br/>Devices, export, disconnect"]
    end

    subgraph API["API Routes"]
        API_LINK["POST /api/link<br/>Redeem link token"]
        API_RECOVER["POST /api/recover<br/>Restore workspace"]
        API_CHAT["POST /api/chat<br/>AI question → Convex → Claude"]
        API_SAVE["POST /api/chat/save<br/>Persist chat history"]
        API_LOGOUT["POST /api/logout<br/>Clear session cookie"]
        API_DL_MAC["GET /api/download/mac<br/>→ GitHub Releases DMG"]
        API_DL_WIN["GET /api/download/windows<br/>→ GitHub Releases EXE"]
        API_DISCONNECT["POST /api/devices/disconnect<br/>Unlink a device"]
    end

    LANDING --> LINK
    LINK --> API_LINK --> DASH
    RECOVER --> API_RECOVER --> DASH
    DASH --> HIST --> APPS --> FOCUS
    DASH --> CHAT --> API_CHAT
    SETTINGS --> API_LOGOUT --> LANDING
```

### Middleware auth flow

```mermaid
flowchart TD
    REQ["Incoming Request"] --> CHECK{"Is path public?<br/>/, /link, /recover,<br/>/api/link, /api/recover,<br/>/api/download/*"}
    CHECK -- Yes --> PASS["Pass through"]
    CHECK -- No --> COOKIE{"Has daylens_session<br/>cookie?"}
    COOKIE -- No --> REDIRECT["Redirect to /"]
    COOKIE -- Yes --> VERIFY{"JWT valid?<br/>ES256 signature,<br/>expiry, sessionKind=web"}
    VERIFY -- No --> REDIRECT
    VERIFY -- Yes --> PASS
```

### AI chat data flow

```mermaid
sequenceDiagram
    participant User as User (Browser)
    participant Next as Next.js API Route
    participant Convex as Convex Action
    participant Claude as Claude API (Sonnet 4)

    User->>Next: POST /api/chat {messages: [...]}
    Note over Next: Extract last user message as question<br/>Use today's date
    Next->>Convex: api.ai.askQuestion({question, date})
    Convex->>Convex: Load snapshot for date
    Convex->>Convex: Load + decrypt API key (AES-256-GCM)
    Convex->>Convex: Build activity context from snapshot
    Convex->>Claude: messages.create({system, user prompt + context})
    Claude-->>Convex: Response text
    Convex->>Convex: Persist to web_chats table
    Convex-->>Next: {response: "..."}
    Next-->>User: {response: "..."}
```

### API key encryption

```mermaid
flowchart LR
    DESKTOP["Desktop App<br/>User enters API key"] --> UPLOAD["POST /storeApiKey<br/>Plaintext over HTTPS"]
    UPLOAD --> HKDF["HKDF-SHA256<br/>key = derive(CONVEX_ENCRYPTION_SECRET, workspaceId)"]
    HKDF --> AES["AES-256-GCM<br/>encrypt(plaintext, derived_key)"]
    AES --> STORE["encrypted_keys table<br/>v2:{iv}:{authTag}:{ciphertext}"]
    STORE --> DECRYPT["ai.askQuestion action<br/>decrypt with same derived key"]
    DECRYPT --> CLAUDE["Pass to Claude API"]
```

---

## 8. Analytics (PostHog)

Single PostHog project shared across web and Windows. **macOS has no analytics.**

### Configuration

| Platform | Package | Version | Init |
|----------|---------|---------|------|
| Web | `posthog-js` | 1.363.1 | `providers.tsx` — `capture_pageview: true, capture_pageleave: true` |
| Windows | `posthog-node` | 5.28.5 | `analytics.ts` — `flushInterval: 30_000`, IPC bridge from renderer |
| macOS | — | — | Not integrated |

**Project**: `phc_d0IcV73kr5HKVVY3UGGdUf9Meq1sKE3dJxcVq9ZjkCW`
**Host**: `https://us.i.posthog.com`

### Event catalog

#### Web events

| Event | Location | Properties |
|-------|----------|-----------|
| `link_pairing_started` | `link/page.tsx` | — |
| `link_pairing_completed` | `link/page.tsx` | — |
| `download_clicked` | `DownloadButtons.tsx` | `platform: 'mac' \| 'windows'` |
| Page views | Auto-captured | Standard browser props |
| Page leaves | Auto-captured | Standard browser props |

#### Windows events

| Event | Location | Properties |
|-------|----------|-----------|
| `app_launched` | `index.ts` | `version`, `platform`, `os_version`, `onboarding_complete` |
| `tracking_engine_status` | `index.ts` | `status`, `module_source`, `error_message?` |
| `update_available` | `updater.ts` | `version` |
| `update_downloaded` | `updater.ts` | `version` |
| `update_error` | `updater.ts` | `error_message` |
| `crash` | `index.ts` | `error_name`, `error_message`, `stack` |
| `onboarding_step_completed` | `Onboarding.tsx` | `step: 1 \| 2`, `goals?` |
| `onboarding_completed` | `Onboarding.tsx` | `goals`, `api_key_entered` |
| `api_key_saved` | `Onboarding.tsx`, `Settings.tsx` | — |
| `insight_generated` | `Insights.tsx` | `message_length` |
| `focus_session_started` | `Focus.tsx` | — |
| `focus_session_ended` | `Focus.tsx` | `duration_seconds`, `completed: true` |
| `feedback_submitted` | `FeedbackModal.tsx` | `score` (1-10), `comment?` |
| `view_opened` | `App.tsx` | `view` |

### Privacy

- **Anonymous**: UUID-only identification (generated on first launch, stored in electron-store)
- **No PII**: No names, emails, or API keys sent
- **No opt-out**: No consent mechanism currently implemented
- **Errors silenced**: Analytics failures never crash the app

### Windows IPC bridge

```
Renderer → ipcRenderer.send('analytics:capture', event, props)
    → ipcMain.on('analytics:capture') → posthog.capture()
```

All network calls happen in the main process — renderer never touches PostHog directly.

---

## 9. Brand & Design System

### Design theme: "Chromatic Sanctuary"

Deep navy dark mode with electric blue accent. Full light/dark mode support via system preference detection.

### Color palette

#### Primary

| Token | Light | Dark |
|-------|-------|------|
| Primary | `#2563eb` | `#b4c5ff` |
| Accent (bright) | `#68AEFF` | `#68AEFF` |
| Primary Container | `#2563eb` | `#2563eb` |
| On Primary | `#ffffff` | `#051425` |

#### Surfaces (dark mode)

| Token | Hex |
|-------|-----|
| Surface Lowest | `#010f20` |
| Surface | `#051425` |
| Surface Low | `#0d1c2e` |
| Surface High | `#1d2b3d` |
| Surface Highest | `#283648` |
| Surface Bright | `#2c3a4d` |

#### Surfaces (light mode)

| Token | Hex |
|-------|-----|
| Surface Lowest | `#eef2fb` |
| Surface | `#f3f6fd` |
| Surface Container | `#e8eef8` |
| Surface Card | `#ffffff` |
| Surface High | `#dde5f5` |

#### Text

| Token | Light | Dark |
|-------|-------|------|
| On Surface | `#0d1f38` | `#c8dcf4` |
| On Surface Variant | `#4a6180` | `#5e7a92` |

#### Semantic

| Token | Light | Dark |
|-------|-------|------|
| Secondary (amber) | `#d97706` | `#ffb95f` |
| Tertiary (teal) | `#0d9488` | `#4fdbc8` |
| Error | `#b91c1c` | `#f87171` |
| Success | — | `#34d399` |
| Warning | — | `#fbbf24` |

### CTA gradient

```css
background: linear-gradient(180deg, #68AEFF 0%, #003EB7 100%);
```

### Typography

| Context | macOS (SwiftUI) | Web (Tailwind/CSS) |
|---------|-----------------|-------------------|
| System font | SF Pro Display / SF Pro Text | Inter, system-ui, sans-serif |
| Monospace | — | JetBrains Mono |
| Nav labels | `.body` (13pt) | `text-sm` (14px) |
| Body text | 13–14pt minimum | 14px |
| Section headers | 10pt uppercase, tracked | 10px uppercase, `letter-spacing: 0.08em` |
| Tiny badges | 9–10pt | `0.625rem` (10px) |
| Hero headline | — | `clamp(2rem, 5vw, 3.5rem)` |

### Spacing (8pt grid)

```
2px → 4px → 6px → 8px → 10px → 12px → 14px → 16px → 18px → 20px → 24px → 28px → 32px → 40px → 48px
```

### Border radius

| Token | Value |
|-------|-------|
| Small | 4px |
| Medium | 8px |
| Large | 12px |
| XL | 16px |
| Full (pill) | 999px |

### Component patterns

| Component | Style |
|-----------|-------|
| Cards | `p-4 sm:p-6`, `rounded-2xl`, `bg-surface-low`, soft shadow (0.07 opacity) |
| Buttons (primary) | Gradient fill, `rounded-xl`, `font-semibold`, 200ms transitions |
| Section headers | 10pt uppercase, tracked, `DS.onSurfaceVariant` color |
| Glass effect | `rgba(13, 28, 46, 0.7)` background, `blur(16px)` backdrop |
| Focus glow | `box-shadow: 0 0 8px 2px rgba(180, 197, 255, 0.3)` |

### App icons

| Platform | Path | Sizes |
|----------|------|-------|
| macOS | `Daylens/Resources/Assets.xcassets/AppIcon.appiconset/` | 16–1024px + @2x |
| Windows | `daylens-windows/build/` | `icon.png`, `icon.icns`, `icon.ico` |
| Web | `daylens-web/public/` | `app-icon.png`, `icon-192.svg`, `icon-512.svg` |

---

## 10. Key URLs

| Resource | URL |
|----------|-----|
| Web Dashboard | https://daylens-web.vercel.app |
| Landing Page | https://daylens-web.vercel.app |
| Convex Site API | https://decisive-aardvark-847.convex.site |
| Convex Cloud | https://decisive-aardvark-847.convex.cloud |
| macOS Releases | https://github.com/irachrist1/daylens/releases |
| Windows Releases | https://github.com/irachrist1/daylens-windows/releases |
| PostHog Dashboard | https://us.i.posthog.com (project: phc_d0IcV73kr5HKVVY3UGGdUf9Meq1sKE3dJxcVq9ZjkCW) |

---

## 11. Release & CI

### macOS

Workflow: `.github/workflows/release.yml` — triggered on `v*` tag push to `main`

```
Tag push → checkout → Xcode 16.2 → xcodegen + build → create-dmg → extract CHANGELOG → GitHub Release
```

Artifacts: `Daylens-{version}.dmg` + `.sha256`

### Windows

Workflow: `release-windows.yml` — triggered on `v*-win` tag

Artifacts: `Daylens-Setup-{version}.exe`

### Web

Auto-deploy on push to `main` via Vercel. No manual CI step.
