---
name: setup-multi-herdr
description: Discover Linux or macOS Herdr machines, derive a complete bonding plan, then bootstrap SSH/Tailscale access, install or update remote Herdr, and reconcile the local catalog after one confirmation. Invoke only when the user explicitly names setup-multi-herdr or asks to run Setup Multi-Herdr.
---

# Setup Multi-Herdr

Make bonding Herdr instances painless on a new client. The normal workflow has
one human decision: approve a complete, environment-derived plan. After that
confirmation, perform first-use SSH trust, SSH authorization bootstrap, Herdr
catalog reconciliation, and verification automatically.

Read [references/multi-machine-setup.md](references/multi-machine-setup.md)
before execution. Never embed or retain machine names, account names, routes,
SSH identity names, or identity mappings in this skill. Discover them afresh
from the machine on every run. User-supplied names are discovery hints, not
skill defaults.

## Discover and devise the plan

Run private-file preflight and bounded discovery as described in the reference.
Also run `scripts/setup-multi-herdr.mjs list-identities --json`. Correlate:

- existing Herdr profiles;
- Tailscale peers and directly connected private-network candidates;
- explicit user hints and existing SSH aliases;
- effective SSH usernames, ports, jump routes, and configured identities for
  explicit or already-saved targets; and
- reusable local SSH keypairs, represented only by name, type, public
  fingerprint, and permission state.

Do not ask the user a sequence of machine, username, key, or remediation
questions. Derive the strongest safe proposal available from the evidence. For
each target, prefer an identity already proven to authenticate, then one
selected by the target's effective SSH configuration. A key created for Git
hosting is reusable but is not presumed authorized merely because it exists.
When several identities remain equally plausible, propose one deterministic
dedicated identity for Herdr access instead of guessing among them. When no
reliable destination username or route can be derived, mark that field as an
unresolved choice in the single plan rather than probing a guessed account.

The plan must show every candidate considered and, for every included machine:

- exact `USER@HOST`, `ssh://USER@HOST:PORT`, or reviewed SSH alias;
- Herdr label and remote session;
- selected identity name and public fingerprint, or the proposed new identity
  specification, including its derived unused path and whether it will be
  unencrypted for unattended use;
- first-seen host-key action, if applicable;
- exact local SSH host entries that will persist the selected identity for
  Herdr's later background connections;
- SSH authorization method: already authorized, an observed management route,
  or user-visible `ssh-copy-id`; and
- whether Tailscale transport is required, plus any target-side Tailscale
  authentication that may be presented at the beginning of execution;
- remote Herdr installation/update and whether replacing an incompatible
  running server may stop its panes; and
- exact Herdr action: none, add, rename, or enable.

Exclude the local machine and explain excluded or unresolved candidates. Keep
all discovered infrastructure details in private temporary reports and the
user-visible plan; never write them into the skill repository.

## Request one confirmation

Present the complete plan once. The user may approve it or replace values in
that same response; incorporate any replacements and treat that response as
the one confirmation. Do not request preliminary approval to discover, choose
identities, or construct the plan. Explain that confirmation authorizes these
bounded changes for only the displayed entries:

- accept a first-seen SSH host key using OpenSSH `accept-new` semantics;
- generate the displayed dedicated keypair when the plan proposes one;
- install the exact displayed public key through the displayed authorization
  method, including a user-visible password, MFA, passphrase, or identity
  provider prompt when required;
- authenticate with the selected identity, passed explicitly without requiring
  an agent;
- install the displayed, narrowly scoped local SSH host entries with
  `IdentityFile` and `IdentitiesOnly yes`;
- establish the displayed Tailscale transport and present a login/MFA challenge
  directly when the approved route requires one;
- install or update the stable Herdr release on each displayed target and stop
  an incompatible running Herdr server when required for replacement;
- add, rename, or enable the matching Herdr profile; and
- start the requested remote Herdr session as part of `herdr machine add`.

Confirmation does not authorize replacing a changed/revoked host key,
disabling or removing profiles, or making network-policy changes not displayed
in the plan. A credential or identity-provider prompt during execution is not
another approval decision: let the human answer it directly and never collect
its contents in chat. Do not ask for separate per-host, installation, update,
server-replacement, remediation, or catalog approvals after the plan is
confirmed.

## Execute the approved plan

Create a private temporary JSON file with mode `0600`:

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

Keep live hostnames and addresses out of repositories and chat attachments.
Compute the manifest digest, then immediately run `bond` with that digest. The
user's confirmation of the complete displayed plan is the approval boundary;
the digest guards its executable manifest subset and is not another prompt:

```text
scripts/setup-multi-herdr.mjs manifest-digest --manifest PRIVATE_MANIFEST
scripts/setup-multi-herdr.mjs bond \
  --manifest PRIVATE_MANIFEST \
  --approve sha256:CONFIRMED_MANIFEST_DIGEST \
  --json
```

`bond` carries out each approved SSH authorization action that is still needed.
If the plan approved a new identity, generate it first at the exact approved,
previously unused path with Ed25519, private mode `0600`, and the approved
passphrase policy. A `management-identity` bootstrap copies the displayed key
to a private temporary file, verifies its approved public fingerprint, and
idempotently appends the selected Herdr public key. An `interactive` bootstrap
invokes `ssh-copy-id` in the user's terminal. Do not stop to ask which key,
whether to install Herdr, or whether to replace an incompatible server: those
choices were part of the approved plan.

`bond` installs persistent SSH entries from the approved manifest, selecting
each host's identity with `IdentityFile`, `IdentitiesOnly yes`, and `BatchMode
yes`. It preserves unrelated configuration and entries from earlier runs,
keeps a backup, and verifies the final connection without a temporary agent.
Hosts, usernames, key names, management routes, and key paths are runtime
inputs. Never generate a launcher containing a user's inventory. The bundled
`scripts/setup-herdr-targets.sh` accepts the same manifest and approval options
as `bond` and locates its helper relative to itself.

Tailscale is optional. For a Tailscale target, `ensureSsh` defaults to false and
preserves the host's SSH mode. Set it to true only when the displayed plan
explicitly includes disabling Tailscale SSH interception in favor of OpenSSH.
Do not infer this change from the presence of Tailscale, especially on macOS.

After any approved `ssh-copy-id`, key-passphrase, MFA, or identity-provider
challenge, the remainder of `bond` is noninteractive. It processes every
machine even when another one is blocked, verifies the final Herdr catalog, and returns `bonded`,
`partial`, or `prerequisite-blocked`. A machine is not bonded merely because a
catalog profile exists: `bond` must also pass its final agentless persistent-SSH
probe. Report successful and blocked machines
separately, including each blocked stage, stable reason code, observation, and
next owner. Remove the private manifest after a complete run; retain it only
when the user needs it to reproduce or inspect a partial result.

First-seen keys may be added to the user's normal `known_hosts`. Changed and
revoked keys still fail closed. Password, passphrase, MFA, or Tailscale-check
prompts are never answered or hidden. After any such initial challenge, the
remaining bootstrap, installation/update, server replacement, session setup,
and catalog reconciliation must be headless and must not request more approval.

If a selected key is not authorized remotely despite the plan evidence, report
`ssh.identity.not-authorized`, use the already-approved bootstrap method, and
retry the unchanged manifest. Once the key is installed, rerun `bond`
automatically without asking the user to reconfirm.

## Discovery and diagnosis

Discovery is always part of planning, even when the user supplies a candidate
list. Automatically discovered names and addresses are TCP candidates only;
never guess a destination username. Use a bounded `doctor --target USER@HOST
--json` for one explicit failure or `doctor --host --json` at a target console.

The legacy `resolve` and proposal `apply` commands remain available for
fine-grained diagnosis and exceptional repairs. Prefer the confirmed-manifest
`bond` path for ordinary new-client setup. Never edit Herdr's private endpoint
catalog directly.

Identify the current machine as `Local (proposed-name)`. The parenthetical is
advisory: Herdr displays the current endpoint as `Local` and provides no
supported rename command.
