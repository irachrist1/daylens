# Daylens macOS Update Recovery

Use this runbook when the macOS in-app updater is stuck on an older Daylens build and cannot update itself. This is a recovery path, not the normal update path.

This was first used on May 29, 2026 after a Daylens 1.0.36 install kept showing the old raw error:

```text
Database not initialised -- call initDb() first
```

The fix had already shipped in 1.0.40, but the running app and the app bundle in `/Applications` were still 1.0.36. The recovery was to download the release ZIP asset directly, verify it, quit Daylens, replace only `/Applications/Daylens.app`, and relaunch.

## What This Touches

This replaces the app bundle:

```text
/Applications/Daylens.app
```

It does not delete Daylens user data. Do not remove the user data folder while doing update recovery:

```text
~/Library/Application Support/DaylensWindows
```

## 1. Confirm The Installed Version

```bash
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/Daylens.app/Contents/Info.plist
/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' /Applications/Daylens.app/Contents/Info.plist
ps aux | rg -i '[D]aylens.app/Contents/MacOS/Daylens|[D]aylens Helper' || true
```

If this reports an older version than the latest public release, the user is still running the old app.

## 2. Check The Public Update Feed

```bash
curl -fsSL 'https://christian-tonny.dev/daylens/api/update-feed?platform=darwin&arch=arm64' \
  | node -e '
    let raw = "";
    process.stdin.on("data", chunk => raw += chunk);
    process.stdin.on("end", () => {
      const feed = JSON.parse(raw);
      console.log(`version=${feed.version}`);
      console.log(`installUrl=${feed.installUrl}`);
      console.log(`installSizeBytes=${feed.installSizeBytes}`);
      console.log(`manualUrl=${feed.manualUrl}`);
    });
  '
```

Confirm that:

- `version` is the release you intend to install.
- `installUrl` points at a GitHub `Daylens-<version>-arm64.zip` asset.
- `installSizeBytes` is present.
- `manualUrl` points at the matching DMG.

## 3. Download And Verify The ZIP

Set these from the update feed output. Run this and the following commands in the same terminal session so the variables stay available.

```bash
VERSION="1.0.40"
ARCH="arm64"
EXPECTED_SIZE="154676620"
ZIP_URL="https://github.com/irachrist1/daylens/releases/download/v${VERSION}/Daylens-${VERSION}-${ARCH}.zip"
WORKDIR="/tmp/daylens-recover-${VERSION}"
```

Then download and verify:

```bash
set -euo pipefail

rm -rf "$WORKDIR"
mkdir -p "$WORKDIR/extract"

curl -fL "$ZIP_URL" -o "$WORKDIR/Daylens-${VERSION}-${ARCH}.zip"

ACTUAL_SIZE="$(stat -f '%z' "$WORKDIR/Daylens-${VERSION}-${ARCH}.zip")"
if [ "$ACTUAL_SIZE" != "$EXPECTED_SIZE" ]; then
  echo "Size mismatch: expected $EXPECTED_SIZE, got $ACTUAL_SIZE"
  exit 1
fi

ditto -x -k "$WORKDIR/Daylens-${VERSION}-${ARCH}.zip" "$WORKDIR/extract"

/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$WORKDIR/extract/Daylens.app/Contents/Info.plist"
test -d "$WORKDIR/extract/Daylens.app/Contents/Frameworks/Electron Framework.framework"
```

Do not continue unless the extracted app reports the expected version.

## 4. Quit Daylens And Replace The App

```bash
set -euo pipefail

APP="/Applications/Daylens.app"
STAGED="$WORKDIR/extract/Daylens.app"
BACKUP="/tmp/Daylens.app.backup.$(date +%s)"

osascript -e 'tell application "Daylens" to quit' || true
sleep 3

if pgrep -f '/Applications/Daylens.app/Contents/MacOS/Daylens' >/dev/null; then
  pkill -TERM -f '/Applications/Daylens.app/Contents/MacOS/Daylens' || true
  sleep 2
fi

if pgrep -f '/Applications/Daylens.app/Contents/MacOS/Daylens' >/dev/null; then
  pkill -KILL -f '/Applications/Daylens.app/Contents/MacOS/Daylens' || true
  sleep 1
fi

mv "$APP" "$BACKUP"
mv "$STAGED" "$APP"

/usr/bin/codesign --force --deep --sign - "$APP"
/usr/bin/xattr -cr "$APP"

open -n "$APP"
echo "Backup kept at: $BACKUP"
```

The backup is kept in `/tmp` so the app can be rolled back quickly if needed.

## 5. Verify Recovery

```bash
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/Daylens.app/Contents/Info.plist
/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' /Applications/Daylens.app/Contents/Info.plist
ps aux | rg -i '[D]aylens.app/Contents/MacOS/Daylens|[D]aylens Helper' || true
```

The installed version should now match the update feed version, and the process path should be `/Applications/Daylens.app/Contents/MacOS/Daylens`.

After this recovery, future in-app updates should use the fixed updater code from the newly installed build.

## Roll Back If Needed

Use the exact backup path printed by the replacement step:

```bash
set -euo pipefail

BACKUP="/tmp/Daylens.app.backup.REPLACE_WITH_TIMESTAMP"

osascript -e 'tell application "Daylens" to quit' || true
sleep 3
pkill -TERM -f '/Applications/Daylens.app/Contents/MacOS/Daylens' || true
sleep 2

rm -rf /Applications/Daylens.app
mv "$BACKUP" /Applications/Daylens.app
open -n /Applications/Daylens.app
```

## Why This Worked

The broken app was old enough that it failed during its own shutdown/update path before it could install the fixed build. Replacing the app bundle manually bypassed the broken old updater while preserving user data. Once Daylens launched from the fixed build, the new updater code and friendlier error handling were available.
