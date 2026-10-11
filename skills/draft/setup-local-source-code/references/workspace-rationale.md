# Why the Workspace Works This Way

The [convention](source-workspace-convention.md) says what the workspace is.
This document explains why, so developers can judge new situations the rules
don't spell out.

## One root, predictable paths

Everything lives under one root (`~/Source` by default) so people, agents, and
tools can find any repository from its owner and name alone, without searching
or remembering where something was cloned. Paths are derived, never chosen:
`repos/{owner}/{repo}` for the one primary clone of each repository, and
`trees/{client}/{ticket}/{repo}` for work.

## Primary clones are plumbing

Each repository is cloned once. Doing work directly in that clone means one
branch at a time, stashes that collide, and a default branch that is never
quite current. Instead, the primary clone stays on its default branch, clean,
and is only fast-forwarded. All work happens in worktrees, which share the
primary's object store, so a new task costs seconds and no extra disk for
history.

## Ticket folders group work across repositories

Real tasks often span several repositories. A ticket folder is a plain directory
holding one worktree per repository, all on a branch named after the ticket. A
reviewer, an editor window, or an agent can see the whole change in one place,
and the shared branch name ties the pull requests together by construction.
Adding a repository later is just another worktree in the same folder.

## Local-only projects stay out of Git

Scratch work, experiments, and prototypes that will never be published live in
`local/{slug}`. Keeping them out of Git avoids accidental pushes, half-initialized
repositories, and remotes nobody intended.

## Personal data stays out of shared files

The helpers and the guide are identical for everyone so that a fix made once,
in the skill, reaches every developer and every machine. Anything personal —
names, emails, accounts, organizations, keys, hosts — lives in one
configuration file outside the workspace. That keeps employer and client details
out of anything that might be shared, and keeps updates from overwriting a
person's setup.

## Routing fails closed

Developers often hold several accounts: personal, one per employer or client,
sometimes on self-hosted forges. Using the wrong one can leak access, misattribute
work, or violate an employer's policy, and the mistake is usually silent.
Guessing is the root cause, so the helpers never guess: every owner is routed to
one account, and an unknown owner stops everything until a person decides. The
cost is one command when a new organization appears; the benefit is that no
repository is ever touched with the wrong identity.

## Identity and signing belong to the workstation

Identity settings written into each repository drift: clones made by other
tools miss them, old values linger after an email changes, and auditing hundreds
of repositories is slow. Instead, the global Git configuration includes each
account's settings for its owners' directories. One place defines them, every
clone and worktree under a routed owner inherits them, and a single audit shows
anything that overrides them.

Every commit and tag is signed with SSH, using the same key that authenticates
the account, registered on the host for both purposes. Cloning is SSH-only, so
the key that pushes is the key that signs.

## Bulk cloning respects authorship

Bulk cloning everything an account can see can mean thousands of repositories
the developer never touched. The default bulk tool clones only repositories with
the developer's own commits. Cloning everything is a separate tool that runs only
on explicit request, because "clone all my repos" is far more often meant as
"everything I've worked on" than "everything I can see".

## Pushes are verified, not assumed

A push command's success doesn't prove the remote has the commit, and a helper
that quietly skips an update can look like success. The post-push check fetches,
requires the remote branch to equal the pushed commit, and treats a skipped
fast-forward of the primary as a failure. When a team enables automatic commit
and push, that check is what makes "done" mean done.

## Research is durable

Investigations are expensive and their results are easy to lose in a
conversation. Writing each one to a dated folder, indexed in one table, makes it
findable later. Splitting work across subagents with separate findings files
keeps parallel researchers from overwriting each other, and a final summary
reconciles what they found. Research reads code but never changes it, so
investigating can't leave stray branches or worktrees behind.

## Preserve before repairing

Repairs to clones, worktrees, and configuration are where data is lost. Copying
whatever could be lost into a dated quarantine folder first makes every repair
reversible, and the README in each folder explains later what it was and why it
was kept.

## Helpers are plain Node.js

The helpers are dependency-free Node.js ES modules with a shebang: one runtime on
every platform, nothing to install beyond Node and Git, and no shell
interpretation of user-supplied names.
