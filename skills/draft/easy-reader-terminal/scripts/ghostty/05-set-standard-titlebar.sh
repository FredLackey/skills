#!/usr/bin/env bash
# Easy Reader Terminal - Standard Title Bar (Ghostty)
# Sets Ghostty back to the native macOS titlebar style.
# Safe to run multiple times -- rewrites the managed Easy Reader config line.

set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
    echo "This script requires macOS." >&2
    exit 1
fi

RESOURCE_DIR="$(cd "$(dirname "$0")/../../resources" && pwd)"
source "$RESOURCE_DIR/preset.env"

XDG_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/ghostty"
MACOS_CONFIG_DIR="$HOME/Library/Application Support/com.mitchellh.ghostty"

choose_config_dir() {
    if [ -f "$MACOS_CONFIG_DIR/easy-reader.conf" ]; then
        printf '%s\n' "$MACOS_CONFIG_DIR"
    elif [ -f "$XDG_CONFIG_DIR/easy-reader.conf" ]; then
        printf '%s\n' "$XDG_CONFIG_DIR"
    elif [ -f "$MACOS_CONFIG_DIR/config.ghostty" ] || [ -f "$MACOS_CONFIG_DIR/config" ]; then
        printf '%s\n' "$MACOS_CONFIG_DIR"
    else
        printf '%s\n' "$XDG_CONFIG_DIR"
    fi
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$(choose_config_dir)"
EASY_READER_FILE="$CONFIG_DIR/easy-reader.conf"
DESIRED="$GHOSTTY_STANDARD_STYLE"

echo "=== Easy Reader Terminal: Standard Title Bar (Ghostty) ==="
echo ""

if [ ! -f "$EASY_READER_FILE" ]; then
    "$SCRIPT_DIR/02-apply-profile.sh"
    echo ""
fi

CURRENT=$(grep '^macos-titlebar-style = ' "$EASY_READER_FILE" | sed 's/^macos-titlebar-style = //' || true)

if [ "$CURRENT" = "$DESIRED" ]; then
    echo "Ghostty titlebar style is already set to native."
elif [ -n "$CURRENT" ]; then
    perl -0pi -e 's/^macos-titlebar-style = .*$/macos-titlebar-style = native/m' "$EASY_READER_FILE"
    echo "Set Ghostty titlebar style to native."
else
    printf '\nmacos-titlebar-style = native\n' >> "$EASY_READER_FILE"
    echo "Set Ghostty titlebar style to native."
fi

echo ""
echo "Reload Ghostty with Cmd+Shift+, or open a new window."
