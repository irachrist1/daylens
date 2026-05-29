#!/usr/bin/env bash
# Overnight verification harness.
#
# Runs the full NON-BILLED check set (typecheck + safe unit tests + the three
# Vite bundles) and appends a timestamped pass/fail report to
# logs/overnight-verify.log. It deliberately does NOT run any test that hits a
# live AI provider (test:behaviour, test:toolcalls, test:entity-prompts,
# ai:bench, or the API-backed chat tests) so it can run unattended without
# spending money.
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
ELECTRON="./node_modules/.bin/electron"
TS_LOADER="./tests/support/ts-loader.mjs"

# Curated list of tests confirmed to run without any live API call.
SAFE_TESTS=(
  tests/workBlockSplitting.test.ts
  tests/categoryOverridesCache.test.ts
  tests/migrationRoundtrip.test.ts
  tests/databaseBootstrap.test.ts
  tests/rendererHookSafety.test.ts
  tests/appActivityDigest.test.ts
  tests/appDetailPayload.test.ts
  tests/attributionBrowserEvidence.test.ts
  tests/recap.test.ts
  tests/search.test.ts
  tests/trackingHeuristics.test.ts
  tests/trackingSelfCapture.test.ts
  tests/appsTopDomains.test.ts
  tests/wrappedFacts.test.ts
  tests/workMemory.test.ts
  tests/peakHours.test.ts
  tests/evidenceBackedQuery.test.ts
  tests/derivedStateReset.test.ts
  tests/artifactPreview.test.ts
  tests/linuxActiveWindow.test.ts
  tests/processMonitorParse.test.ts
)

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

run_step "typecheck" npm run typecheck
run_step "tests (safe set)" env ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --loader "$TS_LOADER" --test "${SAFE_TESTS[@]}"
run_step "build:main" npm run build:main
run_step "build:preload" npm run build:preload
run_step "build:renderer" npm run build:renderer

if [ "$fail" -eq 0 ]; then
  log "RESULT $STAMP  ALL GREEN"
else
  log "RESULT $STAMP  REGRESSION DETECTED (see entries above)"
fi
exit "$fail"
