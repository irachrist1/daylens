#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/run-macos-capture-smoke.sh <Daylens.app>" >&2
  exit 1
fi

: "${DAYLENS_SMOKE_REPORT_PATH:?DAYLENS_SMOKE_REPORT_PATH is required}"
: "${DAYLENS_SMOKE_WINDOW_STATE_PATH:?DAYLENS_SMOKE_WINDOW_STATE_PATH is required}"
: "${DAYLENS_SMOKE_EXPECT_FOREGROUND_TITLE:?DAYLENS_SMOKE_EXPECT_FOREGROUND_TITLE is required}"
: "${DAYLENS_SMOKE_EXPECT_FULLSCREEN_TITLE:?DAYLENS_SMOKE_EXPECT_FULLSCREEN_TITLE is required}"

app_bundle="$1"
app_binary="$app_bundle/Contents/MacOS/Daylens"
probe_dir="$(mktemp -d)"
app_pid=''

cleanup() {
  [ -z "$app_pid" ] || kill "$app_pid" 2>/dev/null || true
  rm -rf "$probe_dir"
}
trap cleanup EXIT

swiftc scripts/runtime-smoke-window.swift -o "$probe_dir/ForegroundCaptureProbe" -framework AppKit -framework CoreGraphics
cp "$probe_dir/ForegroundCaptureProbe" "$probe_dir/FullscreenCaptureProbe"

"$app_binary" &
app_pid=$!
sleep 15

"$probe_dir/ForegroundCaptureProbe" \
  "$DAYLENS_SMOKE_EXPECT_FOREGROUND_TITLE" foreground 30 "$DAYLENS_SMOKE_WINDOW_STATE_PATH"
"$probe_dir/FullscreenCaptureProbe" \
  "$DAYLENS_SMOKE_EXPECT_FULLSCREEN_TITLE" fullscreen 30 "$DAYLENS_SMOKE_WINDOW_STATE_PATH"

open "$app_bundle"
wait "$app_pid"
app_pid=''
trap - EXIT
rm -rf "$probe_dir"
