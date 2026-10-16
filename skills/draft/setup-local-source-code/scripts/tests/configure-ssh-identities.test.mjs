import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../configure-ssh-identities.mjs', import.meta.url));
const unrelated = '# Shared server\nHost server.example.test\n  User developer\n  IdentityFile ~/.ssh/id-server\n';
const oldHost = '# Existing employer\nHost github.com-employer\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/id-old\n\n';
function fixture(t, content = oldHost + unrelated) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-setup-test-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.ssh'));
  const config = path.join(home, '.ssh/config');
  fs.writeFileSync(config, content, { mode: 0o600 });
  for (const suffix of ['', '.pub']) fs.writeFileSync(path.join(home, '.ssh/id-employer' + suffix), 'synthetic fixture');
  const sourceRoot = path.join(home, 'Source');
  const input = { sourceRoot, identities: [{ login: 'ExampleUser', sshHost: 'github.com-employer', sshKeyPath: '~/.ssh/id-employer' }] };
  const run = (...args) => spawnSync(process.execPath, [script, '--config-base64', Buffer.from(JSON.stringify(input)).toString('base64url'), ...args], {
    encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  return { home, config, sourceRoot, run, content };
}

test('conflicts fail before any SSH configuration changes', t => {
  const f = fixture(t);
  const r = f.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /migrate-existing-hosts/);
  assert.equal(fs.readFileSync(f.config, 'utf8'), f.content);
  assert.equal(fs.existsSync(path.join(f.home, '.ssh/config.d')), false);
});

test('migration preview changes nothing; apply backs up and preserves unrelated hosts', t => {
  const f = fixture(t);
  const preview = f.run('--migrate-existing-hosts', '--dry-run');
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /IdentityFile ~\/.ssh\/id-old/);
  assert.match(preview.stdout, /IdentityFile ~\/.ssh\/id-employer/);
  assert.equal(fs.readFileSync(f.config, 'utf8'), f.content);
  assert.equal(fs.existsSync(f.sourceRoot), false);
  const result = f.run('--migrate-existing-hosts');
  assert.equal(result.status, 0, result.stderr);
  const current = fs.readFileSync(f.config, 'utf8');
  assert.ok(current.includes(unrelated));
  assert.ok(!current.includes('Host github.com-employer'));
  assert.match(current, /^Include config.d\/\*/);
  const quarantine = path.join(f.sourceRoot, 'quarantine');
  const backup = path.join(quarantine, fs.readdirSync(quarantine)[0]);
  assert.equal(fs.readFileSync(path.join(backup, 'config'), 'utf8'), f.content);
  assert.ok(fs.existsSync(path.join(backup, 'README.md')));
  assert.match(fs.readFileSync(path.join(f.home, '.ssh/config.d/local-source-code.conf'), 'utf8'), /IdentityFile ~\/.ssh\/id-employer/);
  assert.equal(f.run('--migrate-existing-hosts').status, 0);
  assert.equal(fs.readdirSync(quarantine).length, 1);
});

test('shared Host and Include blocks fail closed without mutation', t => {
  for (const content of [oldHost.replace('Host github.com-employer', 'Host github.com-employer another.example.test'), oldHost + '  Include extra.conf\n']) {
    const f = fixture(t, content);
    assert.equal(f.run('--migrate-existing-hosts').status, 1);
    assert.equal(fs.readFileSync(f.config, 'utf8'), content);
    assert.equal(fs.existsSync(f.sourceRoot), false);
  }
});

test('migration respects an existing Include and preserves the previous managed fragment', t => {
  const f = fixture(t, 'Include config.d/*\n' + oldHost + unrelated);
  const dir = path.join(f.home, '.ssh/config.d');
  fs.mkdirSync(dir);
  const fragment = path.join(dir, 'local-source-code.conf');
  fs.writeFileSync(fragment, '# Previous managed fragment\n');
  assert.equal(f.run('--migrate-existing-hosts', '--dry-run').status, 1);
  assert.equal(f.run('--migrate-existing-hosts', '--replace').status, 0);
  assert.equal(fs.readFileSync(f.config, 'utf8').match(/Include config.d\/\*/g).length, 1);
  const quarantine = path.join(f.sourceRoot, 'quarantine');
  const backup = path.join(quarantine, fs.readdirSync(quarantine)[0]);
  assert.equal(fs.readFileSync(path.join(backup, 'local-source-code.conf'), 'utf8'), '# Previous managed fragment\n');
});

test('migration still backs up config when managed fragment is already current', t => {
  const f = fixture(t);
  const dir = path.join(f.home, '.ssh/config.d');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'local-source-code.conf'), 'Host github.com-employer\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/id-employer\n  IdentitiesOnly yes\n');
  assert.equal(f.run('--migrate-existing-hosts').status, 0);
  assert.ok(!fs.readFileSync(f.config, 'utf8').includes('Host github.com-employer'));
  assert.equal(fs.readdirSync(path.join(f.sourceRoot, 'quarantine')).length, 1);
});

test('direct managed Include does not hide later conflicting Host declarations', t => {
  const f = fixture(t, 'Include config.d/local-source-code.conf\n' + oldHost + unrelated);
  assert.equal(f.run('--dry-run').status, 1);
  assert.equal(fs.readFileSync(f.config, 'utf8'), f.content);
});
