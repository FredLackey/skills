# Choosing A Shared Source Checkout

This skill follows the placement conventions of
[setup-local-source-code](https://github.com/FredLackey/skills/tree/main/skills/draft/setup-local-source-code).
The essentials are included here so an installed copy of this skill works
without that sibling skill. Reading that convention does not invoke workstation
setup or authorize changing Git identities.

## Layout

Use the user's configured root; the portable default is `~/Source`:

```text
<source-root>/
├── repos/<owner>/<repository>/                  # maintained primary clone
├── trees/<project>/<task>/<repository>/         # authoring worktree
├── local/<project>/                            # projects without Git publishing
├── scripts/                                    # configured workspace helpers
└── research/                                   # durable investigations
```

For example, a repository can expose
`repos/example-org/agent-skills/skills/stable/code-review/`. The harness's
`skills/code-review` entry points to that complete directory. Inspect the
actual repository layout instead of assuming a level or subdirectory.

- Read primary clones as installation sources; make repository edits in
  worktrees. Every repository within one task uses the same task branch.
- Use existing helpers for clone creation and path resolution. Owner/repository
  matching is case-insensitive: reuse a unique existing spelling, and report
  multiple case-equivalent paths instead of guessing. Preserve task branch case.
- Discover a host namespace from local instructions. The referenced convention
  defines the default GitHub layout; it is not permission to merge repositories
  from different forges into the same path.
- Reuse a clone only after checking its origin, default branch, and working
  tree. Do not reset local changes, overwrite another repository, or switch a
  shared installation clone to a feature branch for one harness.

## With Workspace Helpers

Use the installed tools and their local `--help`; do not copy tools out of a
sibling skill or bypass their configured account routing.

- Existing primary: `wt-sync.mjs <owner>/<repository>` refreshes a clean primary
  on its default branch. It is the normal way to update a shared installation.
- Missing primary: `wt-create.mjs <owner>/<repository> <project> <task>` acquires
  the named repository and creates a task worktree. Use a descriptive setup
  task, then resolve the resulting primary path. Install links to the primary,
  not that temporary task worktree. An already-current primary can be reused
  without needless network work.
- Repository authoring: create or reuse a task worktree with `wt-create.mjs`;
  merge reviewed changes through the existing workflow, then sync the primary.
- A setup-only worktree can be removed with `wt-remove.mjs` after checking that
  it is clean and no installation points into it. Never delete pre-existing
  worktrees merely because this installation does not use them.

These are the reference helper names. If a configured workspace mandates a
different supported provider or command, use that local contract. Do not use a
bulk clone command for a single requested skill repository.

## Without Workspace Helpers

A computer does not need a full identity/bootstrap interview to install a
skill. Preserve any existing layout policy. If none exists, use `~/Source/repos`
and the owner/repository structure above, create only the required parent
directories, and clone only the requested repository using the user's existing
Git authentication. Prefer configured SSH transport in line with the reference
convention; if authentication is missing, report it and obtain the needed
direction rather than registering accounts or generating keys automatically.

Before a direct clone, check the destination for case collisions and existing
content. Use verified remote identity/spelling and argument-safe process calls.
Do not silently fall back to a second clone under a harness directory. On a
later update, verify the clean primary is on its tracked default branch, fetch,
and fast-forward only; do not force-reset or merge local work into it.

Use the current user's home directory on each OS. Examples with `~` are
notation, not literal paths to paste into APIs that do not expand them. Expand
to an absolute path before calling the link helper. Never carry another
machine's username, home path, SSH alias, or account routing into configuration.

## Revisions And Durable Targets

Default to the repository's reviewed default-branch content at the exact skill
path selected by the user. A default branch is not necessarily named `main`.
If they selected a draft, report that maturity; do not substitute stable or
rename the skill silently.

An explicit version pin needs a durable checkout dedicated to that revision
under the existing workspace policy. Keep it separate from the shared default
branch checkout, record the resolved commit, and do not automatically advance
it. An explicitly selected development worktree is usable for testing; explain
that its edits are immediately visible and its removal breaks the installation.

An ordinary clone refresh can also remove or move a skill. Verify all affected
registrations afterward. Do not claim that symlinks alone solve renamed paths,
remote distribution, or harness caching.
