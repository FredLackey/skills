import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { reconcileSshIdentity } from './persistent-ssh.mjs';

test('unrelated networks and distinct keys survive repeat and partial runs', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-portability-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = path.join(dir, 'config');
  const original = 'Host source.example\n    User developer\n';
  fs.writeFileSync(config, original, { mode: 0o600 });
  const alphaKey = path.join(dir, 'alpha key');
  const betaKey = path.join(dir, 'beta-key');
  reconcileSshIdentity(config, 'render.example', alphaKey);
  reconcileSshIdentity(config, 'laboratory.example', betaKey);
  const before = fs.readFileSync(config, 'utf8');
  assert.equal(reconcileSshIdentity(config, 'render.example', alphaKey), false);
  assert.equal(fs.readFileSync(config, 'utf8'), before);
  assert.equal(fs.readFileSync(`${config}.before-setup-multi-herdr`, 'utf8'), original);
  for (const [host, key] of [['render.example', alphaKey], ['laboratory.example', betaKey]]) {
    const r = spawnSync('ssh', ['-G', '-F', config, host], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(`identityfile ${key}\n`));
    assert.ok(r.stdout.includes('identitiesonly yes\n'));
  }
  const unrelated = spawnSync('ssh', ['-G', '-F', config, 'source.example'], { encoding: 'utf8' });
  assert.ok(unrelated.stdout.includes('user developer\n'));
  assert.ok(!unrelated.stdout.includes(alphaKey));
  assert.ok(!unrelated.stdout.includes(betaKey));
});

test('unsafe config targets and symlinks fail without overwriting files', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-config-safety-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config');
  fs.writeFileSync(file, 'original');
  const link = path.join(dir, 'link');
  fs.symlinkSync(file, link);
  assert.throws(() => reconcileSshIdentity(link, 'example.test', '/tmp/key'));
  assert.throws(() => reconcileSshIdentity(file, '*', '/tmp/key'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
});
