# Setup Multi-Herdr

Setup Multi-Herdr is an explicit-only skill for connecting one Herdr client to
Herdr sessions on other Linux or macOS machines. It discovers likely machines
on Tailscale and directly connected local networks, determines when different
network addresses refer to the same machine, and prepares an approval-gated
plan using Herdr's native multi-machine support.

The skill does not run automatically. It must be invoked by name, and works
with any AI coding agent that supports invoking named skills.

All account names, hostnames, and network ranges in the examples are fictional.
Replace them with values appropriate to your own environment.

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

## How it works

Setup uses a diagnose, resolve, rediscover, and apply loop.

Before scanning, the helper runs a local preflight for OpenSSH and Herdr's
functional `machine` catalog. A blocked preflight performs no network scan and
creates no catalog digest.

### 1. Discovery and proposal

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

### 2. Resolve, verify, and apply

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

`machine add` remains connected to the interactive terminal because Herdr may
ask whether it should install a remote binary or replace an incompatible
server. The skill never answers that prompt automatically. Replacement may
stop the remote Herdr server and the pane processes it owns.

## Requirements

- A Linux or macOS computer acting as the Herdr client.
- Herdr 0.9 or newer for native saved-machine support.
- OpenSSH client tools.
- A known destination OS username or reviewed SSH alias for each machine. The
  resolver can walk through first trust or interactive authentication when
  required.
- Tailscale is optional. When it is installed and running, its visible peers
  are included automatically.

Remote machines must be Linux or macOS on x86-64 or ARM64. Discovery will not
accept host keys, edit SSH configuration, request credentials, or log into
Tailscale. A separately approved resolver launches the relevant tool in the
user's terminal without answering or capturing its prompts.

## How to use it

Invoke the skill explicitly:

```text
Use setup-multi-herdr to discover and configure my Herdr machines.
```

Your agent will run preflight and discovery, then present a review table. Check
the causes, owners, proposed labels, targets, sessions, correlations, repairs,
and catalog actions. Repair and catalog approvals use separate exact digests;
approval of either never authorizes a later or modified proposal.

Useful scoped requests include:

```text
Use setup-multi-herdr and scan only interface en0.
```

```text
Use setup-multi-herdr and also check my existing SSH alias workbox.
```

```text
Use setup-multi-herdr and include 192.168.50.0/24 in the LAN scan.
```

The skill explains exactly where setup stopped and why Herdr was not checked.
After an approved repair or administrator handoff, invoke it again to generate
a fresh proposal.

## Using the helper directly

Most people should invoke the skill through their AI agent. For inspection or
testing, the bundled dependency-free Node.js helper can also be run from this
skill folder:

```text
scripts/setup-multi-herdr.mjs discover --json
scripts/setup-multi-herdr.mjs discover --target workbox --interface en0
scripts/setup-multi-herdr.mjs discover --cidr 192.168.50.0/24
scripts/setup-multi-herdr.mjs doctor --target operator@workbox --json
scripts/setup-multi-herdr.mjs doctor --host --json
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

Use `--dry-run` to revalidate the report and targets without changing the Herdr
catalog. A real `machine add` is refused when stdin or stdout is not a TTY.

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
