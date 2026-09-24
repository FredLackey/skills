#!/usr/bin/env bash
# Easy Reader Terminal - macOS Terminal.app Dependencies
# Installs JetBrains Mono NL Nerd Font.
# Safe to run multiple times -- all steps are idempotent.

set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
    echo "This script requires macOS." >&2
    exit 1
fi

RESOURCE_DIR="$(cd "$(dirname "$0")/../../resources" && pwd)"
source "$RESOURCE_DIR/preset.env"

echo "=== Easy Reader Terminal: Terminal.app Dependencies ==="
echo ""

# --- Font: JetBrains Mono Nerd Font (includes NL / No Ligatures variant) ---
echo "[1/1] Installing JetBrains Mono Nerd Font..."
if brew list --cask "$FONT_CASK" &>/dev/null; then
    echo "      Already installed."
else
    brew install --cask "$FONT_CASK"
    echo "      Installed."
fi

echo ""
echo "=== Dependencies installed ==="
echo ""
echo "Next: run 02-apply-profile.sh to create the Terminal.app profile."
