---
name: setup-local-source-code
description: Set up a portable local source-code workspace organized around primary clones, task worktrees, local-only projects, helper scripts, and durable research. Only invoke this skill when the user explicitly asks to set up, initialize, or reconfigure this workspace pattern by name — never infer it automatically from ordinary repository, cloning, or worktree requests. Interview the user before making changes. Do not use for ordinary repository cloning or worktree creation after the workspace is configured.
---

# Setup Local Source Code

Only run this skill when the user directly and explicitly asks for it — by
name, or by unambiguously asking to set up or reconfigure this workspace
pattern. Never invoke it automatically because a request merely mentions
repositories, cloning, worktrees, or GitHub accounts; those are ordinary
tasks this skill does not own once the workspace already exists.

Set up a developer's local source workspace without carrying any identity,
client, organization, or machine-specific data from the skill itself.

## Interview First

Before reading local GitHub state or changing any files, interview the user and
collect:

- The developer's proper name and the Git author name to use for each work
  context when those differ.
- Each client or work context they want isolated, including personal work.
- The Git author email used for each client or context.
- Which identity is the default for organizations without a discovered route.
- Whether newly created SSH keys should use an interactive passphrase. Explain
  that GitHub CLI authentication and dual authentication/signing-key
  registration are required parts of this setup.
- Whether the default `~/Source` root is acceptable.

Do not ask for a GitHub username, a filesystem-safe identifier, an SSH key
path/host alias, or GitHub organization names — these are suggested or
discovered later in this workflow, never typed in blind:

- For each client, derive a short, filesystem-safe identifier by
  kebab-casing the client name (e.g. "Acme Corp" → `acme-corp`, shortened to
  `acme` when unambiguous) and propose it, `~/.ssh/github-{identifier}`, and
  the SSH host alias (bare `github.com` for the default identity, otherwise
  `github.com-{identifier}`) as a suggestion. Let the user confirm or override
  every suggested value; never apply one without confirmation.
- The GitHub username and the organizations routed to each identity are
  discovered from that identity's own GitHub CLI login later in this
  workflow (see Script-Only Execution), never asked for directly. Routing is
  exact-match only, from whatever organizations that login currently
  belongs to — there is no prefix-matching for organizations that don't
  exist yet at setup time.

Confirm the resulting mapping with the user, including every suggested and
discovered value, before encoding it into configuration. Never infer that two
clients may share an identity, email, or key. Never include one client's
credentials or GitHub access in another client's route.

Read [references/source-workspace-convention.md](references/source-workspace-convention.md)
after collecting the answers and before proposing changes.

## Script-Only Execution

Use this skill's scripts for filesystem creation, generated configuration, and
GitHub inspection. Do not hand-author the target workspace files or run direct
GitHub commands as a substitute.

1. Run `scripts/install-github-cli.mjs --dry-run`. If `gh` is absent, present
   the platform-specific installation plan and obtain confirmation immediately
   before running the installer without `--dry-run`. Do not substitute direct
   package-manager commands.
2. Run `scripts/configure-ssh-identities.mjs --config-base64 <value> --dry-run`
   (built from the client name, email, and suggested key path/host alias only
   — `githubUser` and `orgs` are not known yet, use empty placeholders) to
   check keys, host aliases, and the managed SSH configuration fragment. If
   keys are missing, add `--generate-missing-keys`; key generation prompts
   interactively for a passphrase and never accepts one in an argument.
3. After the user approves the SSH plan, run it without `--dry-run`. Use
   `--replace` only when they approve replacing the managed fragment.
4. Run `scripts/github-accounts.mjs inventory` to inspect locally authenticated
   GitHub accounts without revealing tokens.
5. For each identity that isn't already logged in, obtain confirmation and run
   `scripts/github-accounts.mjs login`. It requests the key-management scopes,
   configures `gh` to use SSH, deliberately skips automatic key upload so
   registration remains deterministic, and prints the GitHub username of the
   account that just authenticated — read that back as the identity's
   `githubUser` rather than asking the user to type it. For an existing
   account lacking the required scopes, use `refresh-scopes --user <user>`
   after confirmation.
6. For every identity, run
   `scripts/github-accounts.mjs discover-orgs --user <user>`. It is read-only
   and lists every organization that login currently belongs to. Present the
   list to the user and let them exclude any organization that doesn't belong
   to this client's routing before it becomes that identity's `orgs`. Two
   identities must never claim the same organization — surface it immediately
   if discovery returns an overlap.
7. For every identity, obtain confirmation and run `github-accounts.mjs`
   with `ensure-keys --user <user> --public-key <path.pub> --title <title>`. This is
   mandatory: it idempotently registers the same public key as both an
   authentication key and an SSH signing key, then reads both GitHub key lists
   to verify the result against the selected account.
8. Run `scripts/github-accounts.mjs validate --users <comma-separated-users>`
   and require every account to be healthy with `git_protocol=ssh`. Run
   `verify-keys --user <user> --public-key <path.pub>` for every identity and
   require both key types to report `VERIFIED`.
9. Encode the setup object as Base64URL JSON using the schema in the
   reference, now complete with every identity's discovered `githubUser` and
   `orgs`. Run `scripts/setup-local-source-code.mjs --config-base64 <value>
   --dry-run` and present any conflicts or replacements before changing files.
10. After the user has authorized the reported changes, run the same command
   without `--dry-run`. Add `--replace` only when the user explicitly approves
   replacing files managed by this setup.
11. Run the installed `wt-enforce-signing.mjs --dry-run`, report drift, then
    run it without `--dry-run`. Run the dry-run once more and require every
    managed primary clone to report that SSH signing is enforced.

## Verification

After setup:

- Run each installed `wt-*.mjs` command and both clone commands with `--help`.
- Confirm each GitHub account has the selected key registered for both SSH
  authentication and SSH signing.
- Confirm every primary clone has its routed author name/email and key, uses
  `gpg.format=ssh`, and requires signed commits and tags.
- Run `clone-mine.mjs --dry-run` only when the user wants repository discovery;
  it can make many read-only GitHub API requests.
- Run `clone-all.mjs --dry-run` only when the user wants a complete repository
  inventory; it can make many read-only GitHub API requests. Run it without
  `--dry-run` only when the user explicitly asks to clone every repository.
- Confirm the generated identity routes match the discovered GitHub logins and
  organizations, and every suggested value the user confirmed.
- Confirm generated files contain the user's supplied information and no
  identity data originating from this skill.
- Report created, preserved, replaced, or skipped files and any remaining
  authentication or SSH work.

## Safety

- Never expose GitHub tokens or private-key contents.
- Never place tokens or private keys inside the source workspace.
- Do not create GitHub repositories, delete repositories, push commits, or
  change repository visibility as part of workspace setup.
- Do not overwrite existing Git, SSH, or workspace configuration without the
  user's explicit approval.
- Keep all GitHub calls scoped to the username discovered from that identity's
  own login.
