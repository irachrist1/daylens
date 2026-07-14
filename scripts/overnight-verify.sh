#!/usr/bin/env bash
# Overnight verification harness.
#
# Runs the safe deterministic shipping gate and appends a timestamped pass/fail
# report to logs/overnight-verify.log. Provider, payment, connector, and remote
# boundaries remain local fakes, so the script can run unattended.
#
# Usage:
#   bash scripts/overnight-verify.sh
# Schedule (example, every 2h overnight) with launchd or cron, or via the
# /schedule skill. Exit code is non-zero if any step fails.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

mkdir -p logs
LOG="logs/overnight-verify.log"
STAMP="$(date '+%Y-%m-%d %H:%M:%S')"
fail=0
log() { echo "$1" | tee -a "$LOG"; }

log ""
log "===== overnight-verify $STAMP ====="

run_step() {
  local name="$1"; shift
  if "$@" >>"$LOG" 2>&1; then
    log "PASS  $name"
  else
    log "FAIL  $name"
    fail=1
  fi
}

run_step "safe shipping gate" npm run verify:shipping

if [ "$fail" -eq 0 ]; then
  log "RESULT $STAMP  ALL GREEN"
else
  log "RESULT $STAMP  REGRESSION DETECTED (see entries above)"
fi
exit "$fail"
