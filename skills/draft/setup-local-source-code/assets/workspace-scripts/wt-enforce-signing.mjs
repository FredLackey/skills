#!/usr/bin/env node
// Installs workstation-level author identity and SSH signing, then audits
// every primary clone. Repositories carry no identity or signing settings of
// their own: each routed owner directory includes its account's settings from
// the global Git configuration, and linked worktrees inherit them.

import { findIdentity } from './lib/wt-config.mjs';
import {
  describeDrift, effectiveDrift, localOverrides, removeLocalOverrides, workstationStatus, writeWorkstationFiles,
} from './lib/wt-signing.mjs';
import { assertNoCaseCollisions, gitOrNull, listPrimaryRepos } from './lib/wt-lib.mjs';

function usage() {
  return [
    'Usage: wt-enforce-signing.mjs [--dry-run] [--remove-local-overrides]',
    '',
    'Writes the workstation Git configuration generated from the workspace',
    'configuration: one include per account (name, email, SSH signing key,',
    'gpg.format=ssh, signed commits and tags) and one conditional include per',
    'routed owner directory, registered in the global Git configuration.',
    '',
    'Then checks every primary clone. A clone fails when its owner has no route,',
    'or when its effective identity/signing values differ from the routed account,',
    'for example because the repository sets its own values.',
    '',
    '  --dry-run                 Report only; write nothing.',
    '  --remove-local-overrides  Also remove identity/signing keys stored in each',
    '                            primary clone\'s own configuration.',
  ].join('\n');
}

function gitSupportsSshSigning() {
  const version = gitOrNull(['--version']);
  const match = version?.match(/\b(\d+)\.(\d+)(?:\.\d+)?\b/);
  return Boolean(match && (Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 34)));
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(usage()); return 0; }
  const known = new Set(['--dry-run', '--remove-local-overrides']);
  if (args.some(arg => !known.has(arg)) || new Set(args).size !== args.length) throw new Error(usage());
  if (!gitSupportsSshSigning()) throw new Error('SSH signing requires Git 2.34 or newer.');
  const dryRun = args.includes('--dry-run');
  const removeOverrides = args.includes('--remove-local-overrides');

  const status = dryRun ? workstationStatus() : writeWorkstationFiles({ register: true });
  for (const entry of status.files) {
    const verb = entry.state === 'keep' ? 'KEEP   ' : dryRun ? `WOULD ${entry.state.toUpperCase()}` : entry.state.toUpperCase().padEnd(7);
    console.log(`${verb} ${entry.file}`);
  }
  console.log(status.registered ? 'KEEP    global include.path' : `${dryRun ? 'WOULD ADD' : 'ADD    '} global include.path`);

  assertNoCaseCollisions();
  let failures = 0;
  let ok = 0;
  const repositories = listPrimaryRepos();
  for (const entry of repositories) {
    const name = `${entry.host ? `${entry.host}/` : ''}${entry.org}/${entry.repo}`;
    const identity = findIdentity(entry.org, entry.host);
    if (!identity) {
      console.error(`UNROUTED ${name}: add a route with wt-route.mjs add ${entry.org} {account}${entry.host ? ` --host ${entry.host}` : ''}`);
      failures += 1;
      continue;
    }
    if (removeOverrides && !dryRun) {
      const removed = removeLocalOverrides(entry.path);
      if (removed.length) console.log(`UNSET   ${name}: ${removed.join(', ')}`);
    } else if (removeOverrides && localOverrides(entry.path).length) {
      console.log(`WOULD UNSET ${name}: ${localOverrides(entry.path).join(', ')}`);
    }
    // A dry run checks against the configuration currently installed on disk.
    const drift = effectiveDrift(entry.path, identity);
    if (drift.length) {
      console.error(`DRIFT   ${name} (${identity.id}): ${describeDrift(drift)}`);
      failures += 1;
    } else ok += 1;
  }
  console.log(`Done: ${ok} of ${repositories.length} primary clone(s) resolve to their routed identity; ${failures} need attention.`);
  return failures ? 1 : 0;
}

try { process.exitCode = main(); }
catch (error) { console.error(`Error: ${error.message}`); process.exitCode = 1; }
