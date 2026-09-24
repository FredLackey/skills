#!/usr/bin/env bash
# Easy Reader Terminal - Ghostty Dependencies
# Installs Ghostty and JetBrains Mono NL Nerd Font.
# Safe to run multiple times -- all steps are idempotent.

set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
    echo "This script requires macOS." >&2
    exit 1
fi

RESOURCE_DIR="$(cd "$(dirname "$0")/../../resources" && pwd)"
source "$RESOURCE_DIR/preset.env"

echo "=== Easy Reader Terminal: Ghostty Dependencies ==="
echo ""

echo "[1/2] Installing Ghostty..."
if brew list --cask "$GHOSTTY_CASK" &>/dev/null; then
    echo "      Already installed via Homebrew."
elif [ -d "/Applications/Ghostty.app" ]; then
    echo "      Already installed at /Applications/Ghostty.app."
else
    brew install --cask "$GHOSTTY_CASK"
    echo "      Installed."
fi
echo ""

echo "[2/2] Installing JetBrains Mono Nerd Font..."
if brew list --cask "$FONT_CASK" &>/dev/null; then
    echo "      Already installed."
else
    brew install --cask "$FONT_CASK"
    echo "      Installed."
fi
echo ""

echo "=== Dependencies installed ==="
echo ""
echo "Next: run 02-apply-profile.sh to write the Ghostty Easy Reader config."
