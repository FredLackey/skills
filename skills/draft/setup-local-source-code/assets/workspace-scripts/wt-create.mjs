#!/usr/bin/env node
// wt-create.mjs {org}/{repo} {client-or-project} {ticket-id-or-slug}
//
// Creates (or reuses) a git worktree for one repo under a ticket folder:
//   ~/Source/trees/{client-or-project}/{ticket-id-or-slug}/{repo}
// branched as {ticket-id-or-slug} (always — no per-repo override), cloning
// the repo into ~/Source/repos/{org}/{repo} first if it isn't there yet.
//
// Idempotent per-repo: re-running with the same org/repo + client/ticket
// re-enforces identity/signing and reports the worktree already exists. Adding a
// second repo to an existing ticket is just calling this again with a
// different org/repo and the same client/ticket.
//
// See the workspace AGENTS.md generated during setup for the full design.

import path from 'node:path';
import { resolveIdentity } from './lib/wt-config.mjs';
import {
  assertSafeSegment,
  configureRepositoryIdentity,
  ensureDirSync,
  getDefaultBranch,
  git,
  isDirectory,
  localBranchExists,
  parseOrgRepo,
  pathExists,
  repoPath,
  SOURCE_ROOT,
  ticketPath,
  worktreePath,
} from './lib/wt-lib.mjs';

function usage() {
  return [
    'Usage: wt-create.mjs {org}/{repo} {client-or-project} {ticket-id-or-slug}',
    '',
    'Creates a git worktree for {org}/{repo} at:',
    `  ${SOURCE_ROOT}/trees/{client-or-project}/{ticket-id-or-slug}/{repo}`,
    'branched as {ticket-id-or-slug}. Clones {org}/{repo} into',
    `${SOURCE_ROOT}/repos/{org}/{repo} first if it is not already there.`,
    '',
    'Example:',
    '  wt-create.mjs example-org/billing-service example-client TASK-1423-fix-rounding',
  ].join('\n');
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) {
    console.log(usage());
    process.exit(0);
  }

  if (args.length !== 3) {
    console.error(usage());
    process.exit(1);
  }

  const [orgRepoArg, clientOrProject, ticketIdOrSlug] = args;

  let org, repo;
  try {
    ({ org, repo } = parseOrgRepo(orgRepoArg));
    assertSafeSegment(clientOrProject, 'client-or-project');
    assertSafeSegment(ticketIdOrSlug, 'ticket-id-or-slug');
  } catch (err) {
    console.error(`Error: ${err.message}\n`);
    console.error(usage());
    process.exit(1);
  }

  const identity = resolveIdentity(org);
  const repoDir = repoPath(org, repo);
  const worktreeDir = worktreePath(clientOrProject, ticketIdOrSlug, repo);
  const ticketDir = ticketPath(clientOrProject, ticketIdOrSlug);
  const branch = ticketIdOrSlug;

  // Clone the repo if we don't have a primary clone yet.
  if (!isDirectory(repoDir)) {
    if (!identity.gitUserEmail) {
      console.error(
        `Error: no gitUserEmail configured for the identity used by org "${org}" ` +
          `(see ${SOURCE_ROOT}/scripts/lib/wt-config.mjs).\n` +
          `Fill in that identity's gitUserEmail (its GitHub noreply address) before ` +
          `cloning repos under this org — refusing to configure a repo with a blank ` +
          `git identity.`
      );
      process.exit(1);
    }

    console.log(`Cloning ${org}/${repo} via ${identity.sshHost} into ${repoDir} ...`);
    ensureDirSync(path.dirname(repoDir));
    const cloneUrl = `git@${identity.sshHost}:${org}/${repo}.git`;
    try {
      git(['clone', cloneUrl, repoDir]);
    } catch (err) {
      console.error(`Error: failed to clone ${cloneUrl}\n${err.message}`);
      process.exit(1);
    }

  }

  // Primary clones and all of their worktrees share this local config.
  // Reapply it even when the clone already existed so signing cannot drift.
  try {
    configureRepositoryIdentity(repoDir, identity);
  } catch (err) {
    console.error(`Error: failed to enforce git identity and SSH signing in ${repoDir}.\n${err.message}`);
    process.exit(1);
  }

  // Idempotency check after enforcement: leave the existing worktree and
  // branch untouched while repairing any shared repository-config drift.
  if (pathExists(worktreeDir)) {
    console.log(`Already exists; identity and SSH signing were re-enforced: ${worktreeDir}`);
    process.exit(0);
  }

  // Create the ticket folder (and client-or-project parent) if needed. This
  // must not assume the ticket folder is new/empty — it may already contain
  // sibling repo worktrees from earlier wt-create runs.
  ensureDirSync(ticketDir);

  try {
    if (localBranchExists(repoDir, branch)) {
      // Branch already exists locally (e.g. another repo in this ticket was
      // created first, or a previous partial run). Reuse it as-is.
      console.log(`Branch "${branch}" already exists in ${repoDir}; adding worktree from it.`);
      git(['worktree', 'add', worktreeDir, branch], { cwd: repoDir });
    } else {
      const defaultBranch = getDefaultBranch(repoDir);
      console.log(`Creating branch "${branch}" from origin/${defaultBranch} ...`);
      git(['worktree', 'add', '-b', branch, worktreeDir, `origin/${defaultBranch}`], { cwd: repoDir });
    }
  } catch (err) {
    console.error(`Error: failed to create worktree at ${worktreeDir}\n${err.message}`);
    process.exit(1);
  }

  console.log(`Worktree ready: ${worktreeDir} (branch "${branch}")`);
  process.exit(0);
}

main();
