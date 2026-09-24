#!/usr/bin/env bash
# Easy Reader Terminal - VS Code Settings and Extensions
# Installs the Dracula theme and readability extensions, then merges
# Easy Reader settings into the user's settings.json without destroying
# existing configuration. Uses jq for deep JSON merge.
# Safe to run multiple times -- all steps are idempotent.

set -euo pipefail

RESOURCE_DIR="$(cd "$(dirname "$0")/../../resources" && pwd)"
source "$RESOURCE_DIR/preset.env"

echo "=== Easy Reader Terminal: VS Code Settings ==="
echo ""

# ── Detect VS Code CLI ─────────────────────────────────────────────────

if command -v code &>/dev/null; then
    CODE_CMD="code"
elif [ -f "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]; then
    CODE_CMD="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
else
    echo "ERROR: VS Code CLI not found."
    echo "Install VS Code or run: Cmd+Shift+P > 'Shell Command: Install code'"
    exit 1
fi

echo "Using CLI: $CODE_CMD"
echo ""

# ── Detect settings.json path ──────────────────────────────────────────

case "$(uname -s)" in
    Darwin)
        SETTINGS_FILE="$HOME/Library/Application Support/Code/User/settings.json"
        ;;
    Linux)
        SETTINGS_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/Code/User/settings.json"
        ;;
    *)
        echo "ERROR: This script targets macOS and Linux."
        exit 1
        ;;
esac

echo "Settings file: $SETTINGS_FILE"
echo ""

# ── Check for jq ──────────────────────────────────────────────────────

if ! command -v jq &>/dev/null; then
    echo "ERROR: jq is required for JSON merging."
    echo "Run 01-install-dependencies.sh first, or: brew install jq"
    exit 1
fi

command -v python3 >/dev/null || { echo "python3 is required." >&2; exit 1; }
if [ -f "$SETTINGS_FILE" ]; then
    python3 "$RESOURCE_DIR/../scripts/read-jsonc.py" "$SETTINGS_FILE" >/dev/null
fi

# ── Install Extensions ────────────────────────────────────────────────

EXTENSIONS=()
while IFS= read -r extension; do
    [[ -z "$extension" ]] || EXTENSIONS+=("$extension")
done < "$RESOURCE_DIR/vscode-extensions.txt"

echo "[1/2] Installing extensions..."
for ext in "${EXTENSIONS[@]}"; do
    if "$CODE_CMD" --list-extensions 2>/dev/null | grep -qi "^${ext}$"; then
        echo "      Already installed: $ext"
    else
        "$CODE_CMD" --install-extension "$ext" --force 2>/dev/null
        echo "      Installed: $ext"
    fi
done
echo ""

# ── Merge Settings ────────────────────────────────────────────────────

echo "[2/2] Merging Easy Reader settings into settings.json..."

# Fixed settings from the Easy Reader research:
#   Font:     JetBrains Mono NL NF, Medium (500), 18px, no ligatures
#   Theme:    Dracula (standard variant)
#   Terminal: line height 1.0, block cursor, no blink, contrast ratio 7
#   Editor:   line height 1.5 for comfortable code reading
#   Title:    custom (dark, matches Dracula)
NEW_SETTINGS=$(cat "$RESOURCE_DIR/vscode-settings.json")

mkdir -p "$(dirname "$SETTINGS_FILE")"

# Back up existing settings before merge
if [ -f "$SETTINGS_FILE" ]; then
    BACKUP="${SETTINGS_FILE}.bak.$(date +%Y%m%d%H%M%S)"
    cp "$SETTINGS_FILE" "$BACKUP"
    echo "      Backup: $BACKUP"

    # Parse JSONC without corrupting URLs; invalid input stops the script.
    EXISTING=$(python3 "$RESOURCE_DIR/../scripts/read-jsonc.py" "$SETTINGS_FILE")

    # Deep merge: existing * new (new wins on key conflicts)
    echo "$EXISTING" | jq --argjson new "$NEW_SETTINGS" '. * $new' > "${SETTINGS_FILE}.tmp"
    mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"
    echo "      Merged into existing settings."
else
    echo "$NEW_SETTINGS" | jq '.' > "$SETTINGS_FILE"
    echo "      Created new settings file."
fi

echo ""
echo "=== VS Code setup complete ==="
echo ""
echo "Settings applied:"
echo "  Theme:    Dracula"
echo "  Font:     JetBrainsMonoNL Nerd Font, 18px, Medium (500)"
echo "  Editor:   line height 1.5, no ligatures"
echo "  Terminal: line height 1.0, block cursor, no blink, contrast 7"
echo "  Title:    custom (dark, Dracula-themed)"
echo ""
echo "If VS Code is running, it will pick up changes within a few seconds."
echo "The title bar change requires a full VS Code restart."
