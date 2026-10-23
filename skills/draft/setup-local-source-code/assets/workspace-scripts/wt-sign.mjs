#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { repositoryIdentity, readGit } from './lib/repository-policy.mjs';
import { expandHome } from './lib/wt-lib.mjs';

try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(
      'Git-invoked SSH signature policy guard; delegates verification to ssh-keygen.',
    );
    process.exit(0);
  }
  if (args[args.indexOf('-Y') + 1] === 'sign') {
    const identity = repositoryIdentity();
    const key = args[args.indexOf('-f') + 1];
    if (
      !key ||
      path.resolve(expandHome(key)) !==
        path.resolve(expandHome(identity.sshKeyPath))
    )
      throw new Error(
        'Selected signing key does not match repository identity; bind the intended account.',
      );
    if (
      readGit(['config', '--get', 'user.email']) !== identity.gitUserEmail ||
      readGit(['config', '--get', 'user.name']) !== identity.gitUserName
    )
      throw new Error(
        'Git author configuration differs from the repository identity.',
      );
    const payload = fs.readFileSync(args.at(-1), 'utf8').split('\n\n')[0];
    const committer = payload.match(/^(?:committer|tagger) (.+) <([^>]+)> /m);
    if (
      !committer ||
      committer[1] !== identity.gitUserName ||
      committer[2] !== identity.gitUserEmail
    )
      throw new Error(
        'Committer or tagger identity differs from the repository identity.',
      );
  }
  const result = spawnSync('ssh-keygen', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
