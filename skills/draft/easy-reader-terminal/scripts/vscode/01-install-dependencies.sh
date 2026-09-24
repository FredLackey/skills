#!/usr/bin/env bash
# Easy Reader Terminal - VS Code Dependencies
# Installs JetBrains Mono NL Nerd Font and verifies jq is available
# for JSON merging. Also verifies the VS Code CLI is reachable.
# Safe to run multiple times -- all steps are idempotent.

set -euo pipefail

RESOURCE_DIR="$(cd "$(dirname "$0")/../../resources" && pwd)"
source "$RESOURCE_DIR/preset.env"

echo "=== Easy Reader Terminal: VS Code Dependencies ==="
echo ""

# --- Font: JetBrains Mono Nerd Font (includes NL / No Ligatures variant) ---
echo "[1/3] Installing JetBrains Mono Nerd Font..."
if brew list --cask "$FONT_CASK" &>/dev/null; then
    echo "      Already installed."
else
    brew install --cask "$FONT_CASK"
    echo "      Installed."
fi
echo ""

# --- jq: required for merging settings.json ---
echo "[2/3] Checking for jq (JSON merge tool)..."
if command -v jq &>/dev/null; then
    echo "      Already installed: $(jq --version)"
else
    echo "      Installing jq via Homebrew..."
    brew install jq
    echo "      Installed."
fi
echo ""

# --- VS Code CLI ---
echo "[3/3] Checking for VS Code CLI..."
if command -v code &>/dev/null; then
    echo "      Found: $(which code)"
elif [ -f "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]; then
    echo "      Found at /Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
    echo "      Note: 'code' is not in your PATH. The setup script will use the full path."
    echo "      To add it to PATH: open VS Code > Cmd+Shift+P > 'Shell Command: Install code'"
else
    echo "      WARNING: VS Code CLI not found."
    echo "      Install VS Code first, then re-run this script."
fi

echo ""
echo "=== Dependencies checked ==="
echo ""
echo "Next: run 02-apply-settings.sh to install extensions and configure VS Code."
