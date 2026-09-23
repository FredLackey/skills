#!/usr/bin/env node
// wt-list.mjs
//
// Lists every ticket folder under ~/Source/trees/{client-or-project}/{ticket}
// and the repo worktrees inside each one, grouped by ticket folder. Purely
// informational — read-only, touches nothing.
//
// See the workspace AGENTS.md generated during setup for the full design.

import {
  reportCaseCollisions,
  getChangedFileCount,
  getCurrentBranch,
  gitOrNull,
  listTicketFolders,
  TREES_ROOT,
} from './lib/wt-lib.mjs';

function usage() {
  return [
    'Usage: wt-list.mjs',
    '',
    `Lists every ticket folder under ${TREES_ROOT} and the repo worktrees`,
    'inside each one, grouped by ticket folder.',
  ].join('\n');
}

function describeWorktree(worktreeDir) {
  // gitOrNull rather than git: a subfolder might exist without being a real
  // git worktree (e.g. left behind by something outside these scripts), and
  // this is a read-only report, not a place to throw on that.
  const isGitDir = gitOrNull(['rev-parse', '--is-inside-work-tree'], { cwd: worktreeDir });
  if (isGitDir !== 'true') {
    return { branch: null, status: 'not a git worktree' };
  }

  const branch = getCurrentBranch(worktreeDir);
  const changed = getChangedFileCount(worktreeDir);
  const status = changed === 0 ? 'clean' : `dirty (${changed} changed file${changed === 1 ? '' : 's'})`;
  return { branch: branch ?? '(detached HEAD)', status };
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) {
    console.log(usage());
    process.exit(0);
  }

  if (args.length !== 0) {
    console.error(usage());
    process.exit(1);
  }

  reportCaseCollisions();
  const tickets = listTicketFolders();

  if (tickets.length === 0) {
    console.log(`No worktrees found under ${TREES_ROOT}.`);
    process.exit(0);
  }

  for (const ticket of tickets) {
    console.log(`${ticket.client}/${ticket.ticket}  (${ticket.path})`);

    if (ticket.repos.length === 0) {
      console.log('  (no repo worktrees in this ticket folder)');
    } else {
      for (const repo of ticket.repos) {
        const { branch, status } = describeWorktree(repo.path);
        console.log(`  ${repo.repo.padEnd(24)} branch: ${String(branch).padEnd(30)} ${status}`);
      }
    }
    console.log('');
  }

  process.exit(0);
}

main();
