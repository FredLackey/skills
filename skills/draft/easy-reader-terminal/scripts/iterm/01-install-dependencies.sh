#!/usr/bin/env bash
# Easy Reader Terminal - iTerm2 Dependencies
# Installs JetBrains Mono NL Nerd Font and Dracula theme for iTerm2.
# Safe to run multiple times -- all steps are idempotent.

set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
    echo "This script requires macOS." >&2
    exit 1
fi

RESOURCE_DIR="$(cd "$(dirname "$0")/../../resources" && pwd)"
source "$RESOURCE_DIR/preset.env"

echo "=== Easy Reader Terminal: iTerm2 Dependencies ==="
echo ""

# --- Font: JetBrains Mono Nerd Font (includes NL / No Ligatures variant) ---
echo "[1/2] Installing JetBrains Mono Nerd Font..."
if brew list --cask "$FONT_CASK" &>/dev/null; then
    echo "      Already installed."
else
    brew install --cask "$FONT_CASK"
    echo "      Installed."
fi
echo ""

# --- Theme: Dracula for iTerm2 ---
DRACULA_DIR="$HOME/.iterm2/dracula"
echo "[2/2] Installing Dracula theme for iTerm2..."
if [ -d "$DRACULA_DIR/.git" ]; then
    echo "      Already cloned at $DRACULA_DIR. Pulling latest..."
    git -C "$DRACULA_DIR" pull --ff-only 2>/dev/null || echo "      Pull skipped (offline or diverged)."
elif [ -d "$DRACULA_DIR" ]; then
    echo "Existing directory is not a Git clone: $DRACULA_DIR" >&2
    exit 1
else
    mkdir -p "$HOME/.iterm2"
    git clone "$ITERM_THEME_URL" "$DRACULA_DIR"
    echo "      Cloned to $DRACULA_DIR"
fi

echo ""
echo "=== Dependencies installed ==="
echo ""
echo "Next: run 02-apply-profile.sh to create the iTerm2 Dynamic Profile."
echo "      The profile includes the full Dracula color palette -- no manual import needed."
