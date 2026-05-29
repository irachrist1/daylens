#!/bin/bash
# Custom Debian post-install script for Daylens.
#
# Setting deb.afterInstall in electron-builder REPLACES the default postinst, so this
# script reproduces the default behaviour (PATH symlink + desktop/mime refresh) and
# then hardens the Chromium sandbox.
#
# Fixes GitHub issue #17: the app aborts at launch with
#   "The SUID sandbox helper binary was found, but is not configured correctly ...
#    /opt/Daylens/chrome-sandbox is owned by root and has mode 4755"
# unless chrome-sandbox is root-owned with the setuid bit.

set -e

INSTALL_DIR='/opt/Daylens'
EXECUTABLE='daylens'

# Link the executable onto the PATH (default electron-builder behaviour).
ln -sf "${INSTALL_DIR}/${EXECUTABLE}" "/usr/bin/${EXECUTABLE}"

# Refresh MIME / desktop databases so the App Center identifies the package correctly.
if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi
if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# SUID chrome-sandbox for Electron. Chromium refuses to start without sandboxing
# unless this helper is owned by root and carries mode 4755.
sandbox="${INSTALL_DIR}/chrome-sandbox"
if [[ -f "$sandbox" ]]; then
    chown root:root "$sandbox" || true
    chmod 4755 "$sandbox" || true
fi

exit 0
