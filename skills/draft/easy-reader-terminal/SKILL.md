---
name: easy-reader-terminal
description: Install and activate the fixed Easy Reader visual setup on the user's machine. Execute font and dependency installs, application configuration, and reload or profile activation for supported terminals and VS Code when asked to apply, implement, set up, or use Easy Reader. No monitor-size requirement.
---

# Easy Reader Terminal

## Execute the setup

A request to apply, implement, set up, or use this skill is an instruction to
perform the setup on the user's machine now. Installing or copying the skill
package is only preparation; continue through dependency installation,
configuration, activation, and verification in the same task. Do not end with
instructions for the user to run the scripts or ask which preset to apply.
An explicit request only to download or install the skill package remains
limited to that request.

Use the fixed research configuration exactly. Do not interview the user about
fonts, sizes, themes, spacing, or monitor dimensions. Do not add adjustable
presets. Read [resources/preset.md](resources/preset.md) and
[resources/application.md](resources/application.md), then execute the workflow
below. Resolve scripts and resources relative to this skill's directory.

## Discover and run

1. Inspect the operating system, running applications, installed supported
   applications, and active configuration paths. With no explicit application
   restriction, apply to **every installed supported application**: Ghostty,
   iTerm2, macOS Terminal, and VS Code as available on that platform. Include
   applications specifically requested by the user, installing them if missing.
   Do not ask the user to choose among applications that can be discovered.
   Missing optional applications do not prevent configuring the ones present.
   If none are supported, explain the concrete limitation and ask which
   supported application to install; do not report success.
2. Locate the configuration actually used by each application, including named
   VS Code profiles, XDG paths, includes, and symlinks. Preserve backups and
   record preference values as described in the application resource. Follow
   applicable desktop configuration rules without turning routine setup into
   an additional approval step.
3. **Run** the applicable dependency installers and configuration scripts in
   order. Install missing fonts and helper dependencies as part of the task.
   If the platform needs a different installation mechanism, perform the
   equivalent installation using the same packages and fixed resource values.
   A platform-specific shell script is a convenience, not a reason to stop
   after copying its files. Do not substitute a different font or theme.
4. Apply the macOS smoothing preference once and the matching dark-titlebar
   script for each selected native terminal. Mention that smoothing changes a
   global preference as part of the setup update; do not ask again for routine
   setup already requested. Keep standard-titlebar scripts for explicit reversal.
5. **Activate the result now**, using the application-specific steps in
   `resources/application.md`. Select the Easy Reader profile, reload settings,
   open a configured window, or restart the application as needed. Merely
   writing a profile file is insufficient. Do not terminate active work or
   discard unsaved buffers to force a restart. If a required restart cannot be
   completed safely, finish the remaining work and clearly report that specific
   activation step as pending rather than claiming full success.
6. Verify the effective settings and visible result in each target application.
   Check the installed font rather than a fallback, fixed size and weight,
   Dracula colors, spacing, and steady block cursor. Use available application
   inspection or desktop tools; do not infer visible success from an exit code.
   If GUI access is unavailable, verify files and available runtime state and
   state that visual verification remains unavailable.

## Completion

Success means the requested configuration has been executed and activated on
the machine, not that the skill is installed or the scripts are ready. Report
applications configured, dependencies installed or already present, activation
performed, and verification evidence. Explicitly identify partial failures or
pending activation; continue independent setup steps when one application is
blocked. Never label a copy-only operation as applying Easy Reader.

Font files must be installed on each device; settings synchronization alone
is insufficient. Preserve all research values and application-specific naming.
Report unsupported settings rather than inventing replacements. Do not store
personal details or display specifications in the skill or its resources.
