#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  identityFor,
  listIdentities,
  loadConfig,
  configPath,
} from '../assets/workspace-scripts/lib/wt-config.mjs';
import { hostOperation } from '../assets/workspace-scripts/lib/host-api.mjs';
import { preserveBeforeWrite } from '../assets/workspace-scripts/lib/preserve.mjs';
import {
  registrationTitle,
  validateKeyPath,
  verifyKeyPair,
} from '../assets/workspace-scripts/lib/key-policy.mjs';

export function ensureKeys(
  identity,
  config,
  { api = hostOperation, verifyOnly = false, date = () => new Date() } = {},
) {
  verifyKeyPair(identity.sshKeyPath);
  const publicPath = identity.sshKeyPath.startsWith('~/')
    ? path.join(os.homedir(), identity.sshKeyPath.slice(2) + '.pub')
    : identity.sshKeyPath + '.pub';
  const key = fs
    .readFileSync(publicPath, 'utf8')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
  if (!/^(ssh-|ecdsa-|sk-)/.test(key)) throw new Error('Invalid public key.');
  registrationTitle(config.machineName, date());
  const results = [];
  for (const type of ['authentication', 'signing']) {
    const existing = api(identity, 'keys', { type });
    if (!existing.supported) {
      results.push({ type, supported: false });
      continue;
    }
    const matches = (entry) =>
      entry.key?.trim().split(/\s+/).slice(0, 2).join(' ') === key;
    const registered = existing.keys.find(matches);
    if (registered) {
      results.push({
        type,
        supported: true,
        state: 'existing',
        title: registered.title ?? registered.label,
      });
      continue;
    }
    if (verifyOnly)
      throw new Error(`Missing ${type} registration for ${identity.id}.`);
    const title = registrationTitle(config.machineName, date());
    api(identity, 'addKey', { type, key, title });
    const verified = api(identity, 'keys', { type });
    if (!verified.supported || !verified.keys.some(matches))
      throw new Error('Host did not confirm key registration.');
    results.push({ type, supported: true, state: 'added', title });
  }
  if (!verifyOnly) {
    const file = path.join(path.dirname(configPath()), 'registrations.json');
    const previous = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, 'utf8'))
      : {};
    const fingerprint = crypto.createHash('sha256').update(key).digest('hex');
    const id = `${identity.id}:${fingerprint}`;
    previous[id] ??= { firstObservedAt: date().toISOString(), results };
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const serialized = JSON.stringify(previous, null, 2) + '\n';
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== serialized)
      preserveBeforeWrite(
        [file],
        'Updating verified key registration metadata.',
      );
    fs.writeFileSync(file, serialized, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  }
  return results;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || !argv.length) {
    console.log(
      'Usage: host-accounts.mjs inventory | validate --account {id} | owners --account {id} | ensure-keys --account {id} | verify-keys --account {id}',
    );
    return;
  }
  const [command, flag, account, ...rest] = argv;
  if (command === 'inventory' && argv.length === 1) {
    console.log(
      JSON.stringify(
        listIdentities().map(({ id, host, login }) => ({ id, host, login })),
      ),
    );
    return;
  }
  if (flag !== '--account' || !account || rest.length)
    throw new Error('Supply one --account; see --help.');
  const identity = identityFor(account);
  if (['validate', 'owners'].includes(command))
    console.log(JSON.stringify(hostOperation(identity, command)));
  else if (['ensure-keys', 'verify-keys'].includes(command))
    console.log(
      JSON.stringify(
        ensureKeys(identity, loadConfig(), {
          verifyOnly: command === 'verify-keys',
        }),
      ),
    );
  else throw new Error('Unknown command; see --help.');
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
