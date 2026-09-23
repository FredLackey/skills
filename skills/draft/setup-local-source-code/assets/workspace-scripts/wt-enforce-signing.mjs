#!/usr/bin/env node

import { resolveIdentity } from './lib/wt-config.mjs';
import {
  assertNoCaseCollisions, validatePrimary,
  configureRepositoryIdentity, gitOrNull, listPrimaryRepos, repositoryIdentitySettings,
} from './lib/wt-lib.mjs';

function usage() {
  return [
    'Usage: wt-enforce-signing.mjs [--dry-run]',
    '',
    'Checks every managed primary clone and enforces its routed author identity,',
    'SSH signing key, SSH signature format, and mandatory commit/tag signing.',
  ].join('\n');
}

function gitSupportsSshSigning() {
  const version = gitOrNull(['--version']);
  const match = version?.match(/\b(\d+)\.(\d+)(?:\.\d+)?\b/);
  return Boolean(match && (Number(match[1]) > 2 ||
    (Number(match[1]) === 2 && Number(match[2]) >= 34)));
}

function drift(repoPath, identity) {
  return repositoryIdentitySettings(identity).filter(([key, expected]) =>
    gitOrNull(['config', '--local', '--get', key], { cwd: repoPath }) !== expected);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    if (args.length !== 1) throw new Error(usage());
    console.log(usage());
    return;
  }
  if (args.some((arg) => arg !== '--dry-run') || args.filter((arg) => arg === '--dry-run').length > 1) {
    throw new Error(usage());
  }
  if (!gitSupportsSshSigning()) throw new Error('SSH signing requires Git 2.34 or newer.');
  const dryRun = args.includes('--dry-run');
  let failures = 0;
  assertNoCaseCollisions();
  const repositories = listPrimaryRepos();
  for (const entry of repositories) {
    validatePrimary(entry.path, entry.org, entry.repo);
    if (gitOrNull(['rev-parse', '--git-dir'], { cwd: entry.path }) === null) {
      console.error(`FAIL    ${entry.org}/${entry.repo}: not a Git repository`);
      failures += 1;
      continue;
    }
    const identity = resolveIdentity(entry.org);
    const differences = drift(entry.path, identity);
    if (!differences.length) {
      console.log(`KEEP    ${entry.org}/${entry.repo}: SSH signing enforced`);
      continue;
    }
    console.log(`${dryRun ? 'WOULD FIX' : 'FIX     '} ${entry.org}/${entry.repo}: ${differences.map(([key]) => key).join(', ')}`);
    if (!dryRun) {
      try {
        configureRepositoryIdentity(entry.path, identity);
        const remaining = drift(entry.path, identity);
        if (remaining.length) throw new Error(`settings still differ: ${remaining.map(([key]) => key).join(', ')}`);
      } catch (error) {
        console.error(`FAIL    ${entry.org}/${entry.repo}: ${error.message}`);
        failures += 1;
      }
    }
  }
  if (!repositories.length) console.log('No managed primary clones exist yet; future clones will enforce SSH signing.');
  if (failures) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
