# Daylens — Keyboard Shortcuts And Quick Access

Last updated 2026-05-04. This file documents the keyboard surface that opens views, runs actions, and recovers from notifications.

## Command palette

The command palette is the primary fast path inside Daylens. It can navigate views, open Day Wrapped, start a focus session, search across timeline blocks/sessions/pages/artifacts, and trigger update checks.

| Trigger | Behavior |
|---|---|
| `⌘ ⌥ D` (macOS) / `Ctrl Alt D` (Windows + Linux) | Global shortcut. Opens Daylens (showing/focusing the window if hidden in tray) and toggles the palette. |
| `⌘ K` (macOS) / `Ctrl K` (Windows + Linux) | In-app shortcut. Toggles the palette while Daylens is focused. |
| `↑` / `↓` | Move highlight inside the palette. |
| `↵` | Run the highlighted action. |
| `esc` | Close the palette. |

Code references:

- Global shortcut registration: `src/main/services/commandPalette.ts`
- IPC bridge: `src/preload/index.ts` (`palette.onToggle`)
- Palette component and action registry: `src/renderer/components/CommandPalette.tsx`
- App-level wiring: `src/renderer/App.tsx`

The palette uses the existing search IPC (`search:all`) so live-typed queries return real timeline sessions, work blocks, browser pages, and saved artifacts. Search hits navigate to the right Timeline date or open the artifact.

## Notification click-through

Day Wrapped (evening recap) and Morning Brief notifications both open the dedicated DayWrapped screen for the correct date. The flow:

1. `src/main/services/dailySummaryNotifier.ts` schedules the notifications and binds both `click` and `action` events to `openDailySummaryRoute`.
2. `src/main/services/dailySummaryNavigation.ts` brings the app to the foreground (calling `app.focus({ steal: true })` on macOS so the dimmed dock icon resurrects), shows the window, restores it from minimised state, and forwards the route through `webContents.send('navigate', …)`.
3. `src/renderer/App.tsx` subscribes to `'navigate'` via `ipc.navigation.onNavigate` and routes through `handleDailySummaryNavigation` (`src/renderer/lib/dailySummaryNavigation.ts`), which fetches the timeline payload for the encoded date and opens the DayWrapped modal.

If a notification ever fails to click through (e.g. the OS dismissed it before the click reached us), the user can press the global shortcut `⌘ ⌥ D` and pick "Open yesterday's Day Wrapped" or "Open today's Day Wrapped" from the palette — there is always a keyboard recovery path.

Tests: `tests/notificationNavigation.test.ts` covers the route building, the renderer-side payload handler, and the show-before-navigate ordering on a hidden window.

## Dev shortcuts

These are kept intentionally awkward so they cannot fire by accident.

| Trigger | Behavior |
|---|---|
| `⌘ ⇧ ⌥ O` / `Ctrl Shift Alt O` | Reset onboarding state without touching tracked data. |
| `⌘ ⇧ ⌥ W` / `Ctrl Shift Alt W` | Open DayWrapped for yesterday with whatever real data exists. |
| `⌘ ⇧ ⌥ B` / `Ctrl Shift Alt B` | Fire a test Day Wrapped notification for today and exercise the click-through path. |

These live in `src/renderer/App.tsx` and only fire when the modifier set matches exactly.
