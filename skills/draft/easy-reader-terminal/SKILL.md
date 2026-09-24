---
name: easy-reader-terminal
description: Apply the fixed Easy Reader readability setup to Ghostty, iTerm2, macOS Terminal, and VS Code, including fonts, Dracula colors, spacing, cursors, and macOS appearance. Use when a user requests Easy Reader or this terminal readability setup, regardless of monitor size or model.
---

# Easy Reader Terminal

Apply the research-defined configuration exactly. This is a fixed preset, not
an interview to choose fonts, sizes, themes, or spacing. Do not replace its
values with inferred accessibility preferences or calculate font size from
monitor dimensions. It works as a setup workflow without knowing the user's
monitor size, model, identity, or workstation layout.

Read [resources/preset.md](resources/preset.md) for the complete preset and
[resources/application.md](resources/application.md) for platform requirements,
script order, verification, and recovery. All static profile data is bundled
in `resources/`; all executable helpers are in `scripts/`. Resolve both from
this skill's own directory, never from a private research repository.

## Apply

1. Identify the requested application and operating system from the session or
   local environment. If the application is unspecified, ask which application
   to configure. Do not install or configure all supported applications merely
   because the skill includes them.
2. Inspect the active configuration and preserve timestamped backups before
   running the applicable scripts. Follow any installed desktop configuration
   rules. Inspect existing symlinks and configuration includes before writing.
3. Use the matching dependency and application scripts in the order documented
   in `resources/application.md`. Preserve the fixed values, including the
   application-specific font names and contrast settings. Do not introduce
   override flags or alternative presets.
4. On macOS, the research workflow also includes its font-smoothing preference
   and dark-titlebar script. Explain that font smoothing changes a global
   preference; apply within the user's authorized setup scope. The standard
   titlebar script is the supplied reversal, not the default setup.
5. Reload or restart as indicated. Verify the actual font and profile, then
   inspect text, punctuation, ANSI colors, selection, and cursor in the running
   application. Report precisely what was applied and what could not be tested.

Only change the requested applications and the documented macOS preference.
If an app or platform cannot use a setting, report that limitation rather than
silently inventing a substitute. Font files must be installed on each device;
configuration synchronization alone does not install them. Do not collect or
store personal details or display specifications in the skill.
