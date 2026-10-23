# Local Source Workspace Convention

Repository identity is independent of checkout location. Host plus owner and optional exact repository determine the account; an explicit repository binding resolves ambiguity. Ordinary Git reads native workstation configuration, while narrow Git-invoked guards check the selected signing identity and route each SSH endpoint. Account API operations use the same workflow for all hosts.

## Layout

```text
{workspace}/
├── repos/{owner}/{repo}/
├── trees/{client-or-project}/{ticket-or-slug}/{repo}/
├── local/{kebab-case-slug}/
├── scripts/
├── research/
└── quarantine/
```

Direct cloning and development in primary clones are allowed. Ticket worktrees are optional isolation. New client folders are lowercase; ticket IDs and branch names retain exact case. Owners/repositories are matched case-insensitively, reusing unique existing spelling. Multiple spellings are an error. All hosts share the same owner/repository path convention. If two hosts have the same owner/repository coordinate, refuse reuse of an occupied path and set an explicit `ownerDirectories` mapping from `host/owner` to a neutral local owner-directory name. This keeps one layout without provider-specific areas.

Local-only projects have no Git initialization or publication unless explicitly requested. Research reads project code and writes under research, with dated topic folders indexed by `research/TOPICS.md`, one findings file per research subagent, then final synthesis. Running/changing project code is development. `scripts/` contains installed helpers only; personal tools belong elsewhere.

Before risky configuration, branch, clone or worktree replacement, preserve state in `quarantine/{date}-{slug}/` with a README identifying its source and reason. Never delete quarantine contents without explicit approval.

## Configuration

External file: `$SOURCE_WORKSPACE_CONFIG`, default `~/.config/source-workspace/config.json`, mode `0600`. This example contains placeholders:

```json
{
  "version": 2,
  "sourceRoot": "~/Source",
  "machineName": "Engineering Workstation",
  "settings": { "commitAndPush": false, "agentCaching": true, "useKeychain": false },
  "hosts": {
    "code.example.test": {
      "provider": "forgejo",
      "apiBase": "https://code.example.test/api/v1/",
      "sshHostname": "code.example.test",
      "sshUser": "git",
      "sshPort": 22
    }
  },
  "accounts": {
    "company": {
      "label": "Company",
      "host": "code.example.test",
      "login": "developer",
      "gitName": "Developer Name",
      "gitEmail": "developer@company.example",
      "sshHost": "code-company",
      "sshHostAliases": [],
      "sshKeyPath": "~/.ssh/id_company",
      "tokenFile": "~/.config/source-workspace/credentials/company.json"
    }
  },
  "routes": { "code.example.test": { "team": "company" } },
  "repositories": { "code.example.test/team/special-repo": "company" },
  "ownerDirectories": {}
}
```

Every host is explicit. The internal API implementation selector accepts `github`, `forgejo`, or `bitbucket`; it does not alter public workflow, path layout, naming rules or signing policy. `apiBase`, SSH endpoint/user/port and account credentials are independent. Supported API operations are account validation, owner/repository discovery, authored-commit matching, key registration, and pull-request creation/reuse.

`routes` maps host/owner to account. `repositories` maps exact host/owner/repository to account and takes precedence. All map matching is case-insensitive. Account IDs use lowercase letters/digits/hyphens. A host alias belongs to exactly one account. Different personas use distinct keys; the same name/email persona may reuse a key across hosts. Unknown/ambiguous routes require explicit selection; there is no personal signing fallback.

A private credential file contains `host`, `login`, `token`, and optionally `authUsername` when Basic authentication is required. API operations verify the selected authenticated account, constrain pagination to the configured HTTPS API base, disable redirects and suppress credential-bearing errors. Users save credentials directly; agents must not read or reproduce them. Native Git/SSH does not need API credentials.

The full setup input uses the same `sourceRoot`, `machineName`, `settings`, `hosts`, `repositories`, and `ownerDirectories`, with `identities` instead of `accounts/routes`. Each identity includes `id`, `clientName`, `host`, `login`, `gitName`, `gitEmail`, `sshHost`, `sshHostAliases`, `sshKeyPath`, `tokenFile`, and approved `orgs`. The setup script converts approved owners and the account login to explicit routes.

## Naming and registration

Private key filenames must be `id_{persona-or-company}`; public keys append `.pub`. Examples: `id_fredlackey`, `id_ccsi`, `id_cisa`. The suffix is the approved persona/company, independently of account/host aliases. Validate at configuration, generation and registration boundaries. Never silently rename existing keys.

New hosted key titles must be `{Proper Machine Name} ({YYYYMMDD})`, using the actual local addition date. Establish the proper human-readable machine name explicitly; reject OS labels, `.local` hostnames and generic placeholders. Titles are constructed by the tooling, not free-form input. Existing registrations retain their metadata and dates; nonconforming existing titles require review. Unsupported key-registration types/labels are recorded through the shared capability model without claiming remote registration. Local SSH signing remains mandatory regardless of remote display capabilities.

## Native Git and SSH policy

The enforcer writes account identity files, an executable signing launcher, `routes.gitconfig`, and `allowed_signers` beside the external configuration. It registers the policy as a global include after preserving the old configuration. The baseline selects SSH signatures and enables commit/tag signing, disables inferred author identity, and supplies no fallback author email or signing key. Account files provide the selected name/email/key. Existing historical trust entries are merged, not discarded.

Native remote conditional includes cover raw stored SCP, `ssh://`, HTTPS and alias forms with explicit casing patterns. They match **any remote**, not only origin. Exact repository conditions follow owner rules. Because Git itself does not reject conflicting matches, `wt-sign.mjs` verifies the resolved identity and actual committer/tagger before delegating to `ssh-keygen`. It preserves legitimate original authors on replayed commits. Verification delegates to the standard SSH verifier.

`wt-ssh.mjs` is installed as Git's SSH command. It resolves each transfer's repository host/owner/repository and invokes native SSH through the approved alias, including mixed-case URLs and exact exceptions that literal prefix rewriting cannot fully represent. Native owner URL rewrites cover common canonical URLs. The transport guard resolves each remote independently; fetching another upstream does not change the repository signing identity. Direct SSH continues to use ordinary SSH aliases.

Use `wt-identity.mjs show` to inspect selection. `bind {account}` adds an explicit local identity include and `source-workspace.identity` setting for remote-less or mixed-account repositories. This is the narrow exception to avoiding duplicated repository-local identity settings. Changing an existing binding requires deliberate review.

SSH configuration is checked using effective `ssh -G` results from a projected configuration, including nested/scoped Includes, wildcard defaults and accumulated identity files. Refuse conflicts rather than relying on text-only matching. Key-pair correspondence is checked without printing private material. The machine-specific `settings.nodePath` records the executable discovered during setup (retaining its stable PATH entry rather than resolving its versioned install target). Generated signing and transport launchers use that absolute executable, so GUI-launched Git does not depend on shell startup files. Optional `agentCaching` adds keys to an available agent after use; `useKeychain` enables supported keychain integration. Test fresh-session/GUI behavior where needed; an empty agent alone does not prove file-based authentication failure.

## Helpers and completion

`wt-create`, `wt-sync`, `wt-route`, `wt-list`, `wt-status`, `wt-open`, `wt-remove`, `wt-prune`, `wt-audit-paths`, `wt-enforce-signing`, `wt-identity`, and `wt-pr-create` share the external configuration. Each accepts `--help`. `--host` resolves ambiguous owner routes; no host gets an implicit preference. `host-accounts` is the shared account/registration interface in the skill's scripts.

`clone-mine` scans routed owners and clones only repositories with authored commits. `clone-all` bypasses authorship only when the user explicitly requests that scope. Existing clones are preserved; unrouted owners are skipped. Both commands cover all configured accounts and accept host/profile scoping.

`wt-pr-create` performs local preflight before authentication/push, reads bodies from files, pushes only ticket branches, then creates/reuses requests through the common API contract. It never fetches or merges. Dry-run performs no API requests or network mutation. Draft capability is handled internally, preserving the same command surface.

When `settings.commitAndPush=true`, every task changing more than one tracked file must commit only its changes and push the current branch in every affected repository. After each push require exit 0 from `wt-sync.mjs {owner}/{repo} --host {host} --strict --verify-branch {branch}`. Resolve skipped synchronization or verification failure without discarding primary work. When false, commit/push only when requested.

## Deployment and verification

Source changes belong in this skill; installed helpers are generated. Compatible updates deploy helpers/guide only and never change configuration. Incompatible schema/filename/path changes require a preserved full migration. Old entry points reported as unmanaged must not be removed silently. Keep existing keys and remote registrations during migration.

Run `node --test scripts/tests/*.test.mjs assets/workspace-scripts/tests/*.test.mjs` from the skill directory, and `node --test scripts/tests/*.test.mjs` after installation. Tests isolate homes/configuration and generate temporary signing keys, with no real API calls or pushes. Verify actual SSH commit/tag signatures, multiple identities and hosts, worktrees/off-path repositories, mixed remotes and explicit bindings, naming/date rules, historical trust, effective SSH conflicts, and dry-run/no-write behavior.

Git signing flags are overridable. Rejecting unsigned history, non-SSH signatures or an unapproved signer at acceptance requires appropriate repository-side checks; a generic signed-commit requirement is not equivalent.

The implementation follows the [Git configuration reference](https://git-scm.com/docs/git-config),
[OpenSSH client configuration](https://man.openbsd.org/ssh_config),
[OpenSSH key format](https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.key),
and the configured hosts' API contracts. Key-pair validation compares the embedded
public identity in an OpenSSH-format private key with its public companion without
printing or transmitting private material. Different persona identities are checked
against actual public key material, not just filename uniqueness.
