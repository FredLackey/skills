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

## `setup-multi-herdr`

Bonds a confirmed list of machines in one run, using trust-on-first-use for
those exact SSH targets and a digest-bound machine manifest. After one plan
confirmation it can bootstrap SSH/Tailscale access, install or update remote
Herdr, replace an incompatible server when disclosed, and reconcile the local
catalog. It can also discover candidates across Tailscale and directly
connected local networks when the desired list is not yet known.

See the [human guide](setup-multi-herdr/docs/README.md) for capabilities,
requirements, safety boundaries, and usage examples.

**Current state:** Explicit-only draft based on Herdr 0.9's saved-machine CLI.
Its confirmed-manifest bond path, `accept-new` trust boundary, fingerprint-bound
management bootstrap, isolated SSH-agent use, headless remote lifecycle,
noninteractive catalog reconciliation, causal diagnostics, privacy controls,
and legacy discovery/repair path are being validated before canary promotion.
