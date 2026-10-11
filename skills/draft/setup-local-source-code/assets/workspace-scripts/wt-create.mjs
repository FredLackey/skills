#!/usr/bin/env node
// wt-create.mjs {org}/{repo} {client-or-project} {ticket-id-or-slug}
//
// Creates (or reuses) a git worktree for one repo under a ticket folder:
//   ~/Source/trees/{client-or-project}/{ticket-id-or-slug}/{repo}
// branched as {ticket-id-or-slug} (always — no per-repo override), cloning
// the repo into ~/Source/repos/{org}/{repo} first if it isn't there yet.
//
// Re-running with the same org/repo + client/ticket validates the existing
// worktree and reports it; it changes nothing. Adding a second repo to an
// existing ticket is just calling this again with a different org/repo and
// the same client/ticket.
//
// Identity and SSH signing come from the workstation configuration installed
// by wt-enforce-signing.mjs; nothing is written into the repository's config.
// See the workspace CLAUDE.md (AGENTS.md) for the full design.

import path from 'node:path';
import { resolveIdentity } from './lib/wt-config.mjs';
import { assertWorkstationReady, describeDrift, effectiveDrift } from './lib/wt-signing.mjs';
import {
  assertSafeSegment, cloneUrl, ensureDirSync,
  getDefaultBranch, git, isDirectory, localBranchExists, parseOrgRepo,
  pathExists, repoPath, SOURCE_ROOT, ticketPath, worktreePath,
  takeHostOption, canonicalRepository, withWorkspaceLock, validateWorktree, assertBranchCase,
} from './lib/wt-lib.mjs';

function usage() {
  return [
    'Usage: wt-create.mjs {org}/{repo} {client-or-project} {ticket-id-or-slug} [--host {host}]',
    '',
    'Creates a git worktree for {org}/{repo} at:',
    `  ${SOURCE_ROOT}/trees/{client-or-project}/{ticket-id-or-slug}/{repo}`,
    'branched as {ticket-id-or-slug}. Clones {org}/{repo} into',
    `${SOURCE_ROOT}/repos/{org}/{repo} first if it is not already there.`,
    '',
    'GitHub is the default host. --host selects another configured Git host',
    `(for example a Forgejo server); its clones live under ${SOURCE_ROOT}/repos/{host}/{owner}/{repo}.`,
    '',
    'The owner must be routed to an account (see wt-route.mjs). Re-running for an',
    'existing worktree only validates and reports it.',
    '',
    'Example:',
    '  wt-create.mjs example-org/billing-service example-client TASK-1423-fix-rounding',
  ].join('\n');
}

function main() {
  const { args, host } = takeHostOption(process.argv.slice(2));
  if (args.includes('-h') || args.includes('--help')) { console.log(usage()); return; }
  if (args.length !== 3) throw new Error(usage());
  let { org, repo } = parseOrgRepo(args[0]);
  const [, client, branch] = args;
  assertSafeSegment(client, 'client');
  assertSafeSegment(branch, 'ticket');
  git(['check-ref-format', '--branch', branch]);

  return withWorkspaceLock(() => {
    const identity = resolveIdentity(org, host);
    let repoDir = repoPath(org, repo, host);
    // Inspect ticket occupancy before any clone/configuration mutation.
    let worktreeDir = worktreePath(client, branch, repo);
    if (pathExists(worktreeDir)) {
      if (!isDirectory(repoDir)) throw new Error(`Worktree path is occupied without the requested primary: ${worktreeDir}`);
      validateWorktree(worktreeDir, repoDir, branch);
    }
    if (!isDirectory(repoDir)) {
      ({ org, repo } = canonicalRepository(org, repo, undefined, host));
      repoDir = repoPath(org, repo, host);
    }
    // Use the chosen primary's real spelling for a new worktree directory.
    worktreeDir = worktreePath(client, branch, path.basename(repoDir));
    if (pathExists(worktreeDir)) validateWorktree(worktreeDir, repoDir, branch);
    if (isDirectory(repoDir)) assertBranchCase(repoDir, branch);
    assertWorkstationReady();
    const cloned = !isDirectory(repoDir);
    if (cloned) {
      ensureDirSync(path.dirname(repoDir));
      git(['clone', cloneUrl(org, repo, identity), repoDir]);
    }
    const drift = effectiveDrift(repoDir, identity);
    if (drift.length && cloned) {
      throw new Error(`New clone ${repoDir} does not resolve to the ${identity.id} account's identity: ${describeDrift(drift)}. ` +
        'Check the global Git configuration, then run wt-enforce-signing.mjs --dry-run.');
    }
    if (drift.length) {
      console.warn(`Warning: ${repoDir} overrides the ${identity.id} account's identity: ${describeDrift(drift)}. ` +
        'Run wt-enforce-signing.mjs --dry-run for details.');
    }
    if (pathExists(worktreeDir)) {
      console.log(`Already exists (no changes made): ${worktreeDir}`);
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
