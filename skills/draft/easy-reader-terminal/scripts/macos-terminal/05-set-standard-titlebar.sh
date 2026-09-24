#!/usr/bin/env bash
# Easy Reader Terminal - Standard Title Bar (Terminal.app)
# Reverts Terminal.app to follow the system appearance setting.
# Safe to run multiple times -- checks current state before writing.

set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
    echo "This script requires macOS." >&2
    exit 1
fi

RESOURCE_DIR="$(cd "$(dirname "$0")/../../resources" && pwd)"
source "$RESOURCE_DIR/preset.env"

echo "=== Easy Reader Terminal: Standard Title Bar (Terminal.app) ==="
echo ""

# Remove app-specific overrides so Terminal follows the system appearance
defaults delete com.apple.Terminal NSRequiresAquaSystemAppearance 2>/dev/null && \
    echo "Removed NSRequiresAquaSystemAppearance override." || \
    echo "NSRequiresAquaSystemAppearance was not set."

defaults delete com.apple.Terminal AppleInterfaceStyle 2>/dev/null && \
    echo "Removed AppleInterfaceStyle override." || \
    echo "AppleInterfaceStyle was not set."

echo ""
echo "Terminal.app will now follow your system appearance setting."
echo "Restart Terminal.app for the change to take effect (Cmd+Q then reopen)."
