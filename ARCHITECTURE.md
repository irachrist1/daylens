# Daylens Web — Architecture

> The web companion for Daylens. A read-only dashboard that displays activity data synced from the desktop app (macOS, Windows, or Linux).

## How the System Works

Daylens currently spans a unified desktop repo plus a small set of companion or archival repos:

| Repo | Purpose | Tech |
|------|---------|------|
| `daylens` | Unified cross-platform desktop app (macOS + Windows + Linux) | Electron / React / Vite / TypeScript |
| `daylens-web` | Web dashboard, marketing/docs site, and Convex backend | Next.js / Convex |
| `daylens-linux` | Public MIT transition repo; points contributors back to `daylens` | — |
| `daylens-swiftUI` | Legacy macOS SwiftUI prototype (archived, non-shipping) | Swift / SwiftUI |

**The web app cannot work alone.** It only displays data that the desktop app collects and syncs.

---

## Status vs. `daylens` desktop

This doc describes the web companion only. The desktop app's current implementation
status, platform validation state, and open gaps live in the unified repo's
`docs/ISSUES.md`. When this doc and that one disagree, `docs/ISSUES.md` wins for
desktop behavior and this one wins for web behavior.

---

## Data Flow

```
┌──────────────────────────────────┐
│ Desktop App (macOS/Windows/Linux)│
│                                  │
│  1. Tracks app/browser usage     │
│  2. Stores data locally (SQLite) │
│  3. Every 5 min: syncs to Convex │
└──────────┬───────────────────────┘
           │  POST /uploadSnapshot
           │  Authorization: Bearer <session JWT>
           ▼
┌──────────────────────────────────┐
│  Convex Backend (cloud)          │
│                                  │
│  • Validates JWT session token   │
│  • Stores day_snapshots          │
│  • Manages workspaces & devices  │
│  • Issues session tokens         │
└──────────┬───────────────────────┘
           │  Convex queries
           ▼
┌──────────────────────────────────┐
│  Web Dashboard (Next.js)         │
│                                  │
│  • Reads snapshots from Convex   │
│  • Renders date-driven scores,   │
│    top apps, top sites, and AI   │
│  • Read-only — never writes data │
└──────────────────────────────────┘
```

---

## Authentication Flow

### 1. First-time setup (desktop → Convex)

```
Desktop App                          Convex Backend
    │                                     │
    │  1. Generate BIP39 mnemonic         │
    │  2. Derive workspace ID             │
    │  3. SHA256 → recoveryKeyHash        │
    │                                     │
    │── POST /createWorkspace ───────────►│
    │   { recoveryKeyHash, deviceId }     │
    │                                     │
    │◄── { workspaceId, sessionToken } ───│
    │                                     │
    │  4. Store sessionToken in keychain  │
    │  5. Generate link code (32 hex)     │
    │  6. SHA256 → tokenHash              │
    │                                     │
    │── POST /createLinkCode ────────────►│
    │   Authorization: Bearer <JWT>       │
    │   { tokenHash, displayCode }        │
    │                                     │
    │  7. Show QR code + link token to    │
    │     the user                        │
```

### 2. Linking a browser (web → Convex)

```
Web Browser                          Next.js API          Convex
    │                                    │                   │
    │  User scans QR / pastes token      │                   │
    │                                    │                   │
    │── POST /api/link ─────────────────►│                   │
    │   { token: "abc123..." }           │                   │
    │                                    │── redeemAndIssue──►│
    │                                    │   { token, ... }   │
    │                                    │                    │
    │                                    │◄── { JWT } ────────│
    │                                    │                    │
    │◄── Set-Cookie: daylens_session ────│                    │
    │                                    │                    │
    │  Redirect to /dashboard            │                    │
```

### 3. Session tokens (ES256 JWT)

- **Algorithm**: ES256 (ECDSA with P-256 curve)
- **Private key**: Stored as Convex environment variable `DAYLENS_SESSION_JWT_PRIVATE_JWK`
- **Public key**: Hardcoded in `convex/sessionPublicJwks.ts` — Convex uses this to verify JWTs
- **Claims**: `workspaceId`, `deviceId`, `sessionKind` ("desktop" or "web"), `exp`
- **Lifetime**: Desktop sessions = 365 days, Web sessions = 30 days

---

## Key Files

### Convex Backend (`convex/`)

| File | Purpose |
|------|---------|
| `schema.ts` | Database schema — workspaces, devices, link_codes, day_snapshots, encrypted_keys, web_chats |
| `http.ts` | HTTP endpoints — `/uploadSnapshot`, `/createWorkspace`, `/recoverWorkspace`, `/createLinkCode`, `/storeApiKey` |
| `snapshotValidator.ts` | Convex validator for the synced `DaySnapshot` contract |
| `sessionTokens.ts` | JWT issuance (signs with ES256 private key) |
| `sessionPublicJwks.ts` | Public key for JWT verification (ES256) |
| `linkCodes.ts` | Link code creation + redemption logic |
| `snapshots.ts` | Snapshot storage + queries |
| `devices.ts` | Device registration + sync tracking |
| `workspaces.ts` | Workspace creation + recovery |
| `ai.ts` | AI chat action (calls Claude API with activity context) |
| `packages/snapshot-schema/snapshot.ts` | Shared snapshot contract used by upload, storage, and rendering |

### Next.js Frontend (`app/`)

| File | Purpose |
|------|---------|
| `page.tsx` | Landing page — QR scanner, token paste, connect flow |
| `(app)/dashboard/DashboardClient.tsx` | Main dashboard (client component) — selected-date navigation, focus scores, recap headline, work blocks, and supporting app/site evidence |
| `(app)/history/HistoryClient.tsx` | History browser (client component) — synced-day list plus selected-day detail with recap/work-block-aware snapshot rendering |
| `(app)/chat/page.tsx` | AI chat page — renders GlobalChat |
| `(app)/recap/RecapClient.tsx` | Dedicated recap route for synced day/week/month recap payloads plus workstream/entity/artifact rollups |
| `(app)/apps/[date]/page.tsx` | Day detail — app usage, categories, top sites, AI summary |
| `(app)/settings/page.tsx` | Settings — AI API key, disconnect |
| `api/chat/route.ts` | POST endpoint — AI chat (accepts both `{messages}` and `{question,date}` formats) |
| `api/link/route.ts` | POST endpoint — redeems link token, sets session cookie |
| `api/recover/route.ts` | POST endpoint — recovers workspace from mnemonic |
| `api/snapshots/route.ts` | GET endpoint — fetch snapshots by date or list all |
| `middleware.ts` | Auth guard — checks `daylens_session` cookie on protected routes |
| `lib/session.ts` | Cookie helpers — set/get/clear session |
| `lib/convex.ts` | Server-side Convex client |
| `components/GlobalChat.tsx` | Chat UI — message bubbles, auto-scroll, debounced save, and selected-date context |
| `components/AppIcon.tsx` | App icon renderer — prefers embedded `iconBase64` payloads from snapshots |
| `components/TopSitesList.tsx` | Shared expandable top-sites accordion with per-page drilldown |
| `components/SyncBanner.tsx` | Banner showing sync status |
| `recover/page.tsx` | Recovery page — enter mnemonic to restore access |

### Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `CONVEX_DEPLOYMENT` | `.env.local` | Convex deployment name (e.g., `dev:decisive-aardvark-847`) |
| `NEXT_PUBLIC_CONVEX_URL` | `.env.local` | Convex cloud URL for client queries |
| `DAYLENS_SESSION_JWT_PRIVATE_JWK` | Convex env | ES256 private key (JWK format) for signing session JWTs |

---

## Database Schema

> Snapshot schema v1 is documented below and is what the web renders today.
> Snapshot v2 is in design. See `.intent/web.md` in the unified `daylens` repo
> for the proposed contract, and update this doc when v2 lands.

```
workspaces
  _id: Id
  createdAt: number
  recoveryKeyHash: string          ← SHA256 of derived workspace ID

devices
  _id: Id
  workspaceId: Id<workspaces>
  deviceId: string                 ← UUID generated on each device
  platform: "macos" | "windows" | "linux" | "web"
  displayName: string
  lastSyncAt: number
  index: by_workspace

link_codes
  _id: Id
  workspaceId: Id<workspaces>
  tokenHash: string                ← SHA256 of the 32-char hex token
  displayCode: string              ← First 8 chars (shown for visual ID)
  expiresAt: number                ← 5-minute TTL
  failedAttempts: number
  index: by_display_code, by_workspace

day_snapshots
  _id: Id
  workspaceId: Id<workspaces>
  deviceId: string
  localDate: string                ← "2026-03-21"
  snapshot: DaySnapshot v1 or v2   ← Validated snapshot payload (legacy app/site data plus v2 work blocks, recap, entities, and focus-score breakdown when available)
  syncedAt: number
  index: by_workspace_date

encrypted_keys
  _id: Id
  workspaceId: Id<workspaces>
  encryptedAnthropicKey: string    ← User's Claude API key for web AI

web_chats
  _id: Id
  workspaceId: Id<workspaces>
  messages: any
  updatedAt: number
  index: by_workspace
```

Linux platform support requires the Snapshot v1 validator to be widened; see
`.intent/web.md` Phase 1 in the unified `daylens` repo. Linux is architecturally
supported today but will still be rejected by the current Convex validator until
that phase ships.

---

## Deployment

### Web App (this repo)
- **Platform**: Vercel (Next.js requires a Node.js runtime — cannot use GitHub Pages)
- **Deploy**: `vercel --prod` or push to `main` with Vercel GitHub integration
- **Convex**: Already deployed at `decisive-aardvark-847.convex.cloud`

### Marketing Site
- **Platform**: Vercel (served from this Next.js repo alongside the dashboard/docs routes)
- **Source**: `daylens-web` repo → `app/` routes and shared marketing components
- **URL**: `https://getdaylens.vercel.app` (also `daylens-eight.vercel.app`)
- **Deploy**: `vercel --prod`

---

## Security

### Headers (next.config.ts)
- `Content-Security-Policy` — restricts scripts, styles, connections to self + Convex
- `X-Frame-Options: DENY` — prevents clickjacking
- `X-Content-Type-Options: nosniff` — prevents MIME sniffing
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — camera self-only, no mic/geo

### Authentication Security
- **Middleware**: JWT signatures are cryptographically verified using `jwtVerify` with the ES256 public key (not just decoded)
- **Session cookies**: `HttpOnly; Secure; SameSite=Strict` — never accessible to JavaScript, never sent cross-site
- **Internal queries**: `workspaces.get` is `internalQuery` — `recoveryKeyHash` is never exposed to clients
- **Link codes**: SHA256-hashed before storage, 5-minute TTL, max 5 failed attempts, deleted on redemption

### Known Limitations (tracked for follow-up)
- No rate limiting on `/recoverWorkspace` endpoint
- Snapshot payload accepted as `v.any()` with no size validation

---

## Important Concepts

### Link Token vs Recovery Phrase

| | Link Token | Recovery Phrase |
|---|---|---|
| **Format** | 32-character hex string | 12 BIP39 English words |
| **Purpose** | One-time code to connect a browser | Permanent backup to restore workspace |
| **Lifetime** | 5 minutes | Forever |
| **Security** | Hashed before sending to server | Never sent to server |
| **Where shown** | Desktop app Settings → Web Companion | Desktop app Settings → Web Companion |

### Workspace Identity
- A "workspace" is the unit of identity — one per user
- Created from a BIP39 mnemonic: `mnemonic → normalize → "daylens-workspace-v1:" + mnemonic → SHA256 → base32 → "ws_" + first 26 chars`
- The `recoveryKeyHash` stored on the server is `SHA256(workspaceId)` — the server never sees the mnemonic or workspace ID directly

---

## Development

```bash
# Install dependencies
npm install

# Start Convex dev server (in one terminal)
npx convex dev

# Start Next.js dev server (in another terminal)
npm run dev

# Open http://localhost:3000
```

To test the full flow, you need a desktop app running and syncing data. See the
unified `daylens` repo and its `docs/ISSUES.md` for the current cross-platform
desktop source of truth.
