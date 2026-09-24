#!/usr/bin/env bash
# Easy Reader Terminal - macOS Font Smoothing
# Applies the research-defined macOS font-smoothing preference.
# Rendering effects depend on the macOS version; compare text rendering
# where the user benefits from the research-defined smoothing preference.
# Safe to run multiple times -- checks current state before writing.
#
# Note: This is a system-wide setting, identical to the iTerm2 and Terminal.app
# versions. Running any of these scripts applies the change for all applications.

set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
    echo "This script requires macOS." >&2
    exit 1
fi

RESOURCE_DIR="$(cd "$(dirname "$0")/../../resources" && pwd)"
source "$RESOURCE_DIR/preset.env"

echo "=== Easy Reader Terminal: macOS Font Smoothing ==="
echo ""

RAW=$(defaults read -g CGFontRenderingFontSmoothingDisabled 2>/dev/null || echo "unset")
NORMALIZED=$(echo "$RAW" | tr '[:upper:]' '[:lower:]')

if [ "$NORMALIZED" = "0" ] || [ "$NORMALIZED" = "false" ] || [ "$NORMALIZED" = "no" ]; then
    echo "Font smoothing is already enabled (CGFontRenderingFontSmoothingDisabled = $RAW)."
else
    echo "Current value: $RAW"
    echo "Enabling font smoothing..."
    defaults write -g CGFontRenderingFontSmoothingDisabled -bool NO
    echo "Done."
    echo ""
    echo "You need to restart applications for this to take effect."
    echo "For Ghostty: Cmd+Q then reopen."
fi
