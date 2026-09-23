# Setup Multi-Herdr

Setup Multi-Herdr is an explicit-only skill for connecting one Herdr client to
Herdr sessions on other Linux or macOS machines. It discovers the current
environment, devises a complete bonding plan, asks for one confirmation, and
then carries out the approved plan.

The skill does not run automatically. It must be invoked by name, and works
with any AI coding agent that supports invoking named skills.

## What it accomplishes

The skill can:

- detect whether Herdr, SSH, and Tailscale are available locally, and whether
  the local Herdr installation meets the 0.9+ version required for native
  multi-machine support—stopping with a plain explanation instead of
  proceeding when it does not;
- read the visible Tailscale peer inventory without using an API token;
- perform a bounded scan of private IPv4 networks attached to the computer;
- keep automatically discovered addresses TCP-only until a destination OS user
  or reviewed SSH alias is supplied;
- check explicit/saved targets through strict, non-interactive SSH;
- distinguish DNS, transport, host-trust, authentication, remote-command,
  platform, missing-Herdr, installed-Herdr, and running-Herdr states;
- correlate Tailscale, MagicDNS, SSH-alias, and LAN routes using Tailscale node
  identity or a privacy-hashed operating-system machine identity;
- propose stable labels and a preferred SSH route while retaining alternates;
- compare discoveries with existing saved Herdr machines; and
- add or enable approved machines with Herdr's supported `herdr machine`
  commands.

Herdr 0.9 displays the current computer as `Local`. Herdr does not provide a
supported way to rename that entry, so the skill's proposed local machine name
is advisory—the name another computer could use when saving this machine.

## One-plan workflow

The skill contains no machine inventory, account names, routes, key names, or
identity mappings. Each run inventories saved Herdr profiles, bounded network
candidates, Tailscale peers, SSH aliases and effective configuration, and
reusable local keypairs. User-supplied names are treated only as discovery
hints.

Your agent correlates that evidence and presents one complete plan. It shows
every included target and every proposed username, route, label, session,
public-key fingerprint, SSH authorization method, host-trust action, and Herdr
catalog action. Excluded and unresolved candidates are also explained.

Identity selection is evidence-based: a key already proven to authenticate is
preferred, followed by one selected by effective SSH configuration. Existing
Git-hosting keys may be reused but are never presumed authorized merely because
they exist. If several keys are equally plausible, the plan proposes a
dedicated Herdr key rather than choosing one arbitrarily.

After the single confirmation, the helper bootstraps each selected identity,
passes it explicitly with `IdentitiesOnly=yes`, ensures the approved Tailscale
route is active, installs or updates stable Herdr remotely, and updates the
catalog without per-host or per-action approvals. First-seen host keys use
OpenSSH `accept-new`; changed keys still fail. Machines with genuine external
blockers are reported individually while the remaining machines continue.

If the selected public key is not yet authorized on a target, the approved plan
uses an already-authorized management channel when one exists, or `ssh-copy-id`
in a visible terminal. Password, MFA, passphrase, and identity-provider prompts
remain with the human and are never collected in chat. They are credential
challenges, not additional planning approvals. The unchanged plan is resumed
after authorization without another confirmation.

Password, passphrase, MFA, and identity-provider prompts remain visible and are
never captured. Once that initial credential phase succeeds, installation,
update, incompatible-server replacement, session preparation, and catalog
bonding are headless. The one plan must disclose that replacing an incompatible
running server can stop its panes.

## Discovery and diagnosis

Discovery always precedes the plan, whether or not the user supplied candidate
names. The diagnose, resolve, rediscover, and apply commands remain available
for exceptional failures.

Before scanning, the helper runs a local preflight for OpenSSH and Herdr's
functional `machine` catalog. A blocked preflight performs no network scan and
creates no catalog digest.

### Discovery and proposal

Discovery is read-only. The helper inventories the local Herdr installation,
saved profiles, Tailscale peers, and a bounded set of LAN addresses. Candidate
machines are considered confirmed only after an already-authorized SSH
connection returns the remote platform, architecture, Herdr state, and a
stable machine identity.

Before anything else, the skill checks the local Herdr installation itself. If
Herdr is missing, or installed at a version that predates native multi-machine
support (older than 0.9), it explains that plainly—naming the detected version
when there is one, and pointing to the official installation/update guide—and
stops. It does not present a candidate table or a proposal digest until that
local prerequisite is met.

The result is stored in a private report and summarized for review. It includes
the proposed local name, discovered nodes, alternate routes, existing-profile
matches, causal issues, responsible owners, allowlisted remediations, and exact
proposed catalog actions.

Automatically discovered addresses are TCP candidates, not complete SSH
targets. Tailscale does not eliminate the destination OS account: ordinary
`ssh HOST` would use the source computer's local username as the destination
username. The helper does not make that guess. Supply `USER@HOST`, an existing
saved target, or a reviewed SSH alias before authenticated probing.

The mutation inputs and review evidence are protected by a SHA-256 digest. No
configuration changes occur during this phase.

### Resolve, verify, and apply

The report distinguishes name resolution, TCP transport, host trust,
authentication, remote command execution, platform support, and Herdr state.
For common client-side conditions it can offer one digest-bound interactive
repair. OpenSSH or the package manager owns the terminal; the helper never
answers a host-key, password, passphrase, MFA, or Tailscale check prompt.

When SSH is unavailable, run the target-local host doctor at the Linux or macOS
console. It can distinguish a missing/stopped Linux SSH service from Apple
Remote Login state and offer only platform-detected repairs. Network policy,
changed host keys, and account authorization remain explicit administrator
handoffs. Every repair requires fresh discovery.

After the human approves the exact digest and actions, the helper rechecks:

- that the private report has not changed;
- that the saved Herdr catalog has not changed unexpectedly;
- that every target still resolves to the same authenticated machine; and
- that no new label collision has appeared.

It then invokes only supported Herdr commands such as `herdr machine add` and
`herdr machine enable`. The helper does not edit Herdr's private catalog files.

The helper performs the approved remote install/update before `machine add`, so
Herdr's own installation and replacement prompts are not part of execution.
It uses an isolated SSH agent for the catalog command and verifies the saved
profile afterward. Replacement of an incompatible server may stop that server
and the pane processes it owns, which is disclosed in the single plan.

## Requirements

- A Linux or macOS computer acting as the Herdr client.
- Herdr 0.9 or newer for native saved-machine support.
- OpenSSH client tools.
- A known destination OS username or reviewed SSH alias for each machine.
- A way to satisfy any credential challenge needed to install the selected
  public key. Routine bonding is passwordless after that bootstrap.
- Tailscale is optional. When it is installed and running, its visible peers
  are included automatically.

Remote machines must be Linux or macOS on x86-64 or ARM64. Discovery remains
read-only. Execution may accept first-seen keys, request the displayed initial
credentials, and complete the approved Tailscale, SSH, and Herdr setup without
a second approval; it never answers or captures credential prompts.

## How to use it

Invoke the skill explicitly:

```text
Use setup-multi-herdr to discover and bond my Herdr machines.
```

You can include candidate names, a network interface, or a CIDR as discovery
hints. Your agent still derives and presents the full plan once. After
confirmation it performs the approved SSH and Herdr actions and reports
successes and blockers separately.

For example:

```text
Use setup-multi-herdr and scan only interface <interface>.
```

```text
Use setup-multi-herdr and also inspect SSH alias <alias>.
```

```text
Use setup-multi-herdr and include <private-cidr> in the LAN scan.
```

The skill explains exactly where setup stopped and why Herdr was not checked.
After an approved repair or administrator handoff, invoke it again to generate
a fresh proposal.

## Using the helper directly

The public scripts contain no host inventory or workstation paths. The skill
discovers the current environment and writes a private manifest containing
that user's selected targets, usernames, identities, and management routes.
Keep that file outside the published package. SSH persistence is implemented
inside the helper and is derived only from the approved manifest.

The bundled `scripts/setup-herdr-targets.sh` accepts `--manifest FILE --approve
sha256:DIGEST` (and optionally `--dry-run`). It finds its sibling Node helper
relative to its own location; a standalone copy can use `HERDR_SETUP_HELPER`.
No organization, cloud provider, tailnet, login account, key name, or machine
count is assumed. Tailscale SSH mode is preserved unless the plan explicitly
requests changing it. Existing network authorization is still required.

Most people should invoke the skill through their AI agent. For inspection or
testing, the bundled dependency-free Node.js helper can also be run from this
skill folder:

```text
scripts/setup-multi-herdr.mjs discover --json
scripts/setup-multi-herdr.mjs discover --target <ssh-alias> --interface <interface>
scripts/setup-multi-herdr.mjs discover --cidr <private-cidr>
scripts/setup-multi-herdr.mjs doctor --target <user>@<host> --json
scripts/setup-multi-herdr.mjs doctor --host --json
```

For confirmed-manifest bonding:

```text
scripts/setup-multi-herdr.mjs list-identities --json
scripts/setup-multi-herdr.mjs manifest-digest --manifest /path/to/private-manifest.json
scripts/setup-multi-herdr.mjs bond \
  --manifest /path/to/private-manifest.json \
  --approve sha256:CONFIRMED_MANIFEST_DIGEST \
  --json
```

Discovery reports can contain private hostnames and addresses. Redirect JSON
only to a newly created file owned by the current user with mode `0600`, and
delete it after use.

An approved report is applied from an interactive terminal:

```text
scripts/setup-multi-herdr.mjs apply \
  --proposal /path/to/private-report.json \
  --approve sha256:APPROVED_DIGEST
```

An offered repair is also run from an interactive terminal, using its separate
digest:

```text
scripts/setup-multi-herdr.mjs resolve \
  --report /path/to/private-report.json \
  --remediation remediation:OPERATION:ID \
  --approve sha256:APPROVED_REMEDIATION_DIGEST
```

For the legacy proposal path, use `--dry-run` to revalidate the report and
targets without changing the Herdr catalog. Legacy `apply` refuses a real
`machine add` when stdin or stdout is not a TTY. The manifest-based `bond` path
is intentionally noninteractive: it ignores stdin and reports
`remote.herdr.install-or-update-failed` if the approved remote setup cannot
finish.

Additional implementation and safety details are documented in
[the multi-machine setup reference](../references/multi-machine-setup.md).

## Important limitations

There is no Herdr network-discovery service or Herdr TCP port to scan. The
helper discovers candidate computers and confirms them over SSH. It can miss
sleeping, offline, firewalled, ACL-blocked, IPv6-only, routed, or nonstandard
SSH hosts unless the relevant interface, CIDR, port, or SSH target is supplied.

An enabled saved machine can still fail to connect later because of changing
network or SSH conditions. The final verification distinguishes a saved Herdr
profile from live connectivity.
