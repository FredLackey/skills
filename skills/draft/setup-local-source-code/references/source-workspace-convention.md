# Local Source Workspace Convention

This convention gives developers one predictable place for primary clones,
task worktrees, local-only projects, reusable tooling, and durable research.
The same rules, helpers, and guide apply on every machine; only one JSON
configuration file differs between people.

## Layout

```text
~/Source/
├── repos/        # Primary clones: repos/{owner}/{repo}; other hosts: repos/{host}/{owner}/{repo}
├── trees/        # Task worktrees grouped by client/project and ticket/slug
├── local/        # Local-only projects that are not intended for a Git host
├── scripts/      # The skill's executable Node.js helpers, and nothing else
├── research/     # Durable, dated research findings
└── quarantine/   # State preserved before risky repairs (created when needed)
```

Primary clones are plumbing. Never perform repository work directly in
`repos/`. Work happens in:

```text
trees/{client-or-project}/{ticket-id-or-slug}/{repo}
```

The ticket directory is a plain grouping folder. Every repository worktree in
the same ticket directory uses the ticket ID or slug as its branch name.

Local-only projects live directly under `local/{kebab-case-slug}` without Git
initialization, commits, or publication unless their intent later changes.

Research reads code in primary clones and writes only under `research/`. It
never creates worktrees; running or changing code requires a ticket worktree
under a real client or project.

Before deleting, renaming, or rewriting a clone, worktree, branch, or
configuration, copy whatever could be lost into
`quarantine/{YYYY-MM-DD}-{slug}/` with a `README.md` describing it. Quarantined
state is removed only with explicit approval.

## Workspace Guide

The workspace's operating guidance is a static `CLAUDE.md` shipped in this
skill's `assets/workspace-guide/`. It is identical on every machine and contains
no personal data. `AGENTS.md` points to it with a relative file symlink where
the platform allows one, and otherwise is an identical copy. Rules that vary by
developer are written as conditions on a configuration setting.

Installed helpers and the guide are never edited on a workstation. Changes are
made in the skill and pulled in with the setup script's `--update` mode.

## Workspace Configuration

Everything personal or machine-specific lives in one JSON file outside the
workspace:

- `$SOURCE_WORKSPACE_CONFIG`, or by default `~/.config/source-workspace/config.json`
  (mode `0600`).

```json
{
  "version": 1,
  "sourceRoot": "~/Source",
  "settings": { "commitAndPush": false },
  "hosts": {
    "git.example.com": {
      "provider": "forgejo",
      "sshPort": 2222,
      "tokenFile": "~/.config/forgejo/git.example.com.json"
    }
  },
  "accounts": {
    "personal": {
      "label": "Personal",
      "host": "github.com",
      "login": "github-user",
      "gitName": "Developer Name",
      "gitEmail": "developer@example.com",
      "sshHost": "github.com",
      "sshHostAliases": [],
      "sshKeyPath": "~/.ssh/id-personal"
    },
    "company": {
      "label": "Company forge",
      "host": "git.example.com",
      "login": "dev",
      "gitName": "Developer Name",
      "gitEmail": "developer@company.example",
      "sshHost": "git.example.com",
      "sshKeyPath": "~/.ssh/id-company"
    }
  },
  "routes": {
    "github.com": { "github-user": "personal", "personal-org": "personal" },
    "git.example.com": { "team": "company" }
  }
}
```

Values shown are placeholders, not defaults. Suggest SSH key filenames as
`id-{identifier}` with no `github-` prefix; if an ID already starts with `id-`,
do not add it again. Account IDs and SSH aliases are separate values. Confirm
the proposed mapping together; preserve existing key names unless migration
is explicitly approved.

- `settings.commitAndPush` — when `true`, agents commit and push every
  multi-file change and run the post-push check; when `false`, only on request.
- `hosts` — github.com is always present with the `github` provider. Additional
  hosts use the `forgejo` provider (Forgejo or Gitea), an SSH port, and a
  credential file holding `{ "host", "username", "token" }` with mode `0600`.
- `accounts` — one per client or work context. IDs use lowercase letters,
  digits, and single hyphens. Each SSH host and alias belongs to exactly one
  account. `sshHostAliases` lists older alias names still present in existing
  clones' origins; they are accepted wherever the primary alias is.
- `routes` — per host, an explicit owner → account table. Owners (organization
  or user names) are matched case-insensitively and may appear once per host.
  A route may only name an account on that host.

The helpers read the file directly; `wt-route.mjs add` and the setup script are
the only tools that write it.

## Routing

Routing is explicit and fails closed. **There is no default account.** Every
owner a helper touches must have a route on its host. When one doesn't, the
helper stops with an error that prints the exact
`wt-route.mjs add {owner} {account}` command; the user decides the account.
Repository cloning, API access, pushes, commit authorship, and SSH signing all
use the routed account.

Setup creates routes for each account's own login and for the organizations its
login belongs to, after the user excludes any that don't belong to that client.
An owner may never be routed to two accounts, and the helpers refuse to silently
change an existing route.

## Identity and Signing

Author identity and SSH signing are configured once per workstation, not per
repository. `wt-enforce-signing.mjs` generates, next to the configuration file:

- `git/{account}.gitconfig` — the account's `user.name`, `user.email`,
  `user.signingkey`, `gpg.format=ssh`, `commit.gpgsign=true`, and
  `tag.gpgsign=true`.
- `git/routes.gitconfig` — one `includeIf "gitdir/i:{repos}/{owner}/"` per route
  (`{repos}/{host}/{owner}/` for additional hosts) pointing at that account's
  file.

It registers `routes.gitconfig` with `include.path` in the global Git
configuration. Because the condition matches the primary clone's Git directory,
every linked worktree inherits the same identity. Repositories store no identity
or signing settings of their own; the enforcer reports any that would override
the workstation (`DRIFT`) and removes them only with `--remove-local-overrides`.
Helpers refuse to clone until the workstation configuration is installed and
current, and verify each new clone's effective identity.

Git 2.34 or newer is required for SSH signing. Each account's public key is
registered on its host as both an authentication key and a signing key. For
signatures to show as verified, the configured email must be verified on that
account.

## Workspace Tools

The setup installs dependency-free executable Node.js tools:

- `wt-create.mjs {owner}/{repo} {client} {ticket} [--host {host}]` creates a
  task worktree on branch `{ticket}`, cloning the primary first when needed.
  Re-running it for an existing worktree validates and reports it without
  changing anything.
- `wt-sync.mjs {owner}/{repo} [--host {host}] [--strict] [--verify-branch {branch} [--commit {sha}]]`
  always fetches, then fast-forwards the primary's default branch only when the
  primary is clean and on it; otherwise it reports why it skipped and changes
  nothing. A skip exits `0`, or `2` with `--strict`. `--verify-branch` requires
  `origin/{branch}` to equal the pushed commit (the local branch tip unless
  `--commit` is given) and exits `3` otherwise. `--strict --verify-branch` is
  the post-push check.
- `wt-list.mjs` lists task folders and their repository worktrees.
- `wt-status.mjs` reports clean/dirty and ahead/behind state.
- `wt-pr-create.mjs {client} {ticket} {base-branch}` locally preflights every
  repo worktree in a ticket, pushes each ticket branch, and creates its pull
  request (GitHub, or Forgejo with a `[WIP]` title prefix for drafts) using a
  shared body file or repo-specific body files. Origins must use the routed
  account's SSH host or a configured alias. It does not fetch or merge, reuses
  existing open pull requests, and prints every resulting link.
- `wt-remove.mjs` safely removes a clean worktree and can optionally delete its
  merged local branch.
- `wt-prune.mjs` always runs `git worktree prune` in every primary clone, reports
  directories under `trees/` that are no longer registered worktrees, and
  deletes them only with `--force`.
- `wt-open.mjs {client} {ticket}` opens the entire ticket folder in VS Code.
- `wt-audit-paths.mjs` reports case-variant duplicate paths.
- `wt-route.mjs list` / `add {owner} {account} [--host {host}]` shows or adds
  routes and refreshes the generated Git includes.
- `wt-enforce-signing.mjs [--dry-run] [--remove-local-overrides]` installs the
  workstation identity configuration and audits every primary clone.
- `clone-mine.mjs` discovers repositories with commits authored by configured
  GitHub accounts in organizations routed to them, and clones them.
- `clone-all.mjs [--profile {account}]` clones every repository in organizations
  routed to configured GitHub accounts without inspecting history. It is used
  only when the user explicitly asks to include repositories without authored
  contributions.

Scripts use `.mjs`, ES modules, a Node shebang, no npm dependencies, and avoid
shell interpretation of user-provided path segments. `scripts/` contains only
these helpers, their `lib/`, and their `tests/`.

## Bulk Cloning Scope

`clone-mine.mjs`'s authored-commit filter defines which repositories qualify
for bulk cloning. Requests such as "clone all my repos" mean every qualifying
repository; they do not authorize bypassing the filter with extra passes,
direct calls to cloning functions, replacement loops, or filter changes.
Broader cloning requires an explicit instruction to include repositories
without authored contributions. Skipped repositories are expected results.

## Completing Changes

When `settings.commitAndPush` is `true`, a task that creates, deletes, or
modifies more than one file in Git-backed work is complete only when its changes
are committed in every affected repository, pushed, and verified with the
post-push check. Only the task's changes are staged. Git is never initialized
and remotes are never invented for directories that aren't repositories.
Regardless of the setting, every push is followed by the post-push check, and a
failed check is resolved without discarding changes in a primary clone.

## GitHub CLI and SSH Prerequisites

GitHub CLI is mandatory. The skill installs it when absent using WinGet on
Windows, Homebrew on macOS, GitHub's signed official apt repository on
Ubuntu/Debian, or the Arch `github-cli` package on Arch Linux. Installation is
previewed first because it changes system software.

Each GitHub account is authenticated in `gh` through the browser flow with the
Git protocol set to SSH. Automatic key upload during login is disabled so the
skill can deterministically register and verify the interviewed key afterward.
The login must have permission to administer authentication and SSH signing
keys. Existing logins are refreshed when those permissions are absent.

SSH host aliases are written to a managed `~/.ssh/config.d/` fragment: one
`Host` entry per account listing its alias and any older aliases, with the
real host name and, for additional hosts, its SSH port.

## Research

```text
research/
├── TOPICS.md
└── {YYYY}/{MM}/{DD}/{topic-slug}/
    ├── README.md
    ├── findings-{subtopic}.md
    ├── SUMMARY.md
    ├── CATALOG.md   (optional)
    └── PLAN.md      (optional)
```

`TOPICS.md` indexes every research topic in one contiguous table. The topic
README captures the full question. The topic is split into pieces, each
researched by its own subagent writing its own findings file, so parallel
researchers never overwrite one another. A final agent reads every findings
file and writes the summary. `CATALOG.md` holds an inventory when that is the
deliverable; `PLAN.md` holds an agreed plan that follows from the research.

## Setup Input Schema

The setup script accepts the interview result as Base64URL-encoded JSON and
converts it into the workspace configuration. `login` and `orgs` come from
account login and organization discovery, not from typing during the interview:

```json
{
  "sourceRoot": "~/Source",
  "settings": { "commitAndPush": false },
  "hosts": {},
  "identities": [
    {
      "id": "personal",
      "clientName": "Personal",
      "host": "github.com",
      "gitName": "Developer Name",
      "gitEmail": "developer@example.com",
      "login": "github-user",
      "sshHost": "github.com",
      "sshHostAliases": [],
      "sshKeyPath": "~/.ssh/id-personal",
      "orgs": ["personal-org"]
    }
  ]
}
```

Each identity becomes an account. Its `login` and every entry in `orgs` become
routes on its `host`. `githubUser` is accepted as an older spelling of `login`.
`defaultIdentity` is rejected: routing has no default. `settings.commitAndPush`
is required.

## Path Policy

New client directories use lowercase names; existing unambiguous client
directories are reused. Owner and repository comparisons are case-insensitive.
Use the host's returned spelling for new names, but reuse a sole existing owner
or repository directory regardless of case. Multiple case-equivalent paths are
an error, even when one exactly matches the argument. Run `wt-audit-paths.mjs`
to report collisions; reconcile them with preserved Git state before retrying.
Do not simply lowercase every path or rename existing directories automatically.
For example, requesting `ExampleOrg/Tools` reuses an existing verified
`repos/exampleorg/tools`; it must not create another clone.

Ticket IDs and Git branches retain exact case: `TASK-1423` must not become
`task-1423`. Case-only ticket or local branch conflicts are rejected. Existing
worktrees must match their primary clone, registration, and ticket branch.
New clone metadata is fetched using the routed account; reusing an existing
clone requires no network. Creation uses a workspace lock; retry if another
creator is running. Only remove a stale lock after checking no creator remains.
