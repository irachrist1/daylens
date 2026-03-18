# Performance and Privacy Notes

## Performance Design

### Background Overhead Strategy

Activity Analyst is designed to feel invisible while running. The capture layer uses an **event-driven architecture** that avoids expensive polling loops wherever possible.

| Subsystem | Strategy | Expected Impact |
|---|---|---|
| App monitoring | NSWorkspace notifications (zero-poll) | Negligible CPU; fires only on actual app switches |
| Window title monitoring | AX polling at 1.5s intervals | ~0.1% CPU; single AX attribute read per tick |
| Idle detection | IOKit HID idle time check at 5s intervals | Negligible; single sysctl read |
| Extension bridge | WebSocket server (passive listener) | Zero CPU when no browser is active; event-driven on message receipt |
| Event buffer | In-memory array, flushed every 2s or at 50 events | Minimal memory; bounded buffer size |
| Database writes | Batched SQLite inserts via GRDB | Efficient WAL-mode writes; no fsync per event |

### Memory Footprint

- **Target**: < 50 MB resident memory during normal operation
- **Database**: SQLite with WAL mode. Read queries do not block writes.
- **Event buffer**: Bounded at 50 events (~2 KB typical). Flushed regularly.
- **Dashboard**: SwiftUI lazy loading for lists and timelines. No preloading of full history.

### CPU Budget

- **Idle (no user activity)**: < 0.1% CPU. Only idle-check timer fires at 5s intervals.
- **Active tracking**: < 0.5% CPU. App switch notifications + window title polling at 1.5s.
- **Dashboard open**: < 1% CPU. SwiftUI rendering with standard macOS compositor.
- **AI analysis**: Async network request. UI never blocks. Progress indicator shown.

### Battery Considerations

- No wake-from-sleep polling
- Timer coalescing via GCD for all periodic checks
- NSWorkspace notifications are system-managed and battery-aware
- No GPU usage beyond standard SwiftUI rendering
- WebSocket server only accepts incoming connections; no outbound polling

### Dashboard Performance

- **Lazy loading**: Timeline and list views use `LazyVStack` for efficient rendering
- **Pagination**: Long history queries are date-bounded, never unbounded
- **Aggregation queries**: Pre-computed daily summaries avoid re-scanning raw events
- **Indexes**: SQLite indexes on `timestamp`, `appId`, and `isSignificant` columns

### Performance-Sensitive Code Paths

| Path | Constraint | Mitigation |
|---|---|---|
| Event buffer flush | Must not block UI thread | Runs on background actor via `ActivityStore` |
| Session normalization | O(n log n) on event count | Processes in batches; daily events rarely exceed 1000 |
| Daily summary build | Iterates all significant sessions for a day | Pre-aggregated; runs once per flush cycle |
| Database reads for dashboard | Must return in < 100ms | Indexed queries; bounded date ranges |
| AI API call | Network latency (1-5s typical) | Async with progress indicator; never blocks UI |

## Privacy Design

### Data Boundary Model

```
┌─────────────────────────────────────┐
│          User's Mac (Local)          │
│                                      │
│  Raw Events ──→ Sessions ──→ Summary │
│      │              │           │    │
│   SQLite DB     SQLite DB   SQLite   │
│  (encrypted)   (encrypted)  (enc.)   │
│                                      │
│  Only aggregated + redacted data ──────→  Anthropic API
│  leaves the device                    │   (HTTPS/TLS 1.3)
└─────────────────────────────────────┘
```

### What We Capture

| Data | Captured | Stored | Sent to AI |
|---|---|---|---|
| Frontmost app name | Yes | Yes | Yes (app name only) |
| App bundle ID | Yes | Yes | No |
| Window title | Yes (if AX permitted) | Yes (redacted) | No (by default) |
| Browser name | Yes | Yes | Yes |
| Website domain | Yes (via extension or heuristic) | Yes | Yes (domain only) |
| Full URL | Yes (extension only) | No (redacted to path only) | No |
| URL query parameters | Stripped | No | No |
| Page title | Yes (extension only) | Yes (non-private only) | No (by default) |
| Keystrokes | Never | Never | Never |
| Screen content | Never | Never | Never |
| Clipboard | Never | Never | Never |
| Camera/microphone | Never | Never | Never |
| Private browsing pages | Configurable | Coarse browser time only (default) | No |

### Redaction Pipeline

1. **URL Redaction**: Query parameters, fragments, and auth tokens stripped before storage
2. **Window Title Redaction**: Titles containing "password", "token", "secret", "api_key", or "auth" are replaced with `[Redacted]`
3. **Private Browsing**: By default, only coarse browser usage time is stored. No URLs, page titles, or domains.
4. **AI Preparation**: Before sending to Anthropic API, data is further reduced to aggregated durations and domain names only. No full URLs, no window titles, no raw event streams.

### Permission Justification

| Permission | Why Required | What Happens Without It |
|---|---|---|
| Accessibility | Detect frontmost window for accurate app tracking | App tracking still works via NSWorkspace; window titles unavailable |
| Screen Recording | (Optional) Read window titles for non-AX-accessible apps | Fallback to AX-accessible apps only |
| Automation | (Optional) Query browser tab URLs when extension unavailable | Fallback to window title heuristics |

### Data Retention

- **Raw events**: Pruned after retention period (default 90 days)
- **Sessions**: Pruned with raw events
- **Daily summaries**: Retained longer (summaries are lightweight)
- **AI conversations**: Retained until user deletes
- **User can override**: 30, 90, 180, 365 days, or forever

### User Rights

- **Export**: Full JSON export of all stored data
- **Delete**: Complete data deletion with confirmation
- **Pause**: Tracking can be paused at any time from menu bar or settings
- **Transparency**: Settings page shows exactly what permissions are active and what data is being captured

### Security

- **Storage**: SQLite database in Application Support directory with standard macOS file permissions
- **Transport**: All AI API calls use HTTPS with TLS 1.3
- **API key**: Stored in macOS Keychain (not in UserDefaults or plain files)
- **Debug logging**: Never logs personal data, URLs, or window titles in release builds
