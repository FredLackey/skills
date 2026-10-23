#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseRemote } from './lib/repository-policy.mjs';

try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(
      'Git-invoked SSH transport guard; routes each remote to its native SSH account alias.',
    );
    process.exit(0);
  }
  const command = args.at(-1);
  const match = command?.match(
    /^(git-upload-pack|git-receive-pack|git-upload-archive) ['"]?([a-zA-Z0-9._\/-]+)['"]?$/,
  );
  if (!match)
    throw new Error(
      'Unsupported Git SSH command; expected a repository transfer.',
    );
  let target = -1;
  for (let i = 0; i < args.length - 1; i++)
    if (/^[^@\s]+@[^@\s]+$/.test(args[i])) target = i;
  if (target < 0) throw new Error('Missing Git SSH destination.');
  const portIndex = args.indexOf('-p');
  const url =
    portIndex < 0
      ? `${args[target]}:${match[2]}`
      : `ssh://${args[target]}:${args[portIndex + 1]}/${match[2]}`;
  const { identity } = parseRemote(url);
  args[target] = `${identity.sshUser}@${identity.sshHost}`;
  if (portIndex >= 0) args.splice(portIndex, 2);
  const projected = spawnSync('ssh', ['-G', ...args.slice(0, -1)], {
    encoding: 'utf8',
  });
  if (projected.status !== 0)
    throw new Error('Native SSH configuration cannot be resolved.');
  const lines = projected.stdout.split('\n').map((line) => line.split(/ +/));
  const get = (key) =>
    lines.filter(([k]) => k === key).map(([, ...v]) => v.join(' '));
  const canonicalKey = (value) => {
    const expanded = value.startsWith('~/')
      ? path.join(os.homedir(), value.slice(2))
      : path.resolve(value);
    return fs.existsSync(expanded) ? fs.realpathSync(expanded) : expanded;
  };
  const keys = [...new Set(get('identityfile').map(canonicalKey))];
  if (
    get('hostname')[0] !== identity.sshHostname ||
    get('user')[0] !== identity.sshUser ||
    Number(get('port')[0]) !== identity.sshPort ||
    get('identitiesonly')[0] !== 'yes' ||
    keys.length !== 1 ||
    keys[0] !== canonicalKey(identity.sshKeyPath)
  )
    throw new Error(
      'Native SSH alias does not match the repository identity; reconfigure SSH before retrying.',
    );
  const result = spawnSync('ssh', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
