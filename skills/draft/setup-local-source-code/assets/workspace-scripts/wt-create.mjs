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
  assertSafeSegment, configureRepositoryIdentity, ensureDirSync,
  getDefaultBranch, git, isDirectory, localBranchExists, parseOrgRepo,
  pathExists, repoPath, SOURCE_ROOT, ticketPath, worktreePath,
  canonicalRepository, withWorkspaceLock, validateWorktree, assertBranchCase,
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
  if (args.includes('-h') || args.includes('--help')) { console.log(usage()); return; }
  if (args.length !== 3) throw new Error(usage());
  let { org, repo } = parseOrgRepo(args[0]);
  const [, client, branch] = args;
  assertSafeSegment(client, 'client');
  assertSafeSegment(branch, 'ticket');
  git(['check-ref-format', '--branch', branch]);

  return withWorkspaceLock(() => {
    const identity = resolveIdentity(org);
    let repoDir = repoPath(org, repo);
    // Inspect ticket occupancy before any clone/configuration mutation.
    let worktreeDir = worktreePath(client, branch, repo);
    if (pathExists(worktreeDir)) {
      if (!isDirectory(repoDir)) throw new Error(`Worktree path is occupied without the requested primary: ${worktreeDir}`);
      validateWorktree(worktreeDir, repoDir, branch);
    }
    if (!isDirectory(repoDir)) {
      ({ org, repo } = canonicalRepository(org, repo));
      repoDir = repoPath(org, repo);
    }
    // Use the chosen primary's real spelling for a new worktree directory.
    worktreeDir = worktreePath(client, branch, path.basename(repoDir));
    if (pathExists(worktreeDir)) validateWorktree(worktreeDir, repoDir, branch);
    if (isDirectory(repoDir)) assertBranchCase(repoDir, branch);
    if (!identity.gitUserEmail) throw new Error('Configure gitUserEmail in scripts/lib/wt-config.mjs before cloning.');
    if (!isDirectory(repoDir)) {
      ensureDirSync(path.dirname(repoDir));
      git(['clone', `git@${identity.sshHost}:${org}/${repo}.git`, repoDir]);
    }
    configureRepositoryIdentity(repoDir, identity);
    if (pathExists(worktreeDir)) {
      console.log(`Already exists; identity and SSH signing were re-enforced: ${worktreeDir}`);
      return;
    }
    assertBranchCase(repoDir, branch);
    ensureDirSync(ticketPath(client, branch));
    if (localBranchExists(repoDir, branch)) {
      git(['worktree', 'add', worktreeDir, branch], { cwd: repoDir });
    } else {
      const defaultBranch = getDefaultBranch(repoDir);
      git(['worktree', 'add', '-b', branch, worktreeDir, `origin/${defaultBranch}`], { cwd: repoDir });
    }
    console.log(`Worktree ready: ${worktreeDir} (branch "${branch}")`);
  });
}

try { main(); }
catch (error) { console.error(`Error: ${error.message}`); process.exitCode = 1; }
