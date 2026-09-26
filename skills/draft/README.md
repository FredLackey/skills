# Draft Skills

Skills in this level are still in development and are not ready for general
use.

## `setup-skills-repo`

Creates or reorganizes a portable skills repository using draft, canary,
stable, imported, and legacy levels. It carries the complete public convention
and guides an agent through applying it without relying on external material.

**Current state:** Initial draft derived from the skill repository standard.
Its structure and workflow are being validated before canary promotion.

## `setup-local-source-code`

Interviews a developer about their client, GitHub, author, and SSH identities,
then creates a portable source workspace with primary clones, task worktrees,
local-only projects, durable research, and dependency-free Node.js tools.

**Current state:** Initial draft derived from the local source workspace
standard and its existing worktree-management scripts. Its generated identity
routing, GitHub CLI onboarding, dual-use SSH key registration, and locally
enforced signing behavior are being validated before canary promotion.

## `setup-shared-skills`

Makes shared local installation the default for ordinary skill-install
requests. Follows the `setup-local-source-code` workspace convention, connects
selected AI harnesses to complete skill folders through symlinks or supported
direct paths, and registers its own guidance alongside the requested skills.
Includes a preview-first link helper that preserves conflicting installations.

**Current state:** Initial draft with automatic discovery enabled. Link behavior
is covered by isolated tests; product discovery and platform support must be
verified on each target computer before reporting installation success.
See [the skill](setup-shared-skills/SKILL.md) for setup and update guidance.

## `setup-multi-herdr`

Discovers Herdr-capable machines across Tailscale and directly connected local
networks, reports causal SSH/Herdr issues, offers separately approved Linux and
macOS repairs, correlates alternate routes to the same logical host, and
configures Herdr's native multi-machine SSH profiles through a digest-bound
plan.

See the [human guide](setup-multi-herdr/docs/README.md) for capabilities,
requirements, safety boundaries, and usage examples.

**Current state:** Explicit-only draft based on Herdr 0.9's saved-machine CLI.
Its prerequisite-first discovery, destination-user-safe probing, causal
diagnostics, one-action resolver, target-local doctor, privacy controls, and
interactive apply workflow are being validated before canary promotion.

## `easy-reader-terminal`

Applies the fixed Easy Reader font, Dracula theme, spacing, cursor, and
appearance settings to iTerm2, Ghostty, macOS Terminal, and VS Code without
requiring a particular monitor size or model. Includes the setup scripts and
self-contained static profile resources.

**Current state:** Initial draft ported from the established research presets.
See [the skill](easy-reader-terminal/SKILL.md) for its application workflow.
