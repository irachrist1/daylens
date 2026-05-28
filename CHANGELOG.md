# Changelog

All notable changes to the Daylens project are documented below.

## [v1.0.36] - 2026-05-28 (Hackathon Release)

### Added
- **macOS Swift Capture Probe**: Built a custom high-performance capture layer using native Swift integration for robust window and activity tracking.
- **Background Content Indexer**: Ingests and summarizes page content from learning and research platforms (Coursera, YouTube, arXiv, documentation) using Claude, storing enrichened topic summaries in SQLite.
- **Grounded Multi-Model AI Chat Engine**: Unified search tool use to query activity timeline and content summaries with exact timestamp citations.
- **Model Context Protocol (MCP) Server**: Full self-contained MCP server allowing external AI agents (Cursor, Claude Code, Claude Desktop) to leverage local activity context.
- **AI Error Handling**: Resilient load-retry path and narrative cache-scrubber for consistent user experience.

### Fixed
- **Windows Build Pipeline**: Restored Windows packaging support; installers compile successfully for all release platforms (macOS, Windows, Linux).
- **Navigation & Shortcuts**: Unified global command palette shortcut (`Cmd+Alt+D` / `Ctrl+Alt+D`) and in-app navigation.

## [v1.0.35] - 2026-04-30

- Timeline block splitting respects sustained context changes and caps long blocks.
- Apps detail focuses on what you used a tool for, not session counts.

## [v1.0.34] - 2026-04-29

- Day Wrapped and Morning Brief notifications open a slide-based recap.
- Onboarding flow simplified.

## [v1.0.33] - 2026-04-28

- Follow-up chip filtering hardened against grammar-word and stop-word leaks.
- Files tab refreshes after every completed turn.

## Earlier (v1.0.27 - v1.0.32)

- Shipped initial foreground app tracking, SQLite persistence, tray/menu controls, and the core AI chat surface.
