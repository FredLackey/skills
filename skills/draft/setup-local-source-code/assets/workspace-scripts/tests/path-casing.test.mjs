import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { workspaceFixture } from './helpers/workspace-fixture.mjs';

test('primary reuse preserves actual case; worktree branch case is exact', (t) => {
  const f = workspaceFixture(t);
  const primary = f.repository('personalorg', 'Tools');
  let result = f.command(
    'wt-create.mjs',
    'PERSONALORG/tools',
    'Example',
    'TASK-1',
  );
  assert.equal(result.status, 0, result.stderr);
  const wt = path.join(f.root, 'trees/example/TASK-1/Tools');
  assert.equal(f.git(wt, 'branch', '--show-current'), 'TASK-1');
  assert.equal(f.git(wt, 'config', 'user.email'), 'personal@example.test');
  result = f.command('wt-create.mjs', 'personalorg/tools', 'example', 'TASK-1');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Already exists/);
  assert.equal(
    f.command('wt-create.mjs', 'personalorg/tools', 'example', 'task-1').status,
    1,
  );
  assert.equal(f.git(primary, 'status', '--porcelain'), '');
});

test('all hosts share owner/repo paths; collisions fail without altering existing clone', (t) => {
  const f = workspaceFixture(t);
  const primary = f.repository('team', 'Api', 'beta.example');
  assert.equal(primary, path.join(f.root, 'repos/team/Api'));
  const before = f.git(primary, 'config', 'remote.origin.url');
  const result = f.command(
    'wt-create.mjs',
    'team/Api',
    'example',
    'TASK-2',
    '--host',
    'alpha.example',
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /origin/i);
  assert.equal(f.git(primary, 'config', 'remote.origin.url'), before);
});

test('case collisions and occupied ticket paths are refused', (t) => {
  const f = workspaceFixture(t);
  f.repository();
  if (!fs.existsSync(path.join(f.root, 'repos/PERSONALORG'))) {
    fs.mkdirSync(path.join(f.root, 'repos/PERSONALORG'));
    assert.equal(f.command('wt-audit-paths.mjs').status, 1);
  } else
    t.diagnostic(
      'Case collision creation is unavailable on this filesystem; occupied-path refusal still checked.',
    );
  fs.mkdirSync(path.join(f.root, 'trees/example/TASK-1/Tools'), {
    recursive: true,
  });
  assert.equal(
    f.command('wt-create.mjs', 'personalorg/Tools', 'example', 'TASK-1').status,
    1,
  );
});

test('explicit neutral owner directory mappings allow identical coordinates on different hosts', (t) => {
  const f = workspaceFixture(t, (c) => {
    c.ownerDirectories = { 'beta.example/team': 'team-secondary' };
  });
  f.repository('team', 'Api', 'alpha.example');
  f.repository(
    'team',
    'Api',
    'beta.example',
    path.join(f.root, 'repos/team-secondary/Api'),
  );
  const result = f.command(
    'wt-create.mjs',
    'team/Api',
    'example',
    'TASK-OTHER',
    '--host',
    'beta.example',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    f.git(
      path.join(f.root, 'trees/example/TASK-OTHER/Api'),
      'config',
      'user.email',
    ),
    'second@example.test',
  );
});

test('creation lock is released on failure; symlinked primary paths are refused', async (t) => {
  const f = workspaceFixture(t);
  const primary = f.repository();
  const { spawnSync } = await import('node:child_process');
  const { pathToFileURL } = await import('node:url');
  const module = pathToFileURL(path.join(f.scripts, 'lib/wt-lib.mjs')).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {withWorkspaceLock} from ${JSON.stringify(module)}; try { withWorkspaceLock(() => { throw new Error('intentional'); }); } catch {} `,
    ],
    { env: f.env },
  );
  assert.equal(result.status, 0);
  assert.ok(!fs.existsSync(path.join(f.root, '.wt-create.lock')));
  fs.symlinkSync(primary, path.join(f.root, 'repos/personalorg/Link'));
  const refused = f.command(
    'wt-create.mjs',
    'personalorg/Link',
    'example',
    'TASK-LINK',
  );
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /real directory/);
  assert.ok(!fs.existsSync(path.join(f.root, '.wt-create.lock')));
});
