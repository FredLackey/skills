# Draft Skills

Skills in this channel are still in development and are not ready for general
use.

## `zulip-admin`

Onboards human teammates and agents, provisions separate credentials and CLI
profiles, and maintains account details, roles, and channel/group access.
Checks for the latest Zulip CLI release at the start of each session.

**Current state:** Initial lightweight draft. Command examples checked against
CLI 0.0.2; practical skill usage is still being validated.
See [Zulip Admin](zulip-admin/SKILL.md).

## `zulip-user`

Guides everyday human and agent communication: finding messages, DMs, channel
topics, replies, attachments, and emoji reactions. Includes profile setup,
session-start CLI updates, and basic recurring event handling.

**Current state:** Initial lightweight draft. Command examples checked against
CLI 0.0.2; practical skill usage is still being validated.
See [Zulip User](zulip-user/SKILL.md).

## `setup-skills-repo`

Creates or reorganizes a portable skills repository using draft, canary,
stable, imported, and legacy levels. It carries the complete public convention
and guides an agent through applying it without relying on external material.

**Current state:** Initial draft derived from the skill repository standard.
Its structure and workflow are being validated before canary promotion.

## `setup-local-source-code`

Configures a portable source workspace with repository-selected native Git/SSH
identities, mandatory SSH signing defaults, optional task worktrees, durable
research, and a shared host-neutral command surface. Persona key filenames and
proper machine/date registration labels are validated by the tooling. Personal
values and account credentials remain in external workstation configuration.

**Current state:** Draft. Schema version 2 adds remote-based identity selection,
explicit repository bindings, endpoint/signing checks, historical signature trust,
and one workflow for all configured hosts. Existing installations need a reviewed
configuration migration before updated helpers are deployed.

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
