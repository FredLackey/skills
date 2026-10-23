#!/usr/bin/env node
import { identityFor, gitIncludeDir } from './lib/wt-config.mjs';
import { repositoryIdentity, readGit } from './lib/repository-policy.mjs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { assertWorkstationReady, effectiveDrift } from './lib/wt-signing.mjs';
import { preserveBeforeWrite } from './lib/preserve.mjs';

try {
  const [command, account] = process.argv.slice(2);
  if (!command || command === '--help')
    console.log(
      'Usage: wt-identity.mjs show | bind {account}\nBinding records an explicit local identity include for a remote-less or mixed-account repository.',
    );
  else if (command === 'show' && !account) console.log(repositoryIdentity().id);
  else if (command === 'bind' && account && process.argv.length === 4) {
    const identity = identityFor(account);
    assertWorkstationReady();
    const previous = readGit([
      'config',
      '--local',
      '--get',
      'source-workspace.identity',
    ]);
    if (previous && previous !== account)
      throw new Error(
        'Repository is already bound to a different identity; review its configuration before rebinding.',
      );
    const include = path.join(gitIncludeDir(), `${identity.id}.gitconfig`);
    const git = (args) =>
      execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const localFile = readGit(['rev-parse', '--git-path', 'config']);
    preserveBeforeWrite(
      [path.resolve(localFile)],
      'Binding the repository to an explicit signing identity.',
    );
    git(['config', '--local', 'source-workspace.identity', identity.id]);
    const includes =
      readGit(['config', '--local', '--get-all', 'include.path'])?.split(
        '\n',
      ) ?? [];
    if (!includes.includes(include))
      git(['config', '--local', '--add', 'include.path', include]);
    if (effectiveDrift(process.cwd(), identity).length)
      throw new Error(
        'Explicit binding conflicts with existing local settings; review the preserved configuration.',
      );
    console.log(`Bound repository to ${identity.id}.`);
  } else throw new Error('Invalid command; see --help.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
