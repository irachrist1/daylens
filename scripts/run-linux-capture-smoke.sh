#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: scripts/run-linux-capture-smoke.sh <app-path> [app-args...]" >&2
  exit 1
fi

: "${DAYLENS_SMOKE_REPORT_PATH:?DAYLENS_SMOKE_REPORT_PATH is required}"
: "${DAYLENS_SMOKE_WINDOW_STATE_PATH:?DAYLENS_SMOKE_WINDOW_STATE_PATH is required}"
: "${DAYLENS_SMOKE_EXPECT_FOREGROUND_TITLE:?DAYLENS_SMOKE_EXPECT_FOREGROUND_TITLE is required}"
: "${DAYLENS_SMOKE_EXPECT_FULLSCREEN_TITLE:?DAYLENS_SMOKE_EXPECT_FULLSCREEN_TITLE is required}"

app_path="$1"
shift
app_pid=''
normal_pid=''
fullscreen_pid=''

cleanup() {
  [ -z "$normal_pid" ] || kill "$normal_pid" 2>/dev/null || true
  [ -z "$fullscreen_pid" ] || kill "$fullscreen_pid" 2>/dev/null || true
  [ -z "$app_pid" ] || kill "$app_pid" 2>/dev/null || true
}
trap cleanup EXIT

openbox >/tmp/daylens-smoke-openbox.log 2>&1 &

"$app_path" "$@" &
app_pid=$!

for _ in $(seq 1 30); do
  daylens_window="$(xdotool search --onlyvisible --name 'Daylens' 2>/dev/null | head -n 1 || true)"
  [ -z "$daylens_window" ] || break
  sleep 1
done
if [ -z "${daylens_window:-}" ]; then
  echo "Daylens did not create a visible window." >&2
  exit 1
fi

xterm -T "$DAYLENS_SMOKE_EXPECT_FOREGROUND_TITLE" -geometry 100x30+80+80 -e sleep 45 &
normal_pid=$!
for _ in $(seq 1 15); do
  normal_window="$(xdotool search --onlyvisible --name "$DAYLENS_SMOKE_EXPECT_FOREGROUND_TITLE" 2>/dev/null | head -n 1 || true)"
  [ -z "$normal_window" ] || break
  sleep 1
done
if [ -z "${normal_window:-}" ]; then
  echo "The foreground capture probe did not create a visible window." >&2
  exit 1
fi
xdotool windowactivate --sync "$normal_window"
xdotool mousemove_relative -- 1 1
sleep 18
kill "$normal_pid"
wait "$normal_pid" 2>/dev/null || true
normal_pid=''

xmessage -title "$DAYLENS_SMOKE_EXPECT_FULLSCREEN_TITLE" -center 'Daylens packaged fullscreen capture probe' &
fullscreen_pid=$!
for _ in $(seq 1 15); do
  fullscreen_window="$(xdotool search --onlyvisible --name "$DAYLENS_SMOKE_EXPECT_FULLSCREEN_TITLE" 2>/dev/null | head -n 1 || true)"
  [ -z "$fullscreen_window" ] || break
  sleep 1
done
if [ -z "${fullscreen_window:-}" ]; then
  echo "The fullscreen capture probe did not create a visible window." >&2
  exit 1
fi
xdotool windowactivate --sync "$fullscreen_window"
xdotool windowstate --add FULLSCREEN "$fullscreen_window"
sleep 2
fullscreen_state="$(xprop -id "$fullscreen_window" _NET_WM_STATE 2>/dev/null || true)"
if [[ "$fullscreen_state" != *"_NET_WM_STATE_FULLSCREEN"* ]]; then
  echo "The capture probe did not enter EWMH fullscreen: $fullscreen_state" >&2
  exit 1
fi
xdotool mousemove_relative -- -1 -1

node -e '
  const fs = require("node:fs");
  fs.writeFileSync(process.env.DAYLENS_SMOKE_WINDOW_STATE_PATH, JSON.stringify({
    foreground: { title: process.env.DAYLENS_SMOKE_EXPECT_FOREGROUND_TITLE, activated: true },
    fullscreen: { title: process.env.DAYLENS_SMOKE_EXPECT_FULLSCREEN_TITLE, activated: true, fullscreen: true },
  }, null, 2) + "\n");
'

sleep 18
kill "$fullscreen_pid"
wait "$fullscreen_pid" 2>/dev/null || true
fullscreen_pid=''
xdotool windowactivate --sync "$daylens_window" || true

wait "$app_pid"
app_pid=''
trap - EXIT
