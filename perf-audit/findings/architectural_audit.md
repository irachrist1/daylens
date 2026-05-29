# Daylens Architectural & Design Audit

This document compiles a comprehensive, technically rigorous audit of the Daylens desktop application's architecture. It focuses on design anti-patterns, violations of clean coding standards, heavy/dense monolithic files, platform limitations, and known risks associated with the selected technology stack (Electron, React, Vite, SQLite via `better-sqlite3`).

---

## 1. Monolithic "God Files" & Single Responsibility Violations (SRP)

The codebase suffers from extreme file density. Core business logic, database queries, OS integration, and network requests are tightly coupled inside a few massive, multi-thousand-line modules.

### A. The `workBlocks.ts` Monolith
*   **Location**: `src/main/services/workBlocks.ts` (~146 KB, 3,926 lines)
*   **Anti-Pattern**: This file acts as the entire brain of the application's domain logic. It implements:
    1.  **Label Sanitization**: Stripping raw folder paths and executables (`sanitizeBlockLabel`).
    2.  **Activity Segmentation Heuristics**: Multi-layered algorithms (`IDLE_GAP_THRESHOLD_MS`, coalescing candidates, handling meeting thresholds, single-app streaks).
    3.  **Database CRUD Operations**: Queries and updates against `timeline_block_labels`, `timeline_block_members`, and `website_visits`.
    4.  **AI Background Scheduling**: Invoking label re-analysis jobs (`scheduleTimelineAIJobs`).
    5.  **Analytics and Diagnostics**: Computing distraction scores and day-tracked counters.
*   **Consequence**: **High Cognitive Load & Regression Risk.** Any minor change to timeline coalescing heuristics can break SQLite data writes or block AI jobs. It is virtually impossible to write isolated unit tests for this module because it requires mocking the entire SQLite database state, file-system utilities, and third-party libraries.

### B. The `iconResolver.ts` Monolith
*   **Location**: `src/main/services/iconResolver.ts` (~52 KB, 1,598 lines)
*   **Anti-Pattern**: This service combines a massive variety of heterogeneous responsibilities:
    1.  **Subprocess Management**: Spawns OS-level CLI binaries (macOS `mdfind` and `plutil`, Windows PowerShell scripts).
    2.  **HTML Regex Parsing**: Evaluates raw HTML with regex to extract favicon links (`iconHrefCandidatesFromHtml`).
    3.  **Image Binary Snipping**: Sniffs raw buffer headers to identify image encodings (PNG, ICO, JPEG, WEBP headers).
    4.  **Web Request Downloader**: Downloads web icons using native `fetch` with custom abort timers.
    5.  **Database Storage & Cache Manager**: Manages SQLite read/write cache events and in-memory caches.
*   **Consequence**: **Unstable Isolation Boundary.** Spawning OS shell tasks and making outbound web requests should never live adjacent to direct binary buffer sniffers and SQLite persistence logic. A stall in an external `fetch` or a PowerShell execution block can easily deadlock the entire caching service, locking icon rendering.

### C. The `tracking.ts` Monolith
*   **Location**: `src/main/services/tracking.ts` (~62 KB, 1,782 lines)
*   **Anti-Pattern**: Combines low-level operating system active-window hooking, Linux-specific `/proc` directory parsing, active Wayland compositor CLI polling, idle state monitors, active browser tab contexts, session flushing, and database inserts.
*   **Consequence**: Hard to maintain, OS-specific platform code is highly interleaved with platform-neutral timeline session-flushing calculations.

### **Architectural Refactoring Path**:
```
Monolithic Service (e.g., iconResolver.ts)
   │
   ├──► OS Extractors (Shell commands, Registry/Plist helpers)
   ├──► Network Favicon Fetcher (Async fetch & abort signals)
   ├──► Image Sniffer (Pure buffer utilities)
   └──► Icon Cache Repository (Handles DB CRUD only)
```

---

## 2. The "Synchronous Main Thread SQLite" Trap (better-sqlite3)

### The Problem
Daylens utilizes `better-sqlite3` (`src/main/services/database.ts`), which is a fully **synchronous** SQLite native Node.js wrapper. All queries, transactions, schema migrations, and deep table scans are executed directly on Electron's single-threaded **Main Process**.

### The Architectural Conflict
Node.js relies on a single-threaded event loop. Electron's Main Process is responsible for:
1.  Keeping the desktop application windows responsive.
2.  Handling operating system integration events (Tray, global shortcuts, power monitoring).
3.  Forwarding IPC events to and from the Renderer.

If a database scan or column repair (such as F1 `repairStoredIdentityColumns` or F2 `repairStoredAppIdentityObservations`) takes **2.5 seconds** to run synchronously at startup, the entire Electron Main Process freezes. It cannot handle OS window drag states, process hover inputs, or routing messages. The operating system flags the app as "Not Responding" (spinning pinwheel on macOS).

```
[UI Renderer] ◄──(IPC Blocked)──► [Electron Main Process] ◄──(Synchronous DB Block)──► [SQLite Engine]
                                      (Event Loop Frozen)
```

### Known Stack Limitations & Bugs
1.  **WAL Mode Sequential Bottleneck**: While SQLite's Write-Ahead Log (WAL) allows concurrent reads during active writes, both read and write commands in Daylens are sent via IPC to Node's single-thread main process. Thus, they are processed sequentially on a single thread anyway—negating a major benefit of WAL.
2.  **Native Add-on Compilation Mismatches**: Native binary modules like `better-sqlite3` must be compiled against the specific Electron Node ABI version (`@electron/rebuild`). Mismatches during automatic updates or manual builds frequently result in runtime crashes (`Error: The module 'better-sqlite3' was compiled against a different Node.js version`).

### **Architectural Refactoring Path**:
Offload the SQLite engine to an isolated **Electron Utility Process** (introduced in Electron 22) or a dedicated **Node.js Worker Thread** (`worker_threads`). Expose data access via asynchronous IPC message passing:
```
[Renderer Window]  ───(Async IPC)───► [Main Process Router] ───(Thread Message)───► [Worker Thread (SQLite)]
```

---

## 3. Absence of a Centralized Client-Side Cache (State Silos)

### The Problem
Data fetching on the frontend is managed at the individual component level. Components utilize `useProjectionResource.ts` as an isolated hook. When a component mounts, it initiates an IPC invoke (e.g. `getTimelineDay`). When it unmounts, the data is discarded.

### Architectural Anti-Patterns & Consequences:
1.  **Visual Layout Shifts (Flicker)**: The app heavily utilizes code splitting and lazy route loading (`App.tsx` React.lazy). Navigating between pages (e.g., from Timeline to Apps) unmounts the current view. Navigating back forces a completely fresh IPC round-trip to pull the same data, causing layout stutters and loader loops.
2.  **Redundant IPC Flooding**: There is **no cache-deduplication engine**. If three separate mounted components (e.g., sidebar widget, dashboard card, detail panel) query the same projection scope simultaneously, they spawn **three concurrent IPC requests**.
3.  **Unthrottled Broadcast Invalidation**: The projection bus (`invalidation.ts`) broadcasts scope changes (like `timeline`) directly to all windows. The React hook immediately responds by refetching. A sequence of rapid window-tracking flushes on the backend triggers a storm of back-to-back IPC invocations in the frontend.

### **Architectural Refactoring Path**:
Implement a unified caching layer (e.g., **TanStack Query / React Query** or a central **Zustand / Redux Store**). The store acts as the single source of truth, manages stale-while-revalidate states, survives route unmounts, and automatically deduplicates concurrent fetches.

---

## 4. IPC Controller Bleeding (Clean Architecture Violation)

### The Problem
The IPC layer (`src/main/ipc/*`) regularly implements core database operations, prepared statements, and business logic directly in its handlers instead of behaving as a thin transport controller.

### Architectural Code Critique (`src/main/ipc/db.handlers.ts`):
```typescript
// Line 130: Direct SQLite prepared statements inside DB handlers
function tableExists(db: ReturnType<typeof getDb>, tableName: string): boolean {
  const row = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).get(tableName) as { name: string } | undefined
  return Boolean(row)
}

// Line 138: Complex in-handler schema query logic
function getWorkMemorySettingsSummary(db: ReturnType<typeof getDb>): WorkMemorySettingsSummary {
  if (!tableExists(db, 'context_patterns')) { ... }
  const promoted = db.prepare(`...`).get() ...
```

### Why this is a Clean Architecture Violation:
- **Tight Coupling**: The IPC communication layer is directly bound to the database schema. If the database schema changes, the IPC handler file must be rewritten.
- **No Boundary Layers**: Controllers should only handle payload deserialization, input validation, execution delegation, and output serialization.

### **Architectural Refactoring Path**:
Adhere to a strict **Controller-Service-Repository** pattern. All SQLite prepared statements and query structures should be extracted into a dedicated **Repository Layer** (e.g., `src/main/db/repositories/*`). The IPC handler should be a thin wrapper:
```typescript
// Best Practice IPC Controller
ipcMain.handle(IPC.DB.GET_WORK_MEMORY_SUMMARY, async () => {
  return workMemoryService.getSettingsSummary();
});
```

---

## 5. Non-Sargable SQL Query Anti-Patterns

### The Problem
Multiple SQL queries throughout the application are written in ways that completely bypass SQLite's query planner and prevent the database from using its defined indexes.

### Code Critique A: Non-Sargable iMessage Scan
*   **Location**: `src/main/services/imessageCapture.ts:125`
*   **Unoptimized SQL**:
    ```sql
    WHERE m.date / 1000000000 > ?
    ```
*   **Reasoning**: Applying the division operator (`/ 1000000000`) directly to the indexed column `m.date` makes the WHERE clause **non-sargable (Search Argument Able)**. SQLite's query planner cannot perform an index scan/seek. Instead, it is forced to execute a sequential full-table scan on Apple's `message` table.
*   **Scale Trigger**: In an active macOS profile, `chat.db` can contain 100,000 to 500,000 rows. Running this synchronous sequential scan on startup or every 5-minute tick freezes the Main Process thread for seconds.

### Code Critique B: Sync Database Write-on-Read
*   **Location**: `src/main/core/query/projections.ts:205`
*   **Unoptimized Behavior**: In `getTimelineDayProjection`, opening a historical timeline page triggers block generation heuristics, immediately followed by `persistTimelineDay(db, dateStr, blocks)`.
*   **Reasoning**: Pure view projections should never run synchronous writes. If the SQLite file is write-locked (due to a concurrent browser history copy or AI background consolidation), a user trying to simply view a timeline day will see a frozen screen while the read query waits for the database write lock to clear.

---

## 6. Complete Architectural Critique Summary

| Architectural Area | Current Bad Practice | Consequence | Recommended Clean Architecture |
| :--- | :--- | :--- | :--- |
| **Database Threading** | Sync `better-sqlite3` on Electron Main Thread. | Heavy scans (F1, F2) freeze UI and window interactions, causing "Not Responding" OS warnings. | Defer database connection to an isolated **Utility Process** or **Worker Thread**. |
| **Separation of Concerns** | "God Files" (`workBlocks.ts`, `iconResolver.ts`) containing up to 4,000 lines of mixed code. | High regression risk, extremely difficult to write isolated unit tests or maintain features. | Subdivide into distinct layers: **Extractors** (OS), **Parsers** (Pure utilities), and **Repositories** (DB). |
| **State Caching** | Siloed, transient component-level data fetching via inline `useProjectionResource`. | Tab navigation triggers duplicate, heavy IPC requests; visual layout shifting (flickering load state). | Deploy a unified client-side state cache (**TanStack Query** or central **Zustand** store). |
| **IPC Layer Design** | Raw SQLite statement compilation and business calculations inside `db.handlers.ts`. | Code duplication, boundary leakage, and high coupling between UI protocols and SQLite tables. | Implement thin controllers that validate payloads and delegate immediately to **Domain Services**. |
| **Query Sargability** | Arithmetic manipulation on query columns (`m.date / 1000000000 > ?`). | SQLite planner index bypasses, causing sequential disk table scans on huge datasets. | Write sargable expressions (`m.date > ? * 1e9`), and cover lookup fields with proper indexes. |
| **IPC Payload Volume** | Structured Clone serialization of massive daily block arrays on date switches. | High serialization lag blocks Chrome's rendering thread, causing frame drops during page changes. | Transition to **Paginated / Delta-based IPC payloads** or lightweight summary projections. |
