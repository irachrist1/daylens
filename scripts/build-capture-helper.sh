#!/usr/bin/env bash
# Compiles the macOS capture helper to build/capture-helper.
# Ships to the packaged app via electron-builder's extraResources (build/ -> resources/build).
# No-op on non-macOS so cross-platform `build:all` stays green.
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "[build-capture-helper] skipping on $(uname); macOS-only"
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/src/native/capture-helper/main.swift"
OUT="$ROOT/build/capture-helper"

mkdir -p "$ROOT/build"
swiftc -O -o "$OUT" "$SRC"
echo "[build-capture-helper] built $OUT"
