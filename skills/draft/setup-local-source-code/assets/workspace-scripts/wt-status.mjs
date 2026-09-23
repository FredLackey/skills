#!/usr/bin/env node
// wt-status.mjs
//
// Like wt-list.mjs, but focused on git status detail per worktree: branch,
// ahead/behind vs upstream (if any), and clean/dirty state with a changed
// file count — meant to answer "is it safe to remove/switch away from any
// of these right now", so dirty worktrees are called out clearly. Read-only
// — touches nothing.
//
// See the workspace AGENTS.md generated during setup for the full design.

import {
  reportCaseCollisions,
  getChangedFileCount,
  getCurrentBranch,
  getUpstreamAheadBehind,
  gitOrNull,
  listTicketFolders,
  TREES_ROOT,
} from './lib/wt-lib.mjs';

function usage() {
  return [
    'Usage: wt-status.mjs',
    '',
    'Shows git status (branch, ahead/behind, clean/dirty) for every repo',
    `worktree under ${TREES_ROOT}, grouped by ticket folder. Dirty`,
    'worktrees are called out clearly — this is meant to answer "is it',
    'safe to remove/switch away from any of these right now".',
  ].join('\n');
}

function describeWorktree(worktreeDir) {
  const isGitDir = gitOrNull(['rev-parse', '--is-inside-work-tree'], { cwd: worktreeDir });
  if (isGitDir !== 'true') {
    return { line: 'not a git worktree', dirty: false };
  }

  const branch = getCurrentBranch(worktreeDir) ?? '(detached HEAD)';
  const changed = getChangedFileCount(worktreeDir);
  const { upstream, ahead, behind } = getUpstreamAheadBehind(worktreeDir);

  const parts = [`branch: ${branch}`];
  parts.push(upstream ? `${ahead} ahead / ${behind} behind ${upstream}` : 'no upstream');

  const dirty = changed > 0;
  const statusLabel = dirty
    ? `[DIRTY] ${changed} changed file${changed === 1 ? '' : 's'}`
    : '[clean]';
  parts.push(statusLabel);

  return { line: parts.join('  |  '), dirty };
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

  let dirtyCount = 0;

  for (const ticket of tickets) {
    console.log(`${ticket.client}/${ticket.ticket}  (${ticket.path})`);

    if (ticket.repos.length === 0) {
      console.log('  (no repo worktrees in this ticket folder)');
    } else {
      for (const repo of ticket.repos) {
        const { line, dirty } = describeWorktree(repo.path);
        if (dirty) dirtyCount += 1;
        console.log(`  ${repo.repo.padEnd(24)} ${line}`);
      }
    }
    console.log('');
  }

  if (dirtyCount > 0) {
    console.log(`${dirtyCount} worktree${dirtyCount === 1 ? '' : 's'} marked [DIRTY] above — not safe to remove as-is.`);
  } else {
    console.log('All worktrees are clean.');
  }

  process.exit(0);
}

main();
