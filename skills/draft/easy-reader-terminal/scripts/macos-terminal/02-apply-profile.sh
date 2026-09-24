#!/usr/bin/env bash
# Easy Reader Terminal - macOS Terminal.app Profile Setup
# Generates and imports an "Easy Reader" profile with Dracula colors,
# JetBrains Mono NL NF Medium 18pt, block cursor, and all decided settings.
#
# Terminal.app stores fonts and colors as NSKeyedArchiver binary data,
# so this script uses a Swift helper to generate the profile plist.
# Safe to run multiple times -- overwrites the same profile each time.

set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
    echo "This script requires macOS." >&2
    exit 1
fi

RESOURCE_DIR="$(cd "$(dirname "$0")/../../resources" && pwd)"
source "$RESOURCE_DIR/preset.env"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROFILE_TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$PROFILE_TEMP_DIR"' EXIT
TERMINAL_FILE="$PROFILE_TEMP_DIR/easy-reader-terminal-profile.terminal"

echo "=== Easy Reader Terminal: Terminal.app Profile ==="
echo ""

# --- Generate the .terminal profile using Swift ---
echo "Generating profile with Swift..."

swift "$SCRIPT_DIR/generate-profile.swift" "$RESOURCE_DIR/macos-terminal-profile.json" "$TERMINAL_FILE"

if [ ! -f "$TERMINAL_FILE" ]; then
    echo "Error: Swift failed to generate the profile."
    exit 1
fi

echo ""

# --- Import into Terminal.app ---
echo "Importing profile into Terminal.app..."

# Opening the .terminal file imports it and opens a new window with that profile.
# If Terminal.app is not running, it will launch.
open "$TERMINAL_FILE"

echo "Profile '$PROFILE_NAME' imported."
echo ""

# --- Set as default profile ---
echo "Setting '$PROFILE_NAME' as the default profile..."
defaults write com.apple.Terminal "Default Window Settings" -string "$PROFILE_NAME"
defaults write com.apple.Terminal "Startup Window Settings" -string "$PROFILE_NAME"
echo "Done."
echo ""

# --- Clean up ---
rm -f "$TERMINAL_FILE"

echo "Terminal.app is now configured with the Easy Reader profile."
echo "New windows will use this profile. Existing windows keep their current profile."
