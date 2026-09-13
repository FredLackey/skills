#!/usr/bin/env node
// wt-sync.mjs {org}/{repo}
//
// Fetches origin and fast-forwards the default branch in the main clone at
// ~/Source/repos/{org}/{repo} (not a worktree), so that new worktrees
// created afterward (via wt-create.mjs) start from latest. Only fast-forwards
// if the main clone is currently clean and already on the default branch;
// otherwise it explains why it's skipping rather than doing anything
// destructive to whatever the main clone is currently being used for.
//
// See the workspace AGENTS.md generated during setup for the full design.

import {
  getCurrentBranch,
  getDefaultBranch,
  git,
  isDirectory,
  isWorkingTreeClean,
  parseOrgRepo,
  repoPath,
  SOURCE_ROOT,
} from './lib/wt-lib.mjs';

function usage() {
  return [
    'Usage: wt-sync.mjs {org}/{repo}',
    '',
    'Fetches origin and fast-forwards the default branch in the main clone at',
    `${SOURCE_ROOT}/repos/{org}/{repo}. Skips (without changing anything) if that`,
    'clone is dirty or checked out to a branch other than the default.',
    '',
    'Example:',
    '  wt-sync.mjs example-org/billing-service',
  ].join('\n');
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) {
    console.log(usage());
    process.exit(0);
  }

  if (args.length !== 1) {
    console.error(usage());
    process.exit(1);
  }

  let org, repo;
  try {
    ({ org, repo } = parseOrgRepo(args[0]));
  } catch (err) {
    console.error(`Error: ${err.message}\n`);
    console.error(usage());
    process.exit(1);
  }

  const repoDir = repoPath(org, repo);

  if (!isDirectory(repoDir)) {
    console.error(
      `Error: no primary clone at ${repoDir}.\n` +
        `Run "wt-create.mjs ${org}/${repo} {client-or-project} {ticket-id-or-slug}" first ` +
        `to clone it — there's nothing to sync for a repo that hasn't been cloned yet.`
    );
    process.exit(1);
  }

  console.log(`Fetching origin for ${org}/${repo} ...`);
  try {
    git(['fetch', 'origin'], { cwd: repoDir });
  } catch (err) {
    console.error(`Error: failed to fetch origin in ${repoDir}\n${err.message}`);
    process.exit(1);
  }

  let defaultBranch;
  try {
    defaultBranch = getDefaultBranch(repoDir);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const currentBranch = getCurrentBranch(repoDir);

  if (currentBranch === null) {
    console.log(
      `Skipping pull: ${repoDir} is in a detached HEAD state, not on "${defaultBranch}". ` +
        `Checkout ${defaultBranch} manually if you want to fast-forward it.`
    );
    process.exit(0);
  }

  if (currentBranch !== defaultBranch) {
    console.log(
      `Skipping pull: ${repoDir} is currently on branch "${currentBranch}", not the default ` +
        `branch "${defaultBranch}". Checkout ${defaultBranch} manually if you want to fast-forward it.`
    );
    process.exit(0);
  }

  if (!isWorkingTreeClean(repoDir)) {
    console.log(
      `Skipping pull: ${repoDir} has uncommitted changes. Commit, stash, or discard them ` +
        `first if you want to fast-forward "${defaultBranch}".`
    );
    process.exit(0);
  }

  console.log(`Fast-forwarding "${defaultBranch}" in ${repoDir} ...`);
  try {
    git(['pull', '--ff-only'], { cwd: repoDir });
  } catch (err) {
    console.error(`Error: failed to fast-forward "${defaultBranch}" in ${repoDir}\n${err.message}`);
    process.exit(1);
  }

  console.log(`Up to date: ${repoDir} (${defaultBranch})`);
  process.exit(0);
}

main();
