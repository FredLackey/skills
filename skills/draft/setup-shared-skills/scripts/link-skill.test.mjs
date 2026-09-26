#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync,
  realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./link-skill.mjs', import.meta.url));
const linkKind = process.platform === 'win32' ? 'junction' : 'dir';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'shared skills test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'Source/repos/example-org/agent-skills/skills/stable/code-review');
  const destination = join(root, '.agents/skills/code-review');
  mkdirSync(join(source, 'references'), { recursive: true });
  mkdirSync(join(source, 'scripts'), { recursive: true });
  writeFileSync(join(source, 'SKILL.md'), '---\nname: code-review\ndescription: Review changes.\n---\n');
  writeFileSync(join(source, 'references/rules.md'), 'Original guidance.\n');
  writeFileSync(join(source, 'scripts/example.mjs'), 'export const example = true;\n');
  const run = (...args) => spawnSync(process.execPath, [script,
    '--source', source, '--destination', destination,
    ...(process.platform === 'win32' ? ['--kind', 'junction'] : []), ...args,
  ], { cwd: root, encoding: 'utf8' });
  return { root, source, destination, run };
}

function status(result, expected, code = 0) {
  assert.equal(result.status, code, result.stdout + result.stderr);
  assert.equal(JSON.parse(code === 2 ? result.stderr : result.stdout).status, expected);
}

test('preview and missing check do not create parents or links', t => {
  const f = fixture(t);
  status(f.run(), 'planned');
  assert.ok(!existsSync(dirname(f.destination)));
  status(f.run('--check'), 'missing', 1);
  assert.ok(!existsSync(dirname(f.destination)));
});

test('links a whole folder and sees updates without making copies', t => {
  const f = fixture(t);
  status(f.run('--apply'), 'linked');
  assert.ok(lstatSync(f.destination).isSymbolicLink());
  assert.equal(realpathSync(f.destination), realpathSync(f.source));
  assert.equal(readFileSync(join(f.destination, 'references/rules.md'), 'utf8'), 'Original guidance.\n');
  assert.ok(existsSync(join(f.destination, 'scripts/example.mjs')));
  writeFileSync(join(f.source, 'references/rules.md'), 'Updated guidance.\n');
  assert.equal(readFileSync(join(f.destination, 'references/rules.md'), 'utf8'), 'Updated guidance.\n');
  status(f.run('--check'), 'verified');
});

test('reuses a correct existing link without replacing it', t => {
  const f = fixture(t);
  status(f.run('--apply'), 'linked');
  const original = readlinkSync(f.destination);
  const inode = lstatSync(f.destination).ino;
  status(f.run('--apply'), 'verified');
  status(f.run(), 'verified');
  assert.equal(readlinkSync(f.destination), original);
  assert.equal(lstatSync(f.destination).ino, inode);
});

test('recognizes a relative link to the same source', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  mkdirSync(dirname(f.destination), { recursive: true });
  symlinkSync(relative(dirname(f.destination), f.source), f.destination, 'dir');
  status(f.run('--check'), 'verified');
});

test('preserves existing copied folders and their custom files', t => {
  const f = fixture(t);
  mkdirSync(f.destination, { recursive: true });
  writeFileSync(join(f.destination, 'custom.md'), 'Keep local changes.\n');
  status(f.run('--apply'), 'conflict', 1);
  status(f.run('--check'), 'conflict', 1);
  assert.equal(readFileSync(join(f.destination, 'custom.md'), 'utf8'), 'Keep local changes.\n');
  assert.ok(!lstatSync(f.destination).isSymbolicLink());
});

test('accepts a named source alias and detects when its selected release changes', t => {
  const f = fixture(t);
  const release = join(f.root, 'releases/v1');
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, 'SKILL.md'), '---\nname: code-review\ndescription: Review changes.\n---\n');
  rmSync(f.source, { recursive: true });
  symlinkSync(release, f.source, linkKind);
  status(f.run('--apply'), 'linked');
  assert.equal(realpathSync(f.destination), realpathSync(release));
  status(f.run('--check'), 'verified');
  rmSync(f.source);
  const newer = join(f.root, 'releases/v2');
  mkdirSync(newer, { recursive: true });
  writeFileSync(join(newer, 'SKILL.md'), 'Updated skill.\n');
  symlinkSync(newer, f.source, linkKind);
  status(f.run('--check'), 'conflict', 1);
  assert.equal(realpathSync(f.destination), realpathSync(release));
});

test('preserves an existing ordinary file', t => {
  const f = fixture(t);
  mkdirSync(dirname(f.destination), { recursive: true });
  writeFileSync(f.destination, 'Keep this file.\n');
  status(f.run('--apply'), 'conflict', 1);
  assert.equal(readFileSync(f.destination, 'utf8'), 'Keep this file.\n');
});

test('preserves links to another source and broken links', t => {
  const f = fixture(t);
  mkdirSync(dirname(f.destination), { recursive: true });
  const other = join(f.root, 'another-source');
  mkdirSync(other);
  symlinkSync(other, f.destination, linkKind);
  const original = readlinkSync(f.destination);
  status(f.run('--apply'), 'conflict', 1);
  rmSync(other, { recursive: true });
  status(f.run('--apply'), 'conflict', 1);
  assert.equal(readlinkSync(f.destination), original);
});

test('rejects a source without a usable SKILL.md before creating a destination', t => {
  const f = fixture(t);
  writeFileSync(join(f.source, 'SKILL.md'), '  \n');
  status(f.run('--apply'), 'error', 2);
  rmSync(join(f.source, 'SKILL.md'));
  status(f.run('--apply'), 'error', 2);
  assert.ok(!existsSync(dirname(f.destination)));
});

test('rejects an entire skills root as the destination', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [script, '--source', f.source,
    '--destination', dirname(f.destination), '--apply'], { encoding: 'utf8' });
  status(result, 'error', 2);
  assert.ok(!existsSync(dirname(f.destination)));
});

test('rejects source nesting even through a symlinked parent', t => {
  const f = fixture(t);
  const parent = join(f.root, 'alias');
  symlinkSync(f.source, parent, linkKind);
  const result = spawnSync(process.execPath, [script, '--source', f.source,
    '--destination', join(parent, 'new-parent/code-review'), '--apply'], { encoding: 'utf8' });
  status(result, 'error', 2);
  assert.ok(!existsSync(join(f.source, 'new-parent')));
});

test('reports a parent file without modifying it', t => {
  const f = fixture(t);
  const parent = join(f.root, '.agents');
  writeFileSync(parent, 'Do not replace.\n');
  status(f.run('--apply'), 'error', 2);
  assert.equal(readFileSync(parent, 'utf8'), 'Do not replace.\n');
});

test('rejects conflicting and unsupported options', t => {
  const f = fixture(t);
  status(f.run('--apply', '--check'), 'error', 2);
  status(f.run('--unknown'), 'error', 2);
  status(f.run('--kind', 'copy'), 'error', 2);
  if (process.platform !== 'win32') status(f.run('--kind', 'junction'), 'error', 2);
  assert.ok(!existsSync(dirname(f.destination)));
});
