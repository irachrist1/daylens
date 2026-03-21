# Web Companion — How It All Works

> This document explains how the Daylens Web Companion feature connects the macOS app, Windows app, and web dashboard. Read this before making changes to the sync/linking system.

## Overview

The Web Companion lets users view their Daylens activity data from any browser. The desktop app (macOS or Windows) does all the tracking — the web dashboard is read-only.

```
┌─────────────┐     sync every 5 min     ┌──────────────┐     queries     ┌───────────────┐
│  Desktop App │ ──────────────────────► │    Convex     │ ◄──────────── │  Web Dashboard │
│  (macOS/Win) │                         │   (Backend)   │               │   (Next.js)    │
└─────────────┘                          └──────────────┘               └───────────────┘
       │                                        ▲                              │
       │  Tracks apps, browsers, websites       │                              │
       │  Stores locally in SQLite              │  Stores snapshots            │
       │  Generates workspace + link codes      │  Validates JWTs              │  Displays timeline,
       │                                        │  Issues sessions             │  focus scores, AI
       └────────────────────────────────────────┘                              │
                                                                               │  Read-only — never
                                                                               │  writes activity data
                                                                               └──────────────────────
```

## Three Repos

| Repo | What It Does | Key Sync Files |
|------|-------------|----------------|
| **daylens** (this repo) | macOS app + marketing site | `Daylens/Services/WorkspaceLinker.swift`, `Daylens/Services/SyncUploader.swift`, `Daylens/Views/Settings/WebCompanionSection.swift` |
| **daylens-windows** | Windows app | `src/main/services/workspaceLinker.ts`, `src/main/services/syncUploader.ts`, `src/renderer/views/Settings.tsx` |
| **daylens-web** | Web dashboard + Convex backend | `convex/http.ts`, `convex/schema.ts`, `app/api/link/route.ts`, `middleware.ts` |

## The User Journey

### First Time Setup

1. User installs Daylens desktop app (macOS or Windows)
2. Opens Settings → Web Companion → clicks **"Connect to Web"**
3. Desktop app:
   - Generates a 12-word BIP39 recovery phrase
   - Derives a workspace ID from the phrase
   - Calls Convex `POST /createWorkspace` to register
   - Gets back a signed JWT session token
   - Generates a 32-char hex link token
   - Calls Convex `POST /createLinkCode` with the token hash
   - Shows a QR code and the link token to the user
4. User opens the web dashboard on any device
5. Scans the QR code (which encodes `https://<web-url>?token=<hex>`) or pastes the link token
6. Web app calls its own `POST /api/link` → Convex redeems the token → sets a session cookie
7. User sees their dashboard

### Ongoing Sync

- Desktop app syncs every 5 minutes via `POST /uploadSnapshot` with Bearer JWT auth
- The snapshot contains: app sessions, browser history, focus scores, categories, daily summary
- Web dashboard reads snapshots from Convex in real-time

### Connecting Another Browser

- In Settings → Web Companion, click **"Connect a Browser"**
- A new link token is generated (the workspace already exists)
- Same QR/paste flow as above

### Recovery

- If user reinstalls the desktop app, they can enter their 12-word recovery phrase
- Desktop calls `POST /recoverWorkspace` with `SHA256(deriveWorkspaceId(mnemonic))`
- Gets back a new session token linked to the same workspace

## Authentication

### JWT Session Tokens

- **Algorithm**: ES256 (ECDSA P-256)
- **Private key**: Stored as Convex env var `DAYLENS_SESSION_JWT_PRIVATE_JWK`
- **Public key**: Hardcoded in `daylens-web/convex/sessionPublicJwks.ts`
- **Claims**: `workspaceId`, `deviceId`, `sessionKind`, `exp`

### Where Credentials Are Stored

| Platform | Storage | Service Name |
|----------|---------|-------------|
| macOS | Keychain | `com.daylens.sync` |
| Windows | Windows Credential Manager (via keytar) | `DaylensWindows` |
| Web | HTTP-only cookie | `daylens_session` |

### What's Stored

| Key | Description |
|-----|-------------|
| `workspaceId` | Derived ID (e.g., `ws_abcdef...`) |
| `workspaceToken` | JWT session token for API auth |
| `deviceId` | UUID identifying this device |
| `recoveryMnemonic` | 12 BIP39 words (desktop only, never sent to server) |

## Convex Backend

**Deployment**: `decisive-aardvark-847`
**Site URL**: `https://decisive-aardvark-847.convex.site`
**Cloud URL**: `https://decisive-aardvark-847.convex.cloud`

### HTTP Endpoints (convex/http.ts)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /createWorkspace` | None | Register a new workspace |
| `POST /recoverWorkspace` | None | Recover workspace by recovery hash |
| `POST /createLinkCode` | Bearer JWT | Create a browser link code |
| `POST /uploadSnapshot` | Bearer JWT | Upload a day's activity data |
| `POST /storeApiKey` | Bearer JWT | Store encrypted Claude API key |

### Link Code Security

- Link tokens are 32-char random hex strings
- Only the SHA256 hash is sent to the server
- Tokens expire after 5 minutes
- Max 3 failed redemption attempts per code
- On redemption, the code is deleted

## Key Design Decisions

### Why not a username/password?

Daylens is privacy-first. No email, no account, no PII. The BIP39 mnemonic serves as both identity and backup — similar to how crypto wallets work.

### Why JWT instead of API keys?

JWTs carry the workspace ID and device ID as claims, so the backend can verify identity without a database lookup on every request. The Convex auth system natively supports JWT verification.

### Why Convex?

Convex provides real-time subscriptions out of the box. The web dashboard gets live updates when the desktop app syncs — no polling needed.

### Why can't the web app run on GitHub Pages?

It's a Next.js app with API routes (`/api/link`, `/api/recover`) and middleware (auth guard). These require a Node.js runtime. It must be deployed to Vercel or similar.

## Hardcoded URLs

These URLs appear in the codebase and need updating if you change deployments:

| URL | Where Used | Purpose |
|-----|-----------|---------|
| `https://decisive-aardvark-847.convex.site` | macOS `WebCompanionSection.swift`, Windows `workspaceLinker.ts` | Convex HTTP API |
| `https://decisive-aardvark-847.convex.cloud` | daylens-web `.env.local` | Convex client queries |
| `https://daylens-web.vercel.app` | macOS `WebCompanionSection.swift`, Windows `Settings.tsx` | QR code URL (placeholder — update to Vercel URL) |
| `https://irachrist1.github.io/daylens` | Marketing site, various links | Marketing/landing page |

## Making Changes

### If you change the Convex backend:
1. Update the schema in `daylens-web/convex/schema.ts`
2. Update HTTP endpoints in `daylens-web/convex/http.ts`
3. Run `npx convex dev` to apply changes
4. If you change the snapshot format, update `snapshotExporter` in both desktop apps

### If you change the auth system:
1. Generate a new ES256 key pair
2. Set private key as Convex env: `npx convex env set DAYLENS_SESSION_JWT_PRIVATE_JWK '...'`
3. Update public key in `daylens-web/convex/sessionPublicJwks.ts`
4. All existing sessions will be invalidated

### If you add a new platform:
1. Implement `WorkspaceLinker` equivalent (see macOS or Windows for reference)
2. Implement `SyncUploader` equivalent
3. Add the platform to the `devices.platform` union in the Convex schema
4. Add credential storage using the platform's secure keychain

### If you change the web dashboard URL:
1. Update `webDashboardUrl` in macOS `WebCompanionSection.swift`
2. Update the URL in Windows `Settings.tsx`
3. The QR code encodes this URL with the token as a query parameter
