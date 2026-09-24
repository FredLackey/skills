# Applying the preset

Execute this workflow as part of applying the skill; do not stop after installing
the skill package. Discover and configure all installed supported applications
unless the user explicitly narrows the target. Run scripts from their installed skill location. They locate bundled resources
relative to themselves and discover the user's home directory at runtime.
They do not require access to any source repository or a particular display.

## Script order

| Application | Scripts in its `scripts/` subfolder |
|---|---|
| iTerm2 (`iterm`) | `01-install-dependencies.sh`, `02-apply-profile.sh`, `03-macos-font-smoothing.sh`, `04-set-dark-titlebar.sh` |
| Terminal.app (`macos-terminal`) | Same numbered sequence as iTerm2 |
| Ghostty (`ghostty`) | Same numbered sequence on macOS |
| VS Code (`vscode`) | `01-install-dependencies.sh`, `02-apply-settings.sh` |

The `05-set-standard-titlebar.sh` scripts restore the research's standard
appearance option when requested. They are not part of the default dark setup.
The three smoothing scripts perform the same global change; run only one when
configuring multiple terminals.

## Requirements and platform boundaries

The dependency installers use Homebrew on macOS. They install the original
JetBrains Mono Nerd Font cask; Ghostty's installer also installs Ghostty and
VS Code's installer checks/installs jq. VS Code settings application additionally
requires Python 3 for safe JSONC parsing. Terminal.app generation requires Swift
and Cocoa on macOS. Install missing helper dependencies before running the
scripts. The iTerm2 and VS Code helpers assume their applications are installed;
when the user explicitly requests an absent application, install it first.
Locate VS Code's CLI or make it available to the script using its actual location.

The VS Code apply script supports macOS and Linux. On Linux, install the same
font, jq, Python 3, and VS Code CLI through the environment's supported process
before running `02-apply-settings.sh`; do not run the Homebrew dependency script.
Perform these installs during the task rather than leaving them as user homework.
Its settings path honors `XDG_CONFIG_HOME`. Check that this is the active VS Code
profile, not a portable installation, alternate distribution, or named profile.
For another profile, merge the bundled exact settings into its active settings
file with an appropriate editor instead of running the path-specific script.

The Ghostty profile includes a macOS-only titlebar setting. Its profile script
can locate the XDG configuration, but full script validation and appearance
setup target macOS. On Linux, check the installed Ghostty version's handling
of platform-specific keys before applying; report unsupported keys. Windows
has no shell automation in this package. VS Code's exact JSON settings and
extension list can be applied using native Windows tooling after font setup;
no Windows Terminal preset was established by the source scripts.

## Backup and apply behavior

Before application, save the existing profile/include/settings file to a unique
backup and record whether it existed. Save the main Ghostty config too. For
macOS preference changes, record each key's old value and whether it was absent:
`CGFontRenderingFontSmoothingDisabled` in the global domain,
`TabStyleWithAutomaticOption` in `com.googlecode.iterm2`, and
`NSRequiresAquaSystemAppearance`, `AppleInterfaceStyle`, `Default Window Settings`,
and `Startup Window Settings` in `com.apple.Terminal` as applicable.

- iTerm2 writes `easy-reader.json` to its DynamicProfiles directory.
- Ghostty writes `easy-reader.conf` and adds a single include to the selected
  main configuration. Inspect other includes and later overrides if the preset
  does not take effect. It retains the original config selection order.
- Terminal.app generates and opens a `.terminal` profile, then sets Easy Reader
  as the default and startup profile. A unique temporary directory is used.
- VS Code installs the Dracula extension and merges the exact payload into
  existing settings. The merge retains unrelated values but rewrites formatting
  and removes comments. It backs up the original file. JSONC strings, URLs,
  block comments, and trailing commas are supported; malformed files or duplicate
  keys stop processing instead of replacing existing settings with an empty object.

To undo, restore backups and recorded preference values. Delete a newly created
file/key only if it did not exist before setup. Remove an added Ghostty include
when removing its profile. A standard-titlebar script restores the supplied
standard mode; it is not a substitute for restoring an arbitrary prior value.
Do not uninstall preexisting fonts, applications, or extensions during recovery.

## Verify

Confirm the installed font is used, not a fallback. Ghostty's profile script
checks `+list-fonts`; inspect the active font in other applications. Open a new
window/profile and check 18-size Medium text, default terminal spacing, Dracula,
and a steady block cursor. Check VS Code editor line height separately. Use
`0 O 1 l I 8 B 5 S`, `[] {} ()`, and `!= => >=` to inspect glyphs and ligatures.
Inspect actual application output, including dim ANSI text and selection.
No display measurement or automatic resizing is part of this workflow.
Use the activation steps below before declaring the setup complete.

## Activate immediately

Treat messages printed by the legacy scripts such as “Next: run ...”, “reload”,
or “set as default” as instructions for the applying agent to carry out. They
are not completion messages and must not become user homework.

| Application | Activation the agent must perform |
|---|---|
| iTerm2 | Wait for the dynamic profile to load, select Easy Reader and make it the default in the application's profile controls. Open a new Easy Reader window or switch the current session's profile using available application automation. Confirm the displayed session actually uses it. |
| Terminal.app | Confirm the generated `.terminal` import opened a window using Easy Reader, and verify the default/startup profile preferences. Keep the generated file available until import completes. Existing sessions may retain their prior profile: switch their settings through application controls when possible, preserving running commands. |
| Ghostty | Invoke Reload Configuration through the application's menu or supported action. Open a new window to pick up window-only settings and confirm that the Easy Reader include wins over conflicting settings. Inspect the actual loaded configuration if nothing changes. |
| VS Code | Confirm the Dracula extension is installed in the active profile and select Dracula. Apply the resource payload to the active user/profile settings. Reload the window if needed and open or inspect an integrated terminal. Inspect workspace and remote overrides if the effective settings differ. Restart safely if the titlebar requires it. |

Use the installed application's controls or documented automation. Do not guess
keyboard shortcuts, target an unrelated frontmost window, or blindly kill
processes. When the agent is running inside a target terminal, opening a new
configured window can provide immediate visual confirmation without destroying
the current task. An application restart that risks active jobs or unsaved work
is a concrete activation limitation, not a reason to abandon the rest of setup.

If a script exits successfully but the display is unchanged, investigate active
profile selection, missing font/fallback, settings precedence, and reload state.
Do not explain this away as expected behavior: the visual change is the purpose
of applying the skill. If inspection is impossible, report the setup as written
but visually unverified, with the exact remaining limitation.

## Public technical references

- [Ghostty configuration](https://ghostty.org/docs/config/reference)
- [iTerm2 dynamic profiles](https://iterm2.com/documentation-dynamic-profiles.html)
- [VS Code terminal appearance](https://code.visualstudio.com/docs/terminal/appearance)
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/)
- [Nerd Fonts downloads](https://www.nerdfonts.com/font-downloads)
- [Dracula VS Code](https://draculatheme.com/visual-studio-code)

This package retains the established presets rather than treating later upstream
defaults as authority to redesign them.
