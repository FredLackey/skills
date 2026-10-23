import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { workspaceFixture } from './helpers/workspace-fixture.mjs';

test('authorship filter applies to every routed account; wrong-account owners are never listed', async (t) => {
  const f = workspaceFixture(t);
  Object.assign(process.env, f.env);
  const { cloneMain } = await import(
    pathToFileURL(path.join(f.scripts, 'lib/clone-repositories.mjs'))
  );
  const seen = [],
    outputs = [];
  const api = (identity, operation, p) => {
    seen.push([identity.id, operation, p]);
    if (operation === 'owners')
      return [
        {
          login:
            identity.id === 'personal'
              ? 'personalorg'
              : identity.id === 'third'
                ? 'thirdteam'
                : 'team',
        },
        { login: 'unrouted' },
      ];
    if (operation === 'repositories')
      return ['authored', 'untouched'].map((name) => ({
        name,
        owner: { login: p.owner },
      }));
    if (operation === 'authored') return p.repo === 'authored';
    throw new Error('Unexpected API call.');
  };
  assert.equal(
    cloneMain(['--dry-run'], {
      authoredOnly: true,
      api,
      log: () => {},
      output: (value) => outputs.push(value),
    }),
    0,
  );
  assert.equal(outputs.length, 4);
  assert.ok(outputs.every((v) => v.endsWith('/authored')));
  assert.ok(
    !seen.some(([, op, p]) => op === 'repositories' && p.owner === 'unrouted'),
  );
});
