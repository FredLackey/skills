#!/usr/bin/env bash
# Easy Reader Terminal - iTerm2 Profile Setup
# Creates an iTerm2 Dynamic Profile with all Easy Reader settings.
# iTerm2 picks up Dynamic Profiles at runtime -- no restart needed.

set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
    echo "This script requires macOS." >&2
    exit 1
fi

RESOURCE_DIR="$(cd "$(dirname "$0")/../../resources" && pwd)"
source "$RESOURCE_DIR/preset.env"

PROFILE_DIR="$HOME/Library/Application Support/iTerm2/DynamicProfiles"
PROFILE_FILE="$PROFILE_DIR/easy-reader.json"

echo "=== Easy Reader Terminal: iTerm2 Profile ==="
echo ""

mkdir -p "$PROFILE_DIR"

cp "$RESOURCE_DIR/iterm-profile.json" "$PROFILE_FILE"

echo "Dynamic Profile written to:"
echo "  $PROFILE_FILE"
echo ""
echo "iTerm2 will pick this up automatically (no restart needed)."
echo "If iTerm2 is running, the 'Easy Reader' profile should appear"
echo "under Preferences > Profiles within a few seconds."
echo ""
echo "To make it the default profile:"
echo "  Preferences > Profiles > Easy Reader > Other Actions > Set as Default"
