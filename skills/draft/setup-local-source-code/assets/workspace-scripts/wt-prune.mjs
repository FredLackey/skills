#!/usr/bin/env node
// wt-prune.mjs [--force]
//
// Runs `git worktree prune` in every primary clone under ~/Source/repos, to
// clean up git's own stale worktree admin metadata. Separately, detects
// ~/Source/trees directories that no longer correspond to any registered
// worktree of their repo — this happens if someone deletes a worktree
// folder manually (with rm -rf) instead of via wt-remove.mjs. Without
// --force, orphaned directories are only reported (one path per line), never
// touched. With --force, they're actually removed. Either way, now-empty
// ticket folders left behind are reported but never auto-deleted — that's a
// coarser action left for a human (or wt-remove.mjs --all) to decide on.
//
// See the workspace AGENTS.md generated during setup for the full design.

import fs from 'node:fs';
import {
  getRegisteredWorktreePaths,
  assertNoCaseCollisions,
  git,
  isEmptyDir,
  listPrimaryRepos,
  listTicketFolders,
  REPOS_ROOT,
  TREES_ROOT,
} from './lib/wt-lib.mjs';

function usage() {
  return [
    'Usage: wt-prune.mjs [--force]',
    '',
    `Runs "git worktree prune" in every primary clone under ${REPOS_ROOT}.`,
    `Also detects ${TREES_ROOT} directories that no longer correspond to a`,
    'registered worktree of their repo. Without --force, only reports them.',
    'With --force, removes them.',
  ].join('\n');
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) {
    console.log(usage());
    process.exit(0);
  }

  const force = args.includes('--force');
  const unknownArgs = args.filter((a) => a !== '--force');
  if (unknownArgs.length > 0) {
    console.error(usage());
    process.exit(1);
  }

  // 1. git worktree prune, per primary repo.
  assertNoCaseCollisions();
  const primaryRepos = listPrimaryRepos();

  if (primaryRepos.length === 0) {
    console.log(`No primary clones found under ${REPOS_ROOT}.`);
  } else {
    for (const { org, repo, path: repoDir } of primaryRepos) {
      try {
        const output = git(['worktree', 'prune', '-v'], { cwd: repoDir });
        console.log(`Pruned ${org}/${repo}${output ? `:\n${output}` : ' (nothing to prune)'}`);
      } catch (err) {
        console.error(`Error: failed to prune worktrees for ${org}/${repo}\n${err.message}`);
      }
    }
  }

  console.log('');

  // 2. Detect ~/Source/trees repo subfolders no longer registered as a
  // worktree of any matching primary repo (by repo name — several orgs
  // could share a repo name, so a directory only counts as orphaned if none
  // of them still register it).
  const registeredPaths = new Set();
  for (const { path: repoDir } of primaryRepos) {
    for (const registered of getRegisteredWorktreePaths(repoDir)) registeredPaths.add(registered);
  }

  const tickets = listTicketFolders();
  const orphans = [];

  for (const ticket of tickets) {
    for (const repo of ticket.repos) {
      if (!registeredPaths.has(repo.path)) {
        orphans.push(repo.path);
      }
    }
  }

  if (orphans.length === 0) {
    console.log(`No orphaned worktree directories found under ${TREES_ROOT}.`);
  } else {
    console.log(
      `${orphans.length} orphaned worktree director${orphans.length === 1 ? 'y' : 'ies'} found ` +
        `(on disk, but no longer registered as a git worktree)${force ? ' — removing:' : ':'}`
    );
    for (const orphan of orphans) {
      console.log(orphan);
      if (force) {
        try {
          fs.rmSync(orphan, { recursive: true, force: true });
        } catch (err) {
          console.error(`Error: failed to remove ${orphan}\n${err.message}`);
        }
      }
    }
    if (!force) {
      console.log('Re-run with --force to remove them.');
    }
  }

  console.log('');

  // 3. Report (never delete) now-empty ticket folders. Re-derive from disk
  // rather than the earlier listTicketFolders() snapshot, since --force may
  // have just emptied some of them out.
  const ticketsNow = listTicketFolders();
  const emptyTickets = ticketsNow.filter((t) => isEmptyDir(t.path));

  if (emptyTickets.length > 0) {
    console.log(
      `${emptyTickets.length} ticket folder${emptyTickets.length === 1 ? ' is' : 's are'} now empty ` +
        `(left as-is — remove manually, or via "wt-remove.mjs ... --all", if you're done with them):`
    );
    for (const t of emptyTickets) {
      console.log(t.path);
    }
  }

  process.exit(0);
}

main();
