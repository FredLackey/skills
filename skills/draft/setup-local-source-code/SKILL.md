---
name: setup-local-source-code
description: Set up, update, or reconfigure a portable local source-code workspace organized around primary clones, task worktrees, local-only projects, helper scripts, and durable research. Only invoke this skill when the user explicitly asks to set up, initialize, update, or reconfigure this workspace pattern by name — never infer it automatically from ordinary repository, cloning, or worktree requests. Inspect existing settings read-only, then confirm a consolidated setup plan before making changes. Do not use for ordinary repository cloning or worktree creation after the workspace is configured.
---

# Setup Local Source Code

Only run this skill when the user directly and explicitly asks for it — by
name, or by unambiguously asking to set up, update, or reconfigure this
workspace pattern. Never invoke it automatically because a request merely
mentions repositories, cloning, worktrees, or GitHub accounts; those are
ordinary tasks this skill does not own once the workspace already exists.

The skill carries no identity, client, organization, or machine-specific
data, and neither do the files it installs. Everything personal lives in one
JSON configuration file outside the workspace (see
[the convention](references/source-workspace-convention.md#workspace-configuration)).
The installed helpers and workspace guide are identical on every machine.

Read [references/source-workspace-convention.md](references/source-workspace-convention.md)
before proposing changes, and
[references/workspace-rationale.md](references/workspace-rationale.md) when the
user asks why the workspace works the way it does.

## Choose the mode

- **New setup or reconfiguration:** follow Interview First and Script-Only
  Execution below.
- **Pulling an updated skill into an existing workspace:** follow
  [Updating an Existing Workspace](#updating-an-existing-workspace). Do not
  re-run the interview just to deploy new helpers.

## Interview First

Read-only inspection may precede the interview: use the inventory script and
inspect SSH configuration (never private keys or tokens) to identify reusable
accounts, aliases and conflicts. Do not make changes during this inspection.
Collect missing information in one interview, retaining values already supplied:

- The developer's proper name and the Git author name to use for each work
  context when those differ.
- Each client or work context they want isolated, including personal work.
- The Git author email used for each client or context. Either a real address
  or the host's private no-reply address is acceptable; it is the user's choice.
  For signed commits to show as verified, the address must be verified on that
  account.
- Any additional Git hosts beyond github.com, such as a self-hosted Forgejo
  server: its hostname, SSH port, and the account login used there.
- Whether agents should commit and push every multi-file change automatically
  (`settings.commitAndPush`). Explain that when it is on, agents commit and
  push in each affected repository and run the post-push check before calling
  a task complete; when it is off, they commit and push only when asked.
- Whether newly created SSH keys should use an interactive passphrase. Explain
  that GitHub CLI authentication and dual authentication/signing-key
  registration are required parts of this setup.
- Whether the default `~/Source` root is acceptable.

Do not ask for a GitHub username, a filesystem-safe identifier, an SSH key
path/host alias, or organization names as free-text questions — propose naming
values during the interview and discover accounts/organizations through scripts:

- For each client, derive a short, filesystem-safe identifier by
  kebab-casing the client name (e.g. "Acme Corp" → `acme-corp`, shortened to
  `acme` when unambiguous). Propose the account ID, SSH key path, and host
  alias together in one table so their roles are clear. Key filenames use
  `id-{identifier}`, never a `github-` prefix. If the confirmed ID already
  starts with `id-`, use it as-is: both `personal` and `id-personal` suggest
  `~/.ssh/id-personal`, never `id-id-personal`. The alias remains host-specific:
  `github.com` for at most one GitHub identity, otherwise `github.com-{identifier}`.
  These are suggestions; confirm or accept overrides together. Existing keys
  are never renamed or replaced just to follow the new naming convention.
- The GitHub username and the organizations routed to each identity are
  discovered from that identity's own GitHub CLI login later in this
  workflow (see Script-Only Execution), never asked for directly.

Routing is explicit and fails closed. Every repository owner — each
organization and the account's own user — is routed to exactly one account.
**There is no default account.** An owner that appears later (a new
organization, or someone else's public repository) is added with
`wt-route.mjs add {owner} {account}` after asking the user which account it
belongs to. Never infer that two clients may share an identity, email, or key.
Never include one client's credentials or access in another client's route.

Confirm the resulting mapping, including suggested and discovered values,
before writing configuration. Treat an answer to one interview item as an
answer to that item; ask only for unresolved values. Flag likely email typos
without silently correcting them. Preserve supplied profile names as expected
logins and verify them against authentication rather than asking again.

Bundle related approvals around concrete previews: one SSH plan, account
login/key-registration actions, and the final workspace/signing plan. Approval
may cover multiple accounts and discovered organizations when their scope is
clear. Remember prior authorization and do not ask again for unchanged actions;
ask only for new conflicts, replacements, exclusions, or permissions. Never
interpret silence or a partial answer as approval of unrelated items.

Explain upfront that setup installs a workspace layout and tools; it does not
move existing source folders or clone repositories. Report existing folders
outside the managed layout as preserved, with migration a separate task.

## Script-Only Execution

Use this skill's scripts for filesystem creation, generated configuration, and
GitHub inspection. Do not hand-author the configuration, workspace files, or Git
includes, and do not run direct GitHub commands as a substitute.

1. Run `scripts/install-github-cli.mjs --dry-run`. If `gh` is absent, present
   the platform-specific installation plan and obtain confirmation immediately
   before running the installer without `--dry-run`. Do not substitute direct
   package-manager commands.
2. Run `scripts/configure-ssh-identities.mjs --config-base64 <value> --dry-run`
   (built from the setup object's `hosts` and each identity's `host`, `login`
   placeholder, suggested `sshHost`, any `sshHostAliases`, and `sshKeyPath`) to
   check keys, host aliases, ports, and the managed SSH configuration fragment.
   If keys are missing, add `--generate-missing-keys`; key generation prompts
   interactively for a passphrase and never accepts one in an argument.
3. Present the SSH preview including key generation, fragment and Include
   changes. If dedicated Host blocks conflict, preview the same command with
   `--migrate-existing-hosts`; it shows removed directives, the new fragment,
   and a quarantine backup plan using the setup object's `sourceRoot`.
   After approval, apply the same command. Shared blocks or blocks containing
   Include require manual splitting with backup and explicit approval; never
   remove unrelated hosts. Use `--replace` only for approved fragment replacements.
4. Run `scripts/github-accounts.mjs inventory` to inspect locally authenticated
   GitHub accounts without revealing tokens.
5. For each GitHub identity that isn't already logged in, use the approved
   account-change plan (or obtain missing authorization) and run
   `scripts/github-accounts.mjs login`. It requests the key-management
   scopes, configures `gh` to use SSH, deliberately skips automatic key upload
   so registration remains deterministic, and prints the GitHub username of
   the account that just authenticated — read that back as the identity's
   `login` rather than asking the user to type it. For an existing account
   lacking the required scopes, use `refresh-scopes --user <user>` with
   authorization from that plan or a new confirmation.
6. For every GitHub identity, run
   `scripts/github-accounts.mjs discover-orgs --user <user>`. It is read-only
   and lists every organization that login currently belongs to. Present the
   list to the user and let them exclude any organization that doesn't belong
   to this client's routing before it becomes that identity's `orgs`. Two
   identities must never claim the same organization — surface it immediately
   if discovery returns an overlap.
7. For every GitHub identity, use the approved account-change plan (or obtain
   missing authorization) and run `github-accounts.mjs`
   with `ensure-keys --user <user> --public-key <path.pub> --title <title>`.
   This is mandatory: it idempotently registers the same public key as both an
   authentication key and an SSH signing key, then reads both GitHub key lists
   to verify the result against the selected account.
8. Run `scripts/github-accounts.mjs validate --users <comma-separated-users>`
   and require every account to be healthy with `git_protocol=ssh`. Run
   `verify-keys --user <user> --public-key <path.pub>` for every GitHub
   identity and require both key types to report `VERIFIED`.
9. For each additional-host (Forgejo) identity, guide the user through the
   host's own web interface: register the public key for authentication and
   signing, verify key ownership, activate the author email, and create an API
   token. Have the user save the token in the host's credential file
   (`hosts.{host}.tokenFile`, default `~/.config/forgejo/{host}.json`, mode
   `0600`, containing `host`, `username`, and `token`). Never read, print, or
   copy the token yourself. The user supplies that account's `login` and
   owners (organizations) to route.
10. Inspect top-level workspace directories read-only and report existing
    source folders outside the managed layout as preserved; do not migrate them.
    Encode the setup object as Base64URL JSON using the schema in the
    reference, now complete with every identity's discovered `login` and
    `orgs`. Run `scripts/setup-local-source-code.mjs --config-base64 <value>
    --dry-run` and present any conflicts or replacements before changing files.
11. After the user has authorized the reported changes, run the same command
    without `--dry-run`. Add `--replace` only when the user explicitly approves
    replacing files managed by this setup, including an existing configuration.
12. Run the installed `scripts/wt-enforce-signing.mjs --dry-run`, report what it
    would write, then run it without `--dry-run`. It writes the workstation Git
    includes and registers them in the global Git configuration. Report any
    `DRIFT` or `UNROUTED` lines. Removing settings stored inside existing
    repositories (`--remove-local-overrides`) changes those repositories; do it
    only with the user's explicit approval.

## Updating an Existing Workspace

Installed helpers and the workspace guide are never edited in place. Changes
are made in this skill and pulled into each workstation:

1. Run `scripts/setup-local-source-code.mjs --update --dry-run`. Update mode
   reads the existing configuration for the workspace root and never changes
   the configuration, routes, or Git includes.
2. Present every `CREATE`, `REPLACE`, and `UNMANAGED` line. A `Conflict` means an
   installed file differs from the skill; show the difference before asking to
   replace it. `UNMANAGED` files in `scripts/` are not the skill's and belong
   elsewhere (for example `~/.local/bin`); move them only with approval.
3. After approval, run `--update`, adding `--replace` only when replacements
   were approved.
4. Run the installed test suite and `scripts/wt-enforce-signing.mjs --dry-run`.

**Migrating an older installation.** Older versions generated
`scripts/lib/wt-config.mjs` as code containing identities and routes, and wrote
identity settings into every repository. If no configuration file exists yet,
build the setup object from the old file's values, confirm every value with the
user (including the email for each account and an explicit route for every
owner directory under `repos/`), and run full setup with `--replace`. Then run
`wt-enforce-signing.mjs --dry-run`: repositories that still carry their own
identity settings are reported as `DRIFT` until the user approves
`--remove-local-overrides`.

## Verification

After setup or an update:

- Run setup-script regression checks with `node --test scripts/tests/*.test.mjs`
  from the skill directory when modifying setup scripts.
- Run each installed `wt-*.mjs` command and both clone commands with `--help`.
- Run `node --test scripts/tests/*.test.mjs` from the workspace root. Tests
  use temporary configuration and never read the user's. Fixtures canonicalize
  temporary paths and detect filesystem case sensitivity. Report skips for
  distinct case-variant directory checks separately from passes and failures;
  use a case-sensitive volume when those checks must run.
- Confirm `wt-pr-create.mjs --dry-run` can validate a prepared ticket without
  authenticating, pushing branches, or creating pull requests.
- Report login health and selected authentication/signing key registration
  separately. Registration does not prove the author email is verified. Check
  email verification only with authorized access; otherwise report it as
  unverified by this setup, since verified commit badges depend on it.
- Run `wt-enforce-signing.mjs --dry-run` and confirm every primary clone
  resolves to its routed identity: name, email, key, `gpg.format=ssh`, and
  required commit and tag signing.
- Run `wt-route.mjs list` and confirm the routes match the discovered logins,
  organizations, and every value the user confirmed.
- Run `clone-mine.mjs --dry-run` only when the user wants repository discovery;
  it can make many read-only GitHub API requests.
- Run `clone-all.mjs --dry-run` only when the user wants a complete repository
  inventory. Run it without `--dry-run` only when the user explicitly asks to
  include repositories they never committed to.
- Confirm the installed `CLAUDE.md`, helpers, and tests contain no identity
  data; personal values exist only in the configuration file.
- Report created, preserved, replaced, or skipped files and any remaining
  authentication or SSH work.

## Safety

- Never expose GitHub or Forgejo tokens or private-key contents.
- Keep interview responses, discovered organizations, workstation paths and
  migration logs out of skill source, examples, test fixtures and commits.
  Use synthetic identities and reserved example domains in maintained files.
- Never place tokens, private keys, or personal configuration inside the source
  workspace.
- Do not create repositories, delete repositories, push commits, or change
  repository visibility as part of workspace setup.
- Do not overwrite existing Git, SSH, or workspace configuration without the
  user's explicit approval.
- Keep all GitHub calls scoped to the username discovered from that identity's
  own login.

## Repository path casing

Use the shared helper scripts for all primary clones and worktrees. Owner and
repository identity matching is case-insensitive; reuse a unique existing
path and use the host's spelling for new names. Do not lowercase ticket IDs or
Git branches. Run `scripts/wt-audit-paths.mjs` during verification and report
collisions separately from setup success. Never resolve duplicates by silently
choosing one or deleting it. See the path policy in
[the workspace convention](references/source-workspace-convention.md).
