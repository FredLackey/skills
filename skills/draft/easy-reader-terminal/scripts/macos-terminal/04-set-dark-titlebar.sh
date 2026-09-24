#!/usr/bin/env bash
# Easy Reader Terminal - Dark Title Bar (Terminal.app)
# Forces Terminal.app to use dark appearance regardless of the system setting.
# The title bar and tab bar will match the dark Dracula background.
# Safe to run multiple times -- checks current state before writing.
#
# Unlike iTerm2's "Minimal" mode, Terminal.app doesn't hide the title bar
# chrome entirely. This sets the app-specific appearance to dark so the
# title bar uses dark gray instead of the standard light macOS gray.

set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
    echo "This script requires macOS." >&2
    exit 1
fi

RESOURCE_DIR="$(cd "$(dirname "$0")/../../resources" && pwd)"
source "$RESOURCE_DIR/preset.env"

echo "=== Easy Reader Terminal: Dark Title Bar (Terminal.app) ==="
echo ""

# AppleInterfaceStyle at the app level forces dark mode for just this app.
# NSRequiresAquaSystemAppearance = NO allows Terminal to follow dark mode.
CURRENT=$(defaults read com.apple.Terminal NSRequiresAquaSystemAppearance 2>/dev/null || echo "unset")
NORMALIZED=$(echo "$CURRENT" | tr '[:upper:]' '[:lower:]')

if [ "$NORMALIZED" = "0" ] || [ "$NORMALIZED" = "false" ] || [ "$NORMALIZED" = "no" ]; then
    echo "Terminal.app is already set to follow system/dark appearance."
else
    echo "Allowing Terminal.app to use dark appearance..."
    defaults write com.apple.Terminal NSRequiresAquaSystemAppearance -bool NO
    echo "Done."
fi

# Also set the app-level appearance to dark explicitly
defaults write com.apple.Terminal AppleInterfaceStyle -string "Dark"

echo "Terminal.app will use dark title bar chrome."
echo ""
echo "Restart Terminal.app for the change to take effect (Cmd+Q then reopen)."
