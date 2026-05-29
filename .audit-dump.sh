#!/usr/bin/env bash
set -euo pipefail
DB="$HOME/Library/Application Support/DaylensWindows/daylens.sqlite"
OUT="/tmp/daylens-audit/recent-threads.txt"
mkdir -p /tmp/daylens-audit
: > "$OUT"

for tid in 99 100 101 102 103 104 105 106 107; do
  echo "===== THREAD $tid =====" >> "$OUT"
  sqlite3 "$DB" -cmd ".mode list" -cmd ".separator '\n---END---\n'" -cmd ".headers off" "SELECT role || ' [' || datetime(created_at/1000, 'unixepoch', 'localtime') || ']' || char(10) || char(10) || content || char(10) || '---META---' || char(10) || COALESCE(metadata_json, '{}') FROM ai_messages WHERE thread_id = $tid ORDER BY created_at ASC;" >> "$OUT"
  echo "" >> "$OUT"
done

wc -l "$OUT"
