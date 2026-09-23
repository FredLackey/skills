# Herdr multi-machine setup reference

Read this reference before using the bundled manifest/bond or
preflight/discovery/resolve/apply helper.

## Product behavior

Herdr 0.9 introduced native multi-machine connections. One Linux or macOS
client displays its implicit `Local` endpoint and saved SSH machines in one UI.
Every machine still owns its own Herdr server, sessions, processes, workspaces,
panes, and agent IDs. A failed connection to one machine does not disconnect
the others.

Official sources:

- [Connecting machines](https://herdr.dev/docs/connecting-machines/)
- [Persistence and remote access](https://herdr.dev/docs/persistence-remote/)
- [CLI reference](https://herdr.dev/docs/cli-reference/#saved-ssh-machines)
- [Install and update](https://herdr.dev/docs/install/)
- [Herdr 0.9.0 release](https://github.com/herdrdev/herdr/releases/tag/v0.9.0)

A saved profile represents one SSH target and one remote Herdr session. The
supported commands are:

```text
herdr machine list --json
herdr machine add TARGET --label LABEL [--remote-session SESSION]
herdr machine rename PROFILE_ID --label LABEL
herdr machine disable PROFILE_ID
herdr machine enable PROFILE_ID
herdr machine remove PROFILE_ID
```

List output is an array of `{id,label,target,session,enabled,selected}`. IDs are
opaque and must come from `machine list`. There is no `machine update` command.
Changing a target or session safely means adding and verifying a replacement,
then separately approving any disable/remove of the old profile.

## Discovery-derived planning and bonding

For ordinary new-client setup, first discover current environment state and
then derive a complete plan. The skill contains no inventory, account, route,
or key defaults. Existing profiles, Tailscale and LAN observations, SSH aliases
and effective configuration, and local public-key metadata are collected anew
for every run.

The displayed plan is the single approval object. It contains every included
machine, exact SSH target, Herdr label, remote session, selected public-key
fingerprint or proposed key generation (including path and passphrase policy),
SSH authorization method, host-trust action, and Herdr catalog action. The
private manifest is the executable subset of that approved plan. Its canonical
digest is independent of machine ordering and guards that subset against drift;
it does not create a second user approval step.

This deliberately trades a separate fingerprint ceremony for SSH trust on
first use. It is appropriate when the user has deliberately selected the
targets and wants low-friction bonding on a new client. OpenSSH still rejects
changed or revoked keys; the helper never uses `StrictHostKeyChecking=no`,
deletes known-host entries, or suppresses authentication failures.

After any displayed credential challenge, `bond` is fully noninteractive. It
can authorize the selected Herdr key through an approved management identity or
invoke `ssh-copy-id` once in the user's terminal. It then installs or updates
Herdr from the official stable installer before calling `herdr machine add`.
When the approved plan identifies an incompatible running server, bond may stop
that server and its panes before replacement. These effects belong to the one
displayed plan and never create separate approval prompts.

The manifest schema is `setup-multi-herdr/manifest-v3`. Values below are
placeholders, never defaults:

```json
{
  "schema": "setup-multi-herdr/manifest-v3",
  "hostKeyPolicy": "accept-new",
  "remoteSetup": "install-or-update",
  "machines": [
    {
      "target": "<user>@<host>",
      "label": "<label>",
      "session": "default",
      "identity": "<identity>",
      "identityFingerprint": "SHA256:<herdr-key-fingerprint>",
      "transport": "tailscale",
      "tailscale": {
        "expectedIp": "<tailscale-ipv4>",
        "ensureSsh": false
      },
      "allowServerStop": true,
      "bootstrap": {
        "method": "management-identity",
        "target": "<user>@<management-host>",
        "identityFile": "/absolute/path/to/management-key",
        "identityFingerprint": "SHA256:<fingerprint>"
      }
    }
  ]
}
```

Identity values are private-key basenames under the user's `.ssh` directory;
the helper requires a matching public key and secure private-file permissions.
`identityFingerprint` binds the exact selected key into the approval digest and
is rechecked immediately before use. The helper lists only the name, algorithm,
and public fingerprint for confirmation and never emits private-key contents. Bond probes pass the selected private key
explicitly with `IdentitiesOnly=yes`; catalog commands use an isolated,
short-lived SSH agent containing only that key. A management identity may live
elsewhere, but its absolute path and public fingerprint must be displayed and
digest-bound. Bond stages it with mode `0600` without changing its source.

The short-lived agent is only for setup. Herdr reconnects to saved machines
after that process exits, so each approved target also requires a persistent,
exact-host client SSH entry selecting the same key with `IdentityFile`,
`IdentitiesOnly yes`, and `BatchMode yes`. The bundled bond helper installs
those entries idempotently while preserving unrelated SSH configuration. Bond's
final readiness probe removes `SSH_AUTH_SOCK` and refuses success unless the
persistent route authenticates and finds a usable remote Herdr installation.

`transport: "tailscale"` requires the authenticated endpoint to report an
active Tailscale IPv4 address and the effective SSH hostname to resolve to that
address. `ensureSsh` defaults to false, preserving the target's current SSH
mode. `ensureSsh: true` authorizes the helper to ensure ordinary OpenSSH over
the tailnet, explicitly disabling Tailscale SSH interception so Herdr can use
its unattended public-key identity. The plan must display any needed Tailscale login
or policy work. Tailscale authentication challenges may occur at the beginning
of execution, but a missing client, unreachable endpoint, or tailnet policy
denial is a concrete blocker rather than a reason to fall back silently to a
public long-lived Herdr route.

Identity selection is evidence-based. Prefer a key already proven to
authenticate to the target, followed by an identity selected by that target's
effective SSH configuration. The existence of a key used for Git hosting does
not prove that the target authorizes it. If multiple local identities are
equally plausible, propose a deterministic dedicated Herdr identity rather
than choosing arbitrarily. If a reliable username cannot be derived from an
existing profile, explicit hint, or reviewed SSH alias, expose it as one
unresolved field in the plan and do not probe a guessed account.

The user reviews and confirms the entire plan once. That confirmation covers
the displayed key generation, first-seen host trust, public-key installation,
Tailscale transport work, stable Herdr installation/update, incompatible
server replacement (including the displayed pane-stoppage risk), and Herdr
add/rename/enable actions. Password, passphrase, MFA, and
identity-provider prompts may still be presented directly during execution;
they are credential challenges, not new planning approvals. Never collect
their contents in chat.

Labels are unique case-insensitively, and target/session pairs are unique. The
helper canonicalizes manifest order before hashing. Keep manifests private
because they contain live infrastructure names.

Saved machines are private client state, not `config.toml`. Do not edit
`endpoints.json` directly. Open clients normally observe CLI catalog changes
automatically. Removing or disabling a profile leaves its remote processes
running, but those actions still require explicit approval.

`machine add` prepares the requested remote session before saving the profile.
The helper avoids its interactive install/replacement questions by performing
the approved stable installation/update first. Replacement may stop all panes
on an incompatible server, so that possibility must be stated in the single
plan. Compatible client and server version strings do not need to be identical;
the helper only pre-stops a running server when the detected major/minor line
differs from the local client.

Multi-machine clients and SSH targets are currently supported on Linux and
macOS; remote targets may be x86_64 or aarch64. Windows still supports a single
`herdr --remote` attachment but is not a supported multi-machine client or
native remote target.

For an already-saved machine that later needs attention (a network
interruption, sleep, or SSH failure the automatic bounded-backoff retry did
not resolve), Herdr's documented recovery path is `herdr --remote TARGET`,
run interactively for that same target. This is a separate use of `--remote`
from the Windows single-machine fallback above; on Linux/macOS it is the
supported way to walk back through interactive setup for a machine already in
the catalog. The helper does not run this automatically.

## What discovery can prove

Herdr has no LAN or Tailscale discovery service. Its API is local socket based,
and remote attachment uses ordinary SSH stdio. The helper records each stage
separately: candidate availability, name resolution, TCP transport, SSH trust,
authentication, remote command execution, platform support, and Herdr state.
Every downstream `not-checked` value names the issue that blocked it.

Important distinctions include DNS not found/temporary failure; TCP refused,
timed out, or unroutable; unknown, changed, or revoked host trust; interactive,
rejected, policy-denied, or signing-failed authentication; malformed remote
probe output; unsupported OS/architecture; and remote Herdr missing, installed,
or running. OpenSSH diagnostics are free-form rather than a stable API, so
stderr-derived classifications are marked heuristic and always retain an
honest `ssh.unknown-failure` fallback.

Discovery uses `tailscale status --json` only when an installed CLI can return
it. The JSON format is explicitly unstable, so absence or malformed data must
degrade visibly rather than being guessed. Tailscale supplies candidate devices
and routes; it does not prove SSH authorization or Herdr.

The default LAN scan covers private IPv4 on directly attached, non-virtual
interfaces. A connected prefix broader than `/24` is limited to the local `/24`
slice, with known neighbors also considered. IPv6 is never brute-forced. The
helper excludes loopback, link-local, Tailscale, tunnel, container, bridge, and
common VM interfaces by default. Explicit CIDRs remain private and are capped
at 1,024 addresses.

The scan can miss sleeping or offline peers, ACL-blocked SSH, unknown host keys,
interactive authentication, nonstandard SSH ports, nodes outside a selected
slice, IPv6 nodes absent from known data, VLAN/routed networks, and hosts behind
a jump without an explicit SSH target. Describe the observed scope rather than
claiming completeness.

An automatically discovered IP or DNS name does not identify a target OS
account. Ordinary `ssh HOST` uses the source computer's local account name as
the default destination username; Tailscale does not make the destination OS
account obsolete. Auto-discovered routes are therefore TCP-only until the user
supplies `USER@HOST`, an existing saved target, or a reviewed SSH alias. The
helper must not turn authentication against a guessed username into a scan.

An explicit or already-saved target may intentionally use the user's SSH
configuration. Only those routes may later be enriched with allowlisted
effective configuration such as user, host, port, identity count, or jump
presence. Never publish full `ssh -G` output, key paths, proxy commands, or raw
verbose logs. A raw auto-discovered name must not be fed through wildcard
`Match exec` or `ProxyCommand` behavior without an explicit user choice.

## Identity, routes, and names

The useful identity boundary is a logical OS/SSH endpoint, not physical
hardware. A VM and its host remain distinct. A jump host is transport, not the
identity of the final Herdr server.

The helper excludes the Tailscale `Self` record and local interface addresses.
It merges routes automatically only when the tailnet record is the same or
strict authenticated probes return the same privacy-hashed OS identity. A
hostname, IP, public NAT address, Herdr version, or unauthenticated host-key scan
is only a hint. Conflicting or weak evidence stays visible for user review.

Preferred routes are, in order: an explicitly supplied or existing SSH alias,
MagicDNS, Tailscale IP, then LAN IP, provided the route authenticated. Alternate
routes stay in the report but do not become duplicate profiles.

For a nonstandard port, the helper records the effective port in the approved
action and saves the target in `ssh://user@host:PORT` form. That same port is
used for discovery and apply-time identity revalidation.

The proposed local name is derived from Tailscale Self hostname or the OS
hostname, normalized to lowercase kebab case, made stable and unique with a
short digest suffix when necessary, and never persisted as a fictitious Herdr
setting. Remote labels preserve an existing user label for exact matches.

## Diagnosis and resolution ownership

The report separates observations, issues, remediations, and Herdr catalog
actions. An issue names one responsible actor:

- the client-side user/helper for explicit usernames, host trust, agent/key
  loading, interactive authentication, and local Herdr ownership;
- a target-local user/administrator for OpenSSH Server, Apple Remote Login,
  account allow lists, or target authorization;
- a network/tailnet administrator for grants, ACLs, cloud firewalls, or managed
  policy; or
- Herdr itself for remote binary/session preparation once strict SSH succeeds.

`doctor --target TARGET` performs a narrow strict client-side diagnosis.
`doctor --host` runs locally on a prospective Linux or macOS target. On Linux it
detects the distribution, SSH server executable, listener, and the actual
`ssh.service`/`sshd.service` or socket unit before offering a package/service
action. On macOS it uses Apple Remote Login state plus listener evidence; macOS
SSH is socket activated, so absence of a persistent `sshd` process is not a
failure. Preserve the Remote Login user allow list.

Tailscale as a network transport is distinct from Tailscale SSH. Tailscale SSH
still selects an existing destination OS user. Only Linux and the open-source
macOS `tailscale` + `tailscaled` variant can act as Tailscale SSH servers; normal
App Store/Standalone Mac targets use Apple Remote Login over the tailnet. Never
offer `tailscale set --ssh` merely because a GUI Mac has Tailscale installed.

`resolve` accepts one remediation ID and its own digest from a private report.
It reconstructs an allowlisted command, requires a TTY, and never executes a
free-form command stored in JSON. Initial operations cover interactive SSH,
detected Linux OpenSSH packages/service units, Apple Remote Login, and
Homebrew/mise-managed Herdr. Changed/revoked trust, ambiguous package ownership,
authorization files, firewalls, and external policies remain explicit handoffs.
After any resolution attempt the old report is stale and fresh discovery is
mandatory.

## Helper contract

`preflight`, `discover`, `list-identities`, and both doctor modes are read-only and emit schema
`setup-multi-herdr/v2`. Preflight stops before any network scan when local SSH,
Herdr, its machine catalog, or the client platform is blocked. A blocked or
empty catalog proposal has no digest.

A ready discovery proposal contains a fingerprint of the entire current Herdr
catalog, a per-run nonce, the exact ordered actions, a fingerprint binding the
reviewable evidence, and a SHA-256 digest over deterministic mutation inputs.
Volatile timestamps do not affect the digest.

A remediation has a separate digest over its operation and validated scope.
The legacy remediation and catalog digests remain available for exceptional
diagnosis. Do not use their multi-approval sequence for ordinary bonding after
the complete plan has been confirmed.

`apply` requires the unmodified report file and matching digest. It rejects
non-regular, symlinked, oversized, or group/world-readable/writable files; unsupported
actions; unsupported platforms; catalog drift; identity drift; or a new label
collision. Actions are proposed only for an SSH-authenticated host with a stable
privacy-hashed machine identity. Apply is idempotent across successful earlier
actions, accepts only catalog changes explained by those actions when resuming,
and stops with a partial-progress report after a failed Herdr command.

The helper never stores credentials, emits private keys, dumps raw Tailscale
records, prints raw machine identifiers, answers credential prompts, weakens
host-key checking, or sends scan results off the machine. It reads only an
explicitly approved management identity long enough to fingerprint and stage
it privately for the approved bootstrap. An approved interactive SSH
repair may let the human accept an independently verified first host key;
OpenSSH owns that terminal and possible `known_hosts` write. Scanned names and
addresses belong only in the private runtime report, never in this public
repository.

The `bond` exception to strict pre-existing host trust is narrow and explicit:
an approved manifest may use OpenSSH `accept-new` for only its exact targets.
This may add first-seen keys to the user's normal `known_hosts`; it cannot
replace a conflicting key. The manifest digest replaces the legacy sequence of
per-host remediation digests plus a later catalog proposal digest for routine
bonding. The legacy discovery/resolve/apply contract remains available for
open-ended discovery and exceptional remediation.
