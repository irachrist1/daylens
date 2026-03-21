#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PATH="$ROOT_DIR/Daylens.xcodeproj"
SCHEME="Daylens"
BUILD_DIR="$ROOT_DIR/.build/release"
DIST_DIR="$ROOT_DIR/dist"
EXPORT_DIR="$BUILD_DIR/export"
ARCHIVE_PATH="$BUILD_DIR/Daylens.xcarchive"
VERSION_INPUT="${1:-}"

if [[ -z "$VERSION_INPUT" ]]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 1.0.0"
  exit 1
fi

VERSION="${VERSION_INPUT#v}"
DMG_NAME="Daylens-$VERSION.dmg"
DMG_PATH="$DIST_DIR/$DMG_NAME"
SHA_PATH="$DIST_DIR/$DMG_NAME.sha256"
APP_NAME="Daylens.app"
EXPORTED_APP_PATH="$EXPORT_DIR/$APP_NAME"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command git
require_command xcodebuild
require_command xcodegen
require_command codesign
require_command shasum

CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current)"
WORKTREE_STATUS="$(git -C "$ROOT_DIR" status --porcelain -- . ':(exclude)daylens-windows/**')"

if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "Release builds must run from the main branch. Current branch: $CURRENT_BRANCH" >&2
  exit 1
fi

if [[ -n "$WORKTREE_STATUS" ]]; then
  echo "Working tree must be clean before running a release build." >&2
  exit 1
fi

rm -rf "$BUILD_DIR" "$DIST_DIR"
mkdir -p "$BUILD_DIR" "$DIST_DIR" "$EXPORT_DIR"

echo "==> Generating Xcode project"
xcodegen generate --spec "$ROOT_DIR/project.yml"

echo "==> Running test suite"
xcodebuild \
  test \
  -project "$PROJECT_PATH" \
  -scheme "$SCHEME" \
  -destination 'platform=macOS' \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO \
  MARKETING_VERSION="$VERSION"

echo "==> Creating release archive"
xcodebuild \
  archive \
  -project "$PROJECT_PATH" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=macOS' \
  -archivePath "$ARCHIVE_PATH" \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="-" \
  DEVELOPMENT_TEAM="" \
  OTHER_CODE_SIGN_FLAGS="--timestamp=none" \
  MARKETING_VERSION="$VERSION"

if [[ ! -d "$ARCHIVE_PATH/Products/Applications/$APP_NAME" ]]; then
  echo "Expected archived app not found at $ARCHIVE_PATH/Products/Applications/$APP_NAME" >&2
  exit 1
fi

echo "==> Exporting app bundle"
ditto "$ARCHIVE_PATH/Products/Applications/$APP_NAME" "$EXPORTED_APP_PATH"
codesign \
  --force \
  --deep \
  --sign - \
  --timestamp=none \
  "$EXPORTED_APP_PATH"

codesign --verify --deep --strict "$EXPORTED_APP_PATH"

echo "==> Packaging DMG"
if command -v create-dmg >/dev/null 2>&1; then
  rm -f "$DMG_PATH"
  create-dmg \
    --volname "Daylens" \
    --window-pos 200 120 \
    --window-size 680 420 \
    --icon-size 128 \
    --icon "$APP_NAME" 180 190 \
    --app-drop-link 500 190 \
    "$DMG_PATH" \
    "$EXPORT_DIR"
else
  require_command hdiutil
  STAGING_DIR="$(mktemp -d "$BUILD_DIR/dmg-staging.XXXXXX")"
  ditto "$EXPORTED_APP_PATH" "$STAGING_DIR/$APP_NAME"
  ln -s /Applications "$STAGING_DIR/Applications"
  hdiutil create \
    -volname "Daylens" \
    -srcfolder "$STAGING_DIR" \
    -ov \
    -format UDZO \
    "$DMG_PATH"
  rm -rf "$STAGING_DIR"
fi

echo "==> Writing checksum"
(
  cd "$DIST_DIR"
  shasum -a 256 "$DMG_NAME" > "$(basename "$SHA_PATH")"
)

echo
echo "Release artifacts:"
echo "  $DMG_PATH"
echo "  $SHA_PATH"
