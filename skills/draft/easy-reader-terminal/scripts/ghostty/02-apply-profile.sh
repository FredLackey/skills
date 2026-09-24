#!/usr/bin/env bash
# Easy Reader Terminal - Ghostty Profile Setup
# Writes an Easy Reader include file and attaches it to the active Ghostty
# config without replacing the user's existing configuration.
# Safe to run multiple times -- overwrites the managed include file and only
# appends the config-file line if it doesn't already exist.

set -euo pipefail

RESOURCE_DIR="$(cd "$(dirname "$0")/../../resources" && pwd)"
source "$RESOURCE_DIR/preset.env"

XDG_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/ghostty"
MACOS_CONFIG_DIR="$HOME/Library/Application Support/com.mitchellh.ghostty"

choose_main_config() {
    if [ -f "$MACOS_CONFIG_DIR/config.ghostty" ]; then
        printf '%s\n' "$MACOS_CONFIG_DIR/config.ghostty"
    elif [ -f "$MACOS_CONFIG_DIR/config" ]; then
        printf '%s\n' "$MACOS_CONFIG_DIR/config"
    elif [ -f "$XDG_CONFIG_DIR/config.ghostty" ]; then
        printf '%s\n' "$XDG_CONFIG_DIR/config.ghostty"
    elif [ -f "$XDG_CONFIG_DIR/config" ]; then
        printf '%s\n' "$XDG_CONFIG_DIR/config"
    else
        printf '%s\n' "$XDG_CONFIG_DIR/config.ghostty"
    fi
}

MAIN_CONFIG="$(choose_main_config)"
CONFIG_DIR="$(dirname "$MAIN_CONFIG")"
EASY_READER_FILE="$CONFIG_DIR/easy-reader.conf"
INCLUDE_LINE="config-file = easy-reader.conf"
GHOSTTY_BIN=""

if command -v ghostty &>/dev/null; then
    GHOSTTY_BIN="$(command -v ghostty)"
elif [ -x "/Applications/Ghostty.app/Contents/MacOS/ghostty" ]; then
    GHOSTTY_BIN="/Applications/Ghostty.app/Contents/MacOS/ghostty"
fi

echo "=== Easy Reader Terminal: Ghostty Profile ==="
echo ""

mkdir -p "$CONFIG_DIR"

cp "$RESOURCE_DIR/ghostty.conf" "$EASY_READER_FILE"

if [ ! -f "$MAIN_CONFIG" ]; then
    cat > "$MAIN_CONFIG" <<CONFIG
# Ghostty main config
# Easy Reader include added by easy-reader-terminal/scripts/ghostty/02-apply-profile.sh
$INCLUDE_LINE
CONFIG
    echo "Created main Ghostty config:"
    echo "  $MAIN_CONFIG"
elif grep -Fxq "$INCLUDE_LINE" "$MAIN_CONFIG"; then
    echo "Main Ghostty config already includes Easy Reader:"
    echo "  $MAIN_CONFIG"
else
    printf '\n%s\n' "$INCLUDE_LINE" >> "$MAIN_CONFIG"
    echo "Added Easy Reader include to:"
    echo "  $MAIN_CONFIG"
fi

echo ""
echo "Managed Easy Reader config written to:"
echo "  $EASY_READER_FILE"
echo ""

if [ -n "$GHOSTTY_BIN" ]; then
    if "$GHOSTTY_BIN" +list-fonts | grep -Fxq "JetBrainsMonoNL Nerd Font Mono"; then
        echo "Verified Ghostty font name: JetBrainsMonoNL Nerd Font Mono"
    else
        echo "Warning: Ghostty did not report JetBrainsMonoNL Nerd Font Mono."
        echo "         Run 01-install-dependencies.sh if the font is missing."
    fi
else
    echo "Ghostty CLI not found; skipping font verification."
fi

echo ""
echo "Reload Ghostty with Cmd+Shift+, or fully quit/reopen it."
echo "New windows will pick up titlebar and padding changes most reliably."
