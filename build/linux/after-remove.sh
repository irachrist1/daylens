#!/bin/bash
# Custom Debian post-remove script for Daylens.
#
# Mirrors electron-builder's default after-remove: drop the PATH symlink and refresh
# the desktop database on uninstall.

set -e

EXECUTABLE='daylens'

if [ -L "/usr/bin/${EXECUTABLE}" ]; then
    rm -f "/usr/bin/${EXECUTABLE}"
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications &>/dev/null || true
fi

exit 0
