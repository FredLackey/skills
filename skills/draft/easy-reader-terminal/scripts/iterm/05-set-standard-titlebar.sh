#!/usr/bin/env bash
# Easy Reader Terminal - Standard Title Bar
# Sets iTerm2 back to the default macOS title bar (gray chrome).
# Use this to revert from the dark/minimal title bar.
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

DESIRED="$ITERM_STANDARD_STYLE"

echo "=== Easy Reader Terminal: Standard Title Bar ==="
echo ""

CURRENT=$(defaults read com.googlecode.iterm2 TabStyleWithAutomaticOption 2>/dev/null || echo "unset")

if [ "$CURRENT" = "$DESIRED" ]; then
    echo "iTerm2 theme is already set to Automatic (standard title bar)."
else
    echo "Current theme value: $CURRENT"
    echo "Setting iTerm2 theme to Automatic..."
    defaults write com.googlecode.iterm2 TabStyleWithAutomaticOption -int "$DESIRED"
    echo "Done."
    echo ""
    echo "Restart iTerm2 for the change to take effect (Cmd+Q then reopen)."
fi
