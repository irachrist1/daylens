#!/bin/sh
# Custom post-install script for Daylens (shared by .deb and .rpm).
#
# Setting deb.afterInstall / rpm.afterInstall in electron-builder REPLACES the
# default post-install scriptlet, so this reproduces the default behaviour (PATH
# symlink + desktop/mime refresh) and then hardens the Chromium sandbox. Written
# in POSIX sh (no bashisms) since rpm runs %post under /bin/sh.
#
# Fixes GitHub issue #17: the app aborts at launch with
#   "The SUID sandbox helper binary was found, but is not configured correctly ...
#    /opt/Daylens/chrome-sandbox is owned by root and has mode 4755"
# unless chrome-sandbox is root-owned with the setuid bit. Both .deb and .rpm
# install to /opt/Daylens and ship the same chrome-sandbox helper.

set -e

INSTALL_DIR='/opt/Daylens'
EXECUTABLE='daylens'

# Link the executable onto the PATH (default electron-builder behaviour).
ln -sf "${INSTALL_DIR}/${EXECUTABLE}" "/usr/bin/${EXECUTABLE}"

# Refresh MIME / desktop databases so the App Center identifies the package correctly.
if command -v update-mime-database >/dev/null 2>&1; then
    update-mime-database /usr/share/mime || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications || true
fi

# SUID chrome-sandbox for Electron. Chromium refuses to start without sandboxing
# unless this helper is owned by root and carries mode 4755.
sandbox="${INSTALL_DIR}/chrome-sandbox"
if [ -f "$sandbox" ]; then
    # Do not swallow these — if hardening fails the app cannot launch, so the
    # install should surface a clear error rather than complete silently.
    if ! chown root:root "$sandbox"; then
        echo "daylens postinst: failed to chown root:root $sandbox (chrome-sandbox must be root-owned)" >&2
        exit 1
    fi
    if ! chmod 4755 "$sandbox"; then
        echo "daylens postinst: failed to chmod 4755 $sandbox (chrome-sandbox needs the setuid bit)" >&2
        exit 1
    fi
fi

exit 0
