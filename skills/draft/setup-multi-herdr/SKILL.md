---
name: setup-multi-herdr
description: Configure a Linux or macOS Herdr client for native multi-machine SSH connections by discovering Tailscale and LAN candidates and applying an approved plan. Invoke only when the user explicitly names setup-multi-herdr or asks to run Setup Multi-Herdr; never invoke automatically for ordinary Herdr, SSH, Tailscale, or network questions.
---

# Setup Multi-Herdr

Run this skill only after an explicit request for `setup-multi-herdr` or
“Setup Multi-Herdr.” Do not infer it from a request that merely mentions Herdr,
SSH, Tailscale, remote machines, or terminal multiplexing. This skill is
provider-neutral: it works the same way under any AI coding agent capable of
invoking a named skill, and nothing in it should assume or depend on a
specific agent product.

Configure Herdr's native 0.9+ multi-machine client through an approval-gated
diagnose, resolve, rediscover, and apply loop. Read
[references/multi-machine-setup.md](references/multi-machine-setup.md) before
running it. Human-facing usage documentation is available in
[docs/README.md](docs/README.md); it does not need to be loaded during ordinary
skill execution.

## Preflight, discover, and propose

1. Run `scripts/setup-multi-herdr.mjs preflight --json`, capturing stdout in a
   newly created private temporary file when a resolver may be needed. Check
   local Herdr and SSH prerequisites before scanning any network. If `outcome` is
   `prerequisite-blocked`, explain each structured issue and its exact next
   owner/action. Do not run discovery or show a catalog proposal.
2. When preflight is ready, run `scripts/setup-multi-herdr.mjs discover --json`,
   capturing stdout in a
   newly created private temporary file. Ensure the directory and file are
   accessible only to the current user. Do not place live scan results in a
   repository, chat attachment, or shared location.
3. If useful, repeat discovery with a user-directed bounded `--cidr`,
   `--interface`, or `--target`. Expanded scope is a new network scan; explain
   it before running it. An automatically discovered IP or DNS name has no
   destination-user semantics and remains TCP-only. Never turn the source
   computer's local username into a guessed target username. Ask the user for
   `USER@HOST`, an existing saved target, or a deliberately selected SSH alias.
4. Present a concise table from the report: proposed label, platform, Herdr
   state/version, preferred SSH target, alternate routes, correlation evidence,
   existing-profile match, causal issues, and exact proposed actions. Treat
   `proposal.approval.actions` as authoritative; the helper binds the displayed
   report evidence to those actions with `reviewFingerprint`.
5. For every blocked route, state the failed stage, stable reason code, what was
   observed, why Herdr was not checked, who owns the next step, and any
   allowlisted remediation. Never reduce the result to “SSH attention required”
   or “Herdr unverified.” A Tailscale peer or open SSH port is only a candidate;
   Herdr is confirmed only by strict authenticated SSH.
6. Identify the current machine as `Local (proposed-name)`. The parenthetical
   name is advisory: Herdr 0.9 always displays the current endpoint as `Local`
   and provides no supported command for renaming it.
7. Show a catalog proposal digest only when `proposal.state` is `ready` and its
   action list is non-empty. Ask the user to approve the exact targets, labels,
   sessions, and actions. Stop without applying until that approval is received.

Discovery must not edit Herdr or SSH state, accept host keys, install or update
software, start or stop servers, log into Tailscale, or request credentials.

## Resolve causal issues

For a narrow explicit target, use `scripts/setup-multi-herdr.mjs doctor
--target TARGET --json`. If SSH itself is unavailable and the user can operate
the target's console, have them run `scripts/setup-multi-herdr.mjs doctor
--host --json` locally on that Linux or macOS target. A client-side timeout or
refusal cannot prove that `sshd` or Apple Remote Login is off.

When a report offers a remediation, show its summary, actor, possible changes,
ID, and exact digest. After the user approves that one repair, run:

```text
scripts/setup-multi-herdr.mjs resolve \
  --report PRIVATE_REPORT_FILE \
  --remediation REMEDIATION_ID \
  --approve sha256:APPROVED_REMEDIATION_DIGEST
```

`resolve` dispatches only allowlisted operations. It attaches SSH, package
manager, `sudo`, and authentication prompts to the user's terminal and never
answers or captures them. First host trust requires the user to verify the
fingerprint independently. Changed or revoked keys, broad firewall/policy
changes, target-account authorization, and unsupported platforms are explicit
handoffs, not automatic repairs.

Discard the old report after every repair attempt and run fresh preflight or
discovery. Remove superseded private reports when safe. A remediation approval
never approves a Herdr catalog action. Limit
the automatic resolve/rediscover loop to three cycles; then report the
remaining owner and evidence rather than oscillating.

For local Herdr, identify installation ownership. `herdr update` is only for a
verified direct install; Homebrew, mise, and Nix update through their package
managers. Do not replace ambiguous or distribution-owned binaries. For an
authenticated supported remote with Herdr missing or not running, do not invent
a separate package repair: Herdr's interactive `machine add` is the supported
installer/session-preparation authority.

## Apply an approved proposal

After the user approves the exact digest, run:

```text
scripts/setup-multi-herdr.mjs apply \
  --proposal PRIVATE_REPORT_FILE \
  --approve sha256:APPROVED_DIGEST
```

Run the command in an interactive terminal. The helper refuses a real
`machine add` when stdin or stdout is not a TTY.

The helper rejects catalog drift and uses only `herdr machine add`, `rename`,
or `enable`; it never edits Herdr's private endpoint catalog. `machine add` must
remain attached to an interactive terminal. It may separately ask to install a
remote binary or replace an incompatible running server. Replacement can stop
that server and every pane process it owns. Do not answer that prompt for the
user, pipe confirmation, or add `--handoff`.

Stop on any stale state or failed action. Report completed and pending actions.
The same approved private report may resume after partial success only when the
catalog changes are exactly the actions it authorized; otherwise rerun
discovery. Preserve unrelated profiles and settings; never disable or remove a
profile as automatic cleanup.

After apply, verify the complete result with `herdr machine list --json` and
report saved profiles separately from live connectivity. An enabled saved
profile may still require attention in the TUI; if so, tell the user the
documented recovery command is `herdr --remote TARGET`, run interactively for
that machine — do not run it on the user's behalf. Remove the private
temporary proposal after verification when it is safe to do so.
