#!/bin/sh
# Daylens installer for macOS
# Usage: curl -fsSL https://irachrist1.github.io/daylens/install.sh | sh
set -e

# ── Helpers ──────────────────────────────────────────────────────────────────
info()  { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
err()   { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }
clean() { [ -n "$DMG_PATH" ] && rm -f "$DMG_PATH" 2>/dev/null; [ -n "$MNT" ] && hdiutil detach "$MNT" -quiet 2>/dev/null; }
trap clean EXIT

# ── Platform check ───────────────────────────────────────────────────────────
[ "$(uname)" = "Darwin" ] || err "This installer is for macOS only."

MAJOR_VER=$(sw_vers -productVersion | cut -d. -f1)
[ "$MAJOR_VER" -ge 14 ] 2>/dev/null || err "Daylens requires macOS 14 Sonoma or later (you have $(sw_vers -productVersion))."

# ── Fetch latest version ─────────────────────────────────────────────────────
info "Checking latest release..."
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/irachrist1/daylens/releases/latest") \
  || err "Failed to fetch release info from GitHub."

VERSION=$(printf '%s' "$RELEASE_JSON" | grep '"tag_name"' | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/')
[ -n "$VERSION" ] || err "Could not determine latest version."
info "Latest version: $VERSION"

# ── Download DMG ─────────────────────────────────────────────────────────────
DMG_URL="https://github.com/irachrist1/daylens/releases/latest/download/Daylens-${VERSION}.dmg"
DMG_PATH="$(mktemp -d)/Daylens-${VERSION}.dmg"

info "Downloading Daylens-${VERSION}.dmg..."
curl -fSL --progress-bar "$DMG_URL" -o "$DMG_PATH" \
  || err "Download failed. Check https://github.com/irachrist1/daylens/releases for available assets."

# ── Mount ────────────────────────────────────────────────────────────────────
info "Mounting disk image..."
MNT=$(hdiutil attach -nobrowse -quiet "$DMG_PATH" 2>/dev/null | grep '/Volumes/' | sed 's/.*\(\/Volumes\/.*\)/\1/') \
  || err "Failed to mount DMG."
[ -d "$MNT" ] || err "Mount point not found."

# ── Install ──────────────────────────────────────────────────────────────────
APP="$MNT/Daylens.app"
[ -d "$APP" ] || err "Daylens.app not found in disk image."

info "Installing to /Applications..."
rm -rf /Applications/Daylens.app 2>/dev/null || true
cp -R "$APP" /Applications/ \
  || err "Failed to copy Daylens.app to /Applications. You may need to run with sudo."

# ── Strip quarantine ─────────────────────────────────────────────────────────
xattr -dr com.apple.quarantine /Applications/Daylens.app 2>/dev/null || true

# ── Eject ────────────────────────────────────────────────────────────────────
info "Cleaning up..."
hdiutil detach "$MNT" -quiet 2>/dev/null || true
MNT=""
rm -f "$DMG_PATH" 2>/dev/null || true
DMG_PATH=""

# ── Done ─────────────────────────────────────────────────────────────────────
printf '\n\033[1;32m✓\033[0m Daylens %s installed. Open it from your Applications folder.\n' "$VERSION"
