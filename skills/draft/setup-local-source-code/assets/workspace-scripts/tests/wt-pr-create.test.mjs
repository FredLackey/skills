import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { publishRepo, parseArgs } from '../wt-pr-create.mjs';
import { workspaceFixture } from './helpers/workspace-fixture.mjs';

test('publishing uses the common host operation, preserves body, and reuses existing requests', (t) => {
  const f = workspaceFixture(t);
  const bodyFile = path.join(f.root, 'body.md');
  fs.writeFileSync(bodyFile, 'Two lines\nwith `literal` text.\n');
  const repo = {
    host: 'alpha.example',
    org: 'team',
    repo: 'Api',
    branch: 'TASK',
    path: f.root,
    bodyFile,
    identity: { id: 'work' },
  };
  const options = { base: 'main', draft: true };
  let created,
    pushed = false;
  const git = (args) => {
    if (args[0] === 'rev-list') return 'first\nsecond';
    if (args[0] === 'show') return 'Change';
    if (args[0] === 'push') pushed = true;
    return '';
  };
  const api = (identity, operation, p) => {
    if (operation === 'pulls') return [];
    created = p;
    return { url: 'https://alpha.example/team/Api/pulls/1' };
  };
  assert.equal(publishRepo(repo, options, {}, { git, api }).created, true);
  assert.equal(pushed, true);
  assert.equal(created.body, fs.readFileSync(bodyFile, 'utf8'));
  assert.equal(created.draft, true);
  const existing = {
    head: 'TASK',
    base: 'main',
    repository: 'team/Api',
    url: 'https://alpha.example/team/Api/pulls/1',
  };
  assert.equal(
    publishRepo(repo, options, {}, { git, api: () => [existing] }).created,
    false,
  );
  pushed = false;
  assert.throws(
    () => publishRepo(repo, options, {}, { git: () => '', api }),
    /No commits/,
  );
  assert.equal(pushed, false);
});

test('dry-run validates ticket worktrees without API calls or network writes', (t) => {
  const f = workspaceFixture(t);
  f.repository();
  assert.equal(
    f.command('wt-create.mjs', 'personalorg/Tools', 'example', 'TASK').status,
    0,
  );
  const body = path.join(f.root, 'body.md');
  fs.writeFileSync(body, 'Change');
  const result = f.command(
    'wt-pr-create.mjs',
    'example',
    'TASK',
    'main',
    '--body-file',
    body,
    '--dry-run',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated/);
  assert.throws(() => parseArgs(['example', 'TASK', 'main']), /body-file/);
});
