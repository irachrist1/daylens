#!/bin/sh
# Custom post-remove script for Daylens (shared by .deb and .rpm).
#
# Mirrors electron-builder's default after-remove: drop the PATH symlink and refresh
# the desktop database on uninstall. POSIX sh (no bashisms) so rpm's %postun can run it.

set -e

EXECUTABLE='daylens'

if [ -L "/usr/bin/${EXECUTABLE}" ]; then
    rm -f "/usr/bin/${EXECUTABLE}"
fi

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi

exit 0
