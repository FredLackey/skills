#!/usr/bin/env node
// wt-sync.mjs {org}/{repo} [--host {host}] [--strict] [--verify-branch {branch} [--commit {sha}]]
//
// Fetches origin and fast-forwards the default branch in the primary clone at
// ~/Source/repos/{org}/{repo} (not a worktree), so that new worktrees created
// afterward (via wt-create.mjs) start from latest. It only fast-forwards when
// the primary clone is clean and on the default branch; otherwise it explains
// why it skipped rather than doing anything destructive.
//
// --strict turns a skipped fast-forward into a failure, and --verify-branch
// confirms that a pushed branch's remote-tracking ref matches the commit that
// was pushed. Together they are the post-push completion check.
//
// See the workspace CLAUDE.md (AGENTS.md) for the full design.

import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  getCurrentBranch,
  getDefaultBranch,
  git,
  gitOrNull,
  isDirectory,
  isWorkingTreeClean,
  parseOrgRepo,
  repoPath,
  takeHostOption,
  SOURCE_ROOT,
} from './lib/wt-lib.mjs';

export const EXIT_SKIPPED = 2;
export const EXIT_VERIFY_FAILED = 3;

function usage() {
  return [
    'Usage: wt-sync.mjs {org}/{repo} [--host {host}] [--strict]',
    '                   [--verify-branch {branch} [--commit {sha}]]',
    '',
    'Always fetches origin. Then fast-forwards the default branch in the primary clone',
    `at ${SOURCE_ROOT}/repos/{org}/{repo}, but only when that clone is clean and`,
    'on its default branch. Otherwise it reports why it skipped and changes nothing.',
    '',
    'Options:',
    '  --host {host}            Resolve ambiguous owner routing with an explicit host.',
    `  --strict                 A skipped fast-forward exits with status ${EXIT_SKIPPED} instead of 0.`,
    '  --verify-branch {branch} After fetching, require origin/{branch} to equal the pushed',
    '                           commit: --commit {sha}, or by default the local {branch} tip.',
    `                           A mismatch exits with status ${EXIT_VERIFY_FAILED}.`,
    '',
    'Post-push check (run after every push):',
    '  wt-sync.mjs {org}/{repo} --strict --verify-branch {ticket}',
    '',
    'Exit status: 0 success; 1 error; 2 skipped under --strict; 3 verification failed.',
  ].join('\n');
}

function takeValue(args, name) {
  const index = args.findIndex(
    (arg) => arg === name || arg.startsWith(`${name}=`),
  );
  if (index === -1) return null;
  const arg = args[index];
  const value = arg.includes('=')
    ? arg.slice(name.length + 1)
    : args[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`${name} requires a value.`);
  args.splice(index, arg.includes('=') ? 1 : 2);
  if (args.some((other) => other === name || other.startsWith(`${name}=`)))
    throw new Error(`${name} may only be supplied once.`);
  return value;
}

export function parseArgs(argv) {
  const { args, host } = takeHostOption(argv);
  const help = args.includes('-h') || args.includes('--help');
  const strict = args.includes('--strict');
  const rest = args.filter((arg) => arg !== '--strict');
  const verifyBranch = takeValue(rest, '--verify-branch');
  const commit = takeValue(rest, '--commit');
  if (commit && !verifyBranch)
    throw new Error('--commit requires --verify-branch.');
  if (help) return { help };
  if (rest.length !== 1 || rest[0].startsWith('-')) throw new Error(usage());
  const { org, repo } = parseOrgRepo(rest[0]);
  if (verifyBranch) git(['check-ref-format', '--branch', verifyBranch]);
  return { help, host, strict, verifyBranch, commit, org, repo };
}

function verify(repoDir, branch, commit) {
  const expected = gitOrNull(
    [
      'rev-parse',
      '--verify',
      '--quiet',
      `${commit ?? `refs/heads/${branch}`}^{commit}`,
    ],
    { cwd: repoDir },
  );
  if (!expected)
    return `Cannot resolve ${commit ?? `local branch ${branch}`} in ${repoDir}.`;
  const remote = gitOrNull(
    [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/remotes/origin/${branch}^{commit}`,
    ],
    { cwd: repoDir },
  );
  if (!remote)
    return `origin/${branch} does not exist after fetching; the push did not land.`;
  if (remote !== expected)
    return `origin/${branch} is ${remote}, but the pushed commit is ${expected}.`;
  return null;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const { org, repo, host } = options;
  const repoDir = repoPath(org, repo, host);

  if (!isDirectory(repoDir)) {
    throw new Error(
      `No primary clone at ${repoDir}. Run "wt-create.mjs ${org}/${repo} {client-or-project} {ticket-id-or-slug}" ` +
        'first to clone it; there is nothing to sync for a repo that has not been cloned yet.',
    );
  }

  console.log(`Fetching origin for ${org}/${repo} ...`);
  git(['fetch', 'origin'], { cwd: repoDir });

  let status = 0;
  if (options.verifyBranch) {
    const problem = verify(repoDir, options.verifyBranch, options.commit);
    if (problem) {
      console.error(`Verification failed: ${problem}`);
      status = EXIT_VERIFY_FAILED;
    } else {
      console.log(
        `Verified: origin/${options.verifyBranch} matches the pushed commit.`,
      );
    }
  }

  const defaultBranch = getDefaultBranch(repoDir);
  const currentBranch = getCurrentBranch(repoDir);
  let skipped = null;
  if (currentBranch === null) {
    skipped = `${repoDir} is in a detached HEAD state, not on "${defaultBranch}".`;
  } else if (currentBranch !== defaultBranch) {
    skipped = `${repoDir} is on branch "${currentBranch}", not the default branch "${defaultBranch}".`;
  } else if (!isWorkingTreeClean(repoDir)) {
    skipped = `${repoDir} has uncommitted changes.`;
  }

  if (skipped) {
    const report = options.strict ? console.error : console.log;
    report(
      `Skipped fast-forward: ${skipped} Resolve that by hand; this command never discards changes.`,
    );
    return status || (options.strict ? EXIT_SKIPPED : 0);
  }

  console.log(`Fast-forwarding "${defaultBranch}" in ${repoDir} ...`);
  git(['pull', '--ff-only'], { cwd: repoDir });
  console.log(`Up to date: ${repoDir} (${defaultBranch})`);
  return status;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
