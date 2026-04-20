# Changelog

## Unreleased

### Fixed
- Implemented pending verification: client-side API requests now respect the `/daylens` base path, restoring browser link and recovery flows and the authenticated dashboard/history/settings/chat fetches that were accidentally posting to the site root
- Implemented pending verification: the link and recovery pages now use readable light-theme text, prioritize manual code entry over QR scanning, and redirect accidental `/Daylens/...` visits to the supported lowercase `/daylens/...` routes

## v0.2.4 - 2026-04-19

### Added
- The public changelog sync now reads curated release notes from the unified desktop repo and can link each desktop surface to the matching GitHub release page

### Changed
- Changelog surface definitions now follow the unified Daylens desktop repo instead of the retired multi-repo macOS, Windows, and Linux split
- The website changelog now consumes curated entries for the web surface too, so public release notes stop drifting from shipped versions

### Fixed
- The changelog sync script no longer expects missing `CHANGELOG.md` files from obsolete repo paths

## v0.2.3 - 2026-04-19

### Changed
- Public status copy now follows the unified desktop truth instead of synthetic release filler
- Linux, recap, and provider-backed AI status notes now separate implemented work from pending validation more clearly
