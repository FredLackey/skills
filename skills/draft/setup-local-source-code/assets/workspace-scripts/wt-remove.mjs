#!/usr/bin/env node
// wt-remove.mjs {client-or-project} {ticket-id-or-slug} {repo} [--delete-branch]
// wt-remove.mjs {client-or-project} {ticket-id-or-slug} --all [--delete-branch]
//
// Removes one repo's worktree from a ticket folder (default), or every repo
// worktree under a ticket folder at once (--all). Refuses on uncommitted
// changes — git worktree remove already does this by default, this script
// just surfaces that refusal clearly rather than swallowing it or forcing
// through it. --delete-branch additionally deletes the local branch with
// `git branch -d` (never -D) after a successful worktree removal — another
// safety rail: an unmerged branch is reported, not force-deleted.
//
// See the workspace AGENTS.md generated during setup for the full design.

import fs from 'node:fs';
import path from 'node:path';
import {
  assertSafeSegment,
  getCurrentBranch,
  getPrimaryRepoDirFromWorktree,
  git,
  isDirectory,
  isEmptyDir,
  listTicketFolders,
  pathExists,
  ticketPath,
  TREES_ROOT,
  worktreePath,
} from './lib/wt-lib.mjs';

function usage() {
  return [
    'Usage: wt-remove.mjs {client-or-project} {ticket-id-or-slug} {repo} [--delete-branch]',
    '       wt-remove.mjs {client-or-project} {ticket-id-or-slug} --all [--delete-branch]',
    '',
    'Removes one repo worktree from a ticket folder, or (--all) every repo',
    'worktree under that ticket folder. Refuses on uncommitted changes.',
    '--delete-branch also deletes the local branch (git branch -d) after a',
    'successful removal.',
  ].join('\n');
}

/**
 * Removes a single repo's worktree. Never throws — returns a result object
 * so callers (both single-repo and --all modes) can report per-repo
 * success/failure without one failure aborting the whole run.
 */
function removeOneRepoWorktree(worktreeDir, repo, { deleteBranch }) {
  if (!isDirectory(worktreeDir)) {
    return { repo, ok: false, message: `No worktree found at ${worktreeDir}; nothing to remove.` };
  }

  const primaryRepoDir = getPrimaryRepoDirFromWorktree(worktreeDir);
  if (!primaryRepoDir) {
    return {
      repo,
      ok: false,
      message: `${worktreeDir} does not look like a git worktree (could not resolve its primary clone).`,
    };
  }

  // Capture the branch before removal — it's gone once the worktree is.
  const branch = getCurrentBranch(worktreeDir);

  try {
    git(['worktree', 'remove', worktreeDir], { cwd: primaryRepoDir });
  } catch (err) {
    return {
      repo,
      ok: false,
      message: `Failed to remove worktree ${worktreeDir}:\n${err.message}`,
    };
  }

  // git worktree remove normally deletes the directory itself; clean up
  // only if it left an empty husk behind, never a non-empty one.
  if (pathExists(worktreeDir)) {
    if (isEmptyDir(worktreeDir)) {
      fs.rmdirSync(worktreeDir);
    } else {
      return {
        repo,
        ok: false,
        message:
          `Worktree removed from git, but ${worktreeDir} still exists and is not empty. ` +
          `Left in place — inspect and remove it manually.`,
      };
    }
  }

  const messages = [`Removed worktree: ${worktreeDir}`];

  if (deleteBranch) {
    if (!branch) {
      messages.push('Skipped branch deletion: worktree was in detached HEAD state.');
    } else {
      try {
        git(['branch', '-d', branch], { cwd: primaryRepoDir });
        messages.push(`Deleted local branch "${branch}" in ${primaryRepoDir}.`);
      } catch (err) {
        return {
          repo,
          ok: false,
          message: `${messages.join(' ')} Failed to delete branch "${branch}": ${err.message}`,
        };
      }
    }
  }

  return { repo, ok: true, message: messages.join(' ') };
}

function main() {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.includes('-h') || rawArgs.includes('--help')) {
    console.log(usage());
    process.exit(0);
  }

  const deleteBranch = rawArgs.includes('--delete-branch');
  const all = rawArgs.includes('--all');
  const positionals = rawArgs.filter((a) => a !== '--delete-branch' && a !== '--all');

  if (all && positionals.length !== 2) {
    console.error(usage());
    process.exit(1);
  }
  if (!all && positionals.length !== 3) {
    console.error(usage());
    process.exit(1);
  }

  const [clientOrProject, ticketIdOrSlug, repoArg] = positionals;

  try {
    assertSafeSegment(clientOrProject, 'client-or-project');
    assertSafeSegment(ticketIdOrSlug, 'ticket-id-or-slug');
    if (!all) assertSafeSegment(repoArg, 'repo');
  } catch (err) {
    console.error(`Error: ${err.message}\n`);
    console.error(usage());
    process.exit(1);
  }

  const ticketDir = ticketPath(clientOrProject, ticketIdOrSlug);

  if (!isDirectory(ticketDir)) {
    console.error(`Error: no ticket folder found at ${ticketDir}.`);
    process.exit(1);
  }

  if (!all) {
    const worktreeDir = worktreePath(clientOrProject, ticketIdOrSlug, repoArg);
    const result = removeOneRepoWorktree(worktreeDir, repoArg, { deleteBranch });
    console.log(result.message);
    process.exit(result.ok ? 0 : 1);
  }

  // --all mode: remove every repo worktree currently under the ticket
  // folder, one at a time, continuing past per-repo failures.
  const ticketEntry = listTicketFolders().find(
    (t) => t.client === clientOrProject && t.ticket === ticketIdOrSlug
  );
  const repos = ticketEntry ? ticketEntry.repos : [];

  if (repos.length === 0) {
    console.log(`No repo worktrees found under ${ticketDir}; nothing to remove.`);
  } else {
    console.log(`Removing ${repos.length} repo worktree(s) under ${ticketDir}:`);
  }

  let anyFailed = false;
  for (const { repo, path: worktreeDir } of repos) {
    const result = removeOneRepoWorktree(worktreeDir, repo, { deleteBranch });
    console.log(`[${result.ok ? 'ok' : 'FAILED'}] ${repo}: ${result.message}`);
    if (!result.ok) anyFailed = true;
  }

  // Clean up the ticket folder (and its client-or-project parent) if now
  // empty. Only the parent is checked for emptiness before removing it too —
  // never remove a client-or-project folder that still has other tickets.
  if (isDirectory(ticketDir) && isEmptyDir(ticketDir)) {
    fs.rmdirSync(ticketDir);
    console.log(`Removed now-empty ticket folder: ${ticketDir}`);

    const clientDir = path.join(TREES_ROOT, clientOrProject);
    if (isDirectory(clientDir) && isEmptyDir(clientDir)) {
      fs.rmdirSync(clientDir);
      console.log(`Removed now-empty client-or-project folder: ${clientDir}`);
    }
  }

  process.exit(anyFailed ? 1 : 0);
}

main();
