import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { workspaceFixture } from './helpers/workspace-fixture.mjs';

test('explicit all mode lists repositories without inspecting commit authorship', async (t) => {
  const f = workspaceFixture(t);
  Object.assign(process.env, f.env);
  const { cloneMain } = await import(
    pathToFileURL(path.join(f.scripts, 'lib/clone-repositories.mjs'))
  );
  const calls = [],
    output = [];
  const api = (identity, operation, p) => {
    calls.push(operation);
    if (operation === 'owners') return [{ login: 'team' }];
    if (operation === 'repositories')
      return [{ name: 'Any', owner: { login: p.owner } }];
    throw new Error('Authorship must not be queried.');
  };
  assert.equal(
    cloneMain(['--profile', 'second', '--dry-run'], {
      authoredOnly: false,
      api,
      log: () => {},
      output: (v) => output.push(v),
    }),
    0,
  );
  assert.deepEqual(output, ['- beta.example/team/Any']);
  assert.ok(!calls.includes('authored'));
});
