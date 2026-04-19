# Changelog

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
