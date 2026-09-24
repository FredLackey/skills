#!/usr/bin/env bash
# Easy Reader Terminal - Dark Title Bar
# Sets iTerm2 to "Minimal" theme where the title bar matches the terminal
# background color instead of using the standard macOS gray chrome.
# Best for dark rooms where the gray title bar stands out.
# Safe to run multiple times -- checks current state before writing.
#
# iTerm2 Theme values:
#   0 = Light, 1 = Dark, 2 = Light High Contrast,
#   3 = Dark High Contrast, 4 = Automatic,
#   5 = Minimal, 6 = Compact

set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
    echo "This script requires macOS." >&2
    exit 1
fi

RESOURCE_DIR="$(cd "$(dirname "$0")/../../resources" && pwd)"
source "$RESOURCE_DIR/preset.env"

DESIRED="$ITERM_DARK_STYLE"

echo "=== Easy Reader Terminal: Dark Title Bar ==="
echo ""

CURRENT=$(defaults read com.googlecode.iterm2 TabStyleWithAutomaticOption 2>/dev/null || echo "unset")

if [ "$CURRENT" = "$DESIRED" ]; then
    echo "iTerm2 theme is already set to Minimal (dark title bar)."
else
    echo "Current theme value: $CURRENT"
    echo "Setting iTerm2 theme to Minimal..."
    defaults write com.googlecode.iterm2 TabStyleWithAutomaticOption -int "$DESIRED"
    echo "Done."
    echo ""
    echo "Restart iTerm2 for the change to take effect (Cmd+Q then reopen)."
fi
