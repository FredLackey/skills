import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { workspaceFixture } from '../../assets/workspace-scripts/tests/helpers/workspace-fixture.mjs';
import {
  machineName,
  registrationTitle,
  validateKeyPath,
  verifyKeyPair,
} from '../../assets/workspace-scripts/lib/key-policy.mjs';
import { ensureKeys } from '../host-accounts.mjs';

const script = fileURLToPath(
  new URL('../configure-ssh-identities.mjs', import.meta.url),
);
function sshSetup(f, ...args) {
  const input = {
    ...f.config,
    identities: Object.entries(f.config.accounts).map(([id, a]) => ({
      ...a,
      id,
    })),
  };
  return spawnSync(
    process.execPath,
    [
      script,
      '--config-base64',
      Buffer.from(JSON.stringify(input)).toString('base64url'),
      ...args,
    ],
    { env: f.env, encoding: 'utf8' },
  );
}

test('key filenames and proper machine/date labels are required', () => {
  for (const name of ['id_fredlackey', 'id_ccsi', 'id_cisa']) {
    validateKeyPath(`~/.ssh/${name}`);
    validateKeyPath(`~/.ssh/${name}.pub`, { publicKey: true });
  }
  for (const name of ['id-ccsi', 'github-ccsi', 'id_ccsi.pub', 'id_'])
    assert.throws(() => validateKeyPath(name));
  for (const name of [
    'macos',
    'darwin',
    'macos.local',
    'localhost',
    'linux',
    'unknown',
    '',
  ])
    assert.throws(() => machineName(name));
  assert.equal(
    registrationTitle('Engineering Test Station', new Date(2026, 9, 23)),
    'Engineering Test Station (20261023)',
  );
});

test('registration enforces key pairing, labels both supported types, and preserves dates on rerun', (t) => {
  const f = workspaceFixture(t);
  Object.assign(process.env, f.env);
  const identity = { id: 'personal', ...f.config.accounts.personal };
  const keys = { authentication: [], signing: [] },
    mutations = [];
  const api = (account, operation, p) => {
    if (operation === 'keys') return { supported: true, keys: keys[p.type] };
    assert.equal(operation, 'addKey');
    mutations.push(p);
    keys[p.type].push(p);
    return {};
  };
  ensureKeys(identity, f.config, { api, date: () => new Date(2026, 9, 23) });
  assert.equal(mutations.length, 2);
  assert.ok(
    mutations.every((p) => p.title === 'Engineering Test Station (20261023)'),
  );
  ensureKeys(identity, f.config, { api, date: () => new Date(2027, 0, 1) });
  assert.equal(mutations.length, 2);
  const metadata = fs.readFileSync(
    path.join(path.dirname(f.configFile), 'registrations.json'),
    'utf8',
  );
  assert.match(metadata, /20261023/);
  assert.doesNotMatch(metadata, /20270101/);
  const previous = fs.readFileSync(identity.sshKeyPath + '.pub');
  fs.copyFileSync(
    f.config.accounts.work.sshKeyPath + '.pub',
    identity.sshKeyPath + '.pub',
  );
  assert.throws(() => verifyKeyPair(identity.sshKeyPath), /do not match/);
  assert.throws(() => ensureKeys(identity, f.config, { api }), /do not match/);
  assert.equal(mutations.length, 2);
  fs.writeFileSync(identity.sshKeyPath + '.pub', previous);
});

test('projected SSH checks preserve conditional Include semantics and reject actual conflicts', (t) => {
  const f = workspaceFixture(t);
  const ssh = path.join(f.root, '.ssh');
  fs.mkdirSync(path.join(ssh, 'config.d'), { recursive: true });
  const conflicting = `Host work.alpha.example\n IdentityFile "${f.config.accounts.personal.sshKeyPath}"\n`;
  fs.writeFileSync(path.join(ssh, 'config.d/other.conf'), conflicting);
  const main = path.join(ssh, 'config');
  fs.writeFileSync(main, 'Host unrelated\n Include config.d/*.conf\n');
  let result = sshSetup(f, '--dry-run');
  assert.equal(result.status, 0, result.stderr);
  fs.writeFileSync(main, 'Include config.d/*.conf\n');
  const before = fs.readFileSync(main, 'utf8');
  result = sshSetup(f, '--dry-run');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Conflicting effective/);
  assert.equal(fs.readFileSync(main, 'utf8'), before);
  fs.unlinkSync(path.join(ssh, 'config.d/other.conf'));
  result = sshSetup(f);
  assert.equal(result.status, 0, result.stderr);
  const installed = fs.readFileSync(main, 'utf8');
  assert.match(installed, /Include/);
  const preserved = path.join(f.root, 'quarantine');
  assert.ok(fs.existsSync(preserved));
  result = sshSetup(f, '--dry-run');
  assert.equal(result.status, 0, result.stderr);
});

test('dry-run and invalid input do not mutate configuration', (t) => {
  const f = workspaceFixture(t);
  const before = fs.readFileSync(f.configFile, 'utf8');
  let result = sshSetup(f, '--dry-run');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!fs.existsSync(path.join(f.root, '.ssh')));
  f.config.accounts.personal.sshKeyPath = path.join(f.root, 'id-personal');
  result = sshSetup(f);
  assert.equal(result.status, 1);
  assert.ok(!fs.existsSync(path.join(f.root, '.ssh')));
  assert.equal(fs.readFileSync(f.configFile, 'utf8'), before);
});

test('full setup preflights replacements and compatible updates leave configuration unchanged', (t) => {
  const f = workspaceFixture(t);
  const setup = fileURLToPath(
    new URL('../setup-local-source-code.mjs', import.meta.url),
  );
  const input = {
    ...f.config,
    identities: Object.entries(f.config.accounts).map(([id, a]) => ({
      ...a,
      id,
      clientName: a.label,
      orgs: Object.entries(f.config.routes[a.host])
        .filter(([, account]) => account === id)
        .map(([owner]) => owner),
    })),
  };
  const encoded = Buffer.from(JSON.stringify(input)).toString('base64url');
  const run = (args) =>
    spawnSync(process.execPath, [setup, ...args], {
      env: f.env,
      encoding: 'utf8',
    });
  const before = fs.readFileSync(f.configFile, 'utf8');
  let result = run(['--config-base64', encoded, '--dry-run']);
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(f.configFile, 'utf8'), before);
  result = run(['--config-base64', encoded, '--replace']);
  assert.equal(result.status, 0, result.stderr);
  const installed = fs.readFileSync(f.configFile, 'utf8');
  result = run(['--update', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(f.configFile, 'utf8'), installed);
  const help = f.command('wt-identity.mjs', '--help');
  assert.equal(help.status, 0, help.stderr);
  assert.ok(fs.existsSync(path.join(f.root, 'quarantine')));
});

test('copied keypairs cannot masquerade as distinct persona keys', (t) => {
  const f = workspaceFixture(t);
  fs.copyFileSync(
    f.config.accounts.personal.sshKeyPath,
    f.config.accounts.work.sshKeyPath,
  );
  fs.copyFileSync(
    f.config.accounts.personal.sshKeyPath + '.pub',
    f.config.accounts.work.sshKeyPath + '.pub',
  );
  const before = fs.readFileSync(f.configFile, 'utf8');
  const result = f.command('wt-enforce-signing.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /different SSH key material/);
  assert.equal(fs.readFileSync(f.configFile, 'utf8'), before);
});

test('every documented setup and workspace entry point exposes help without API credentials', (t) => {
  const f = workspaceFixture(t);
  for (const name of fs
    .readdirSync(f.scripts)
    .filter((name) => name.endsWith('.mjs'))) {
    const result = f.command(name, '--help');
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    assert.ok(result.stdout.trim(), name);
  }
  for (const name of [
    'host-accounts.mjs',
    'configure-ssh-identities.mjs',
    'setup-local-source-code.mjs',
  ]) {
    const entry = fileURLToPath(new URL('../' + name, import.meta.url));
    const result = spawnSync(process.execPath, [entry, '--help'], {
      env: f.env,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    assert.ok(result.stdout.trim(), name);
  }
});
