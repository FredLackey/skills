# Local Source Workspace

This guide is installed by the `setup-local-source-code` skill and is identical
on every workstation unless explicitly corrected locally. `AGENTS.md` is the same
file. Maintain helpers through the skill and preserve explicit local guide
corrections when pulling an update (see
[Updates](#updates)).

Everything personal or machine-specific — accounts, emails, SSH keys, Git
hosts, owner routes, and settings — lives in the workspace configuration, not
here:

- `$SOURCE_WORKSPACE_CONFIG`, or by default `~/.config/source-workspace/config.json`

Read it when a rule below depends on a setting. Never copy its values into this
workspace or into a repository.

## Layout

Primary clones use `repos/{owner}/{repo}` for every host. Ticket worktrees use
`trees/{client-or-project}/{ticket-or-slug}/{repo}`. Local-only projects live in
`local/{slug}`, research under `research/`, installed helpers under `scripts/`,
and preserved state under `quarantine/`. Host identity is routing metadata,
not a separate provider area. Refuse collisions between repositories from
different hosts; never reuse the wrong clone.

## Rules

- **Direct clones and repository work are allowed.** Clone specifically requested
  repositories using the routed account's SSH alias. Work may happen in that
  checkout; a ticket or worktree is optional. Preserve existing work.
- **Ticket worktrees are optional isolation.** A ticket folder is a grouping
  directory; each repository has its own worktree subfolder on the exact ticket
  branch. `wt-create.mjs` is a convenience, not a mandatory cloning route.
- **Local-only projects** live directly in `local/{kebab-case-slug}/` with no Git
  repository, commits, or publication unless that intent explicitly changes.
- **Research reads, it doesn't change.** Research may read code in primary
  clones (cloning directly first if needed) and writes only under
  `research/`. Running or changing code is development and may use a direct checkout or an
  optional worktree. Research does not require a worktree.
- **`scripts/` holds only the skill's helpers.** Personal tools belong elsewhere,
  such as `~/.local/bin`.
- **Preserve before risky repairs.** Before deleting, renaming, or rewriting a
  clone, worktree, branch, or configuration, copy whatever could be lost into
  `quarantine/{YYYY-MM-DD}-{slug}/` with a `README.md` saying what it is, where
  it came from, and why. Never delete quarantine contents without explicit
  approval.
- **New client folders use lowercase names.** Ticket IDs and branch names keep
  their exact case.

## Commands

All helpers are dependency-free Node.js scripts in `scripts/`. Every one accepts
`--help`.

| Command | What it does |
|---|---|
| `wt-create.mjs {owner}/{repo} {client} {ticket} [--host {host}]` | Creates a ticket worktree on branch `{ticket}`, cloning the primary first if needed. Re-running it for an existing worktree only validates and reports it. |
| `wt-sync.mjs {owner}/{repo} [--host {host}] [--strict] [--verify-branch {branch} [--commit {sha}]]` | Always fetches. Fast-forwards the primary's default branch only when the primary is clean and on that branch; otherwise reports why it skipped and changes nothing (exit 0, or 2 with `--strict`). `--verify-branch` requires `origin/{branch}` to equal the pushed commit (exit 3 on mismatch). |
| `wt-list.mjs` | Lists ticket folders and the worktrees inside each. |
| `wt-status.mjs` | Same, with clean/dirty and ahead/behind state. |
| `wt-pr-create.mjs {client} {ticket} {base} --body-file {path} [--draft] [--dry-run]` | Validates every worktree in a ticket locally, then pushes each ticket branch and creates (or reuses) its pull request. Use repeated `--body-file-for {repo}={path}` for per-repo bodies. Never fetches or merges. |
| `wt-remove.mjs {client} {ticket} {repo} [--delete-branch]` | Removes one clean worktree (`--all` instead of a repo removes the whole ticket). Refuses uncommitted changes. |
| `wt-prune.mjs [--force]` | Always runs `git worktree prune` in every primary; reports directories under `trees/` that are no longer registered worktrees, and deletes them only with `--force`. |
| `wt-open.mjs {client} {ticket}` | Opens the ticket folder in VS Code. |
| `wt-audit-paths.mjs` | Reports case-variant duplicate paths; changes nothing. |
| `wt-route.mjs list` / `add {owner} {account} [--host {host}]` | Shows or adds owner routes in the configuration. |
| `wt-identity.mjs show` / `bind {account}` | Shows repository identity or binds an explicit account for mixed-account or remote-less repositories. |
| `wt-enforce-signing.mjs [--dry-run] [--remove-local-overrides]` | Installs the workstation identity/signing configuration and checks every primary against its route. |
| `clone-mine.mjs [--org {name}] [--user {login}] [--dry-run]` | Clones repositories you have authored commits in, from organizations routed to each account. |
| `clone-all.mjs [--profile {account}] [--dry-run]` | Clones every repository in routed organizations, whether or not you committed to it. See [Bulk cloning](#bulk-cloning). |

## Accounts, identity and signing

Every host/owner is routed explicitly to an account; exact repository exceptions
and explicit local repository bindings take precedence. No host or personal
account is an implicit fallback. Use `--host` when owner routing is ambiguous.
All hosts share the same workflow, layout, commands and rules; no provider-specific
areas, comments or separate setup instructions.

Identity keys use `id_{persona-or-company}` and matching `.pub` files. New key
registration titles use `{Proper Machine Name} ({YYYYMMDD})` on the actual
registration date. Generic OS labels and `.local` names are invalid. Existing
registrations retain their dates on verification. Different identities use distinct
keys; a persona may reuse its key across hosts. Never guess an account or move
client credentials between identities.

Native Git configuration enables SSH commit/tag signing globally. Repository
remotes select name, email and signing key regardless of checkout location.
Git-invoked transport and signing guards check endpoint routing and signing identity.
Use `wt-identity.mjs bind {account}` for mixed-account or remote-less repositories;
this creates an approved local identity include. Do not disable signing or use a
global personal signer to work around missing or ambiguous configuration.

`wt-enforce-signing.mjs --dry-run` audits generated configuration and primary clones.
The local allowed-signers file includes current and preserved historical trust.
Git flags can be explicitly overridden; acceptance requirements for SSH-only
signatures/approved signers require repository-side checks.

## Completing changes

When the configuration's `settings.commitAndPush` is `true`: any task that
creates, deletes, or modifies more than one file in Git-backed work must be
committed in every affected repository and pushed before the task is complete.
Stage only the task's changes and push the current worktree branch. A local
commit without a successful push does not complete the task. Never initialize
Git or invent a remote for a directory that is not already a repository.

When it is `false`: commit and push only when the user asks.

After every push, run the post-push check for that repository and require
exit status 0:

```sh
scripts/wt-sync.mjs {owner}/{repo} [--host {host}] --strict --verify-branch {ticket}
```

A skipped fast-forward (exit 2) or a mismatched branch (exit 3) means the push
is not complete. Resolve the cause; never discard changes in a primary clone to
force an update.

## Bulk cloning

Use `clone-mine.mjs` for bulk cloning. Its authored-commit filter defines which
repositories qualify. Requests such as "clone all my repos", "all orgs", or
"everything I have access to" mean every qualifying repository within that
scope; they do not authorize bypassing the filter.

- Do not add supplemental cloning passes, call the cloning functions directly,
  write replacement loops, or change the filter.
- `clone-all.mjs` ignores authorship. Run it only when the user explicitly asks
  to include repositories they never committed to. If that intent is unclear,
  complete the normal `clone-mine.mjs` run, report it, and ask before expanding.
- Skipped repositories are expected results, not missing work.

The bulk filter does not restrict direct cloning of one specifically requested
repository. Use `wt-create.mjs` when a task worktree is useful.

## Path casing

Owner and repository names are matched case-insensitively. A unique existing
clone or owner directory is reused with its actual spelling; new names use the
host's returned spelling. Multiple case variants are an error, even when one
matches exactly: run `wt-audit-paths.mjs` and reconcile them (preserving state
in `quarantine/` first) before retrying. Creation holds `.wt-create.lock` at the
workspace root; if a creator crashed, confirm none is running before removing it.

## Research

Capture every research request under `research/` instead of leaving it only in
the conversation:

```text
research/
├── TOPICS.md
└── {YYYY}/{MM}/{DD}/{topic-slug}/
    ├── README.md                  the question, in full detail
    ├── findings-{subtopic}.md     one per subagent
    ├── SUMMARY.md                 synthesis of all findings
    ├── CATALOG.md                 optional: an inventory, when that is the deliverable
    └── PLAN.md                    optional: an agreed plan that follows from the research
```

1. Create the dated topic folder and add a row to `TOPICS.md`: the slug, the
   folder path relative to `research/`, and a one-to-three-sentence description.
   Keep the table contiguous (no blank lines inside it).
2. Write `README.md`.
3. Split the topic into pieces and give each piece its own subagent and its own
   `findings-{subtopic}.md`; subagents never share or overwrite one file.
4. When every subagent has finished, have one final agent read all findings and
   write `SUMMARY.md`.

## Updates

Maintain helpers and shared guidance through `setup-local-source-code`, then
apply reviewed updates. Explicit local guide corrections are allowed and must
be preserved; never restore superseded restrictions on direct clones or optional
worktrees. Update mode never changes the external configuration. Incompatible
configuration requires a preserved full migration before helper deployment.
