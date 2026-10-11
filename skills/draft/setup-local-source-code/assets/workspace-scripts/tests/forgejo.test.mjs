import { FORGE_HOST } from './helpers/test-config.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hostConfig, resolveIdentity } from '../lib/wt-config.mjs';
import { parseGitHubRemote, publishForgejoRepo } from '../wt-pr-create.mjs';

test('routing selects accounts per host and validates the configured SSH port', () => {
  assert.equal(resolveIdentity('Employer-Team').ghUser, 'EmployerUser');
  assert.equal(resolveIdentity('ExampleOrg').ghUser, 'TestUser');
  const forge = resolveIdentity('ExampleOrg', FORGE_HOST);
  assert.equal(forge.provider, 'forgejo');
  assert.equal(forge.forgejoUser, 'forgeuser');
  assert.equal(forge.sshKeyPath, '~/.ssh/test-forge');
  assert.equal(hostConfig(FORGE_HOST).sshPort, 2222);
  assert.throws(() => resolveIdentity('ExampleOrg', 'unknown.example'), /Unconfigured/);
  assert.equal(parseGitHubRemote(`ssh://git@${FORGE_HOST}:2222/forgeuser/test.git`).repo, 'test');
  assert.equal(parseGitHubRemote(`git@${FORGE_HOST.toUpperCase()}:forgeuser/test.git`).host, FORGE_HOST);
  assert.throws(() => parseGitHubRemote(`ssh://git@${FORGE_HOST}:22/forgeuser/test.git`), /port/);
  assert.throws(() => parseGitHubRemote(`root@${FORGE_HOST}:forgeuser/test.git`), /user/);
});

test('Forgejo PR creates draft from first commit, preserves body, reuses existing PR', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-pr-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bodyFile = path.join(root, 'body.md'); fs.writeFileSync(bodyFile, 'Two lines\nwith `literal` content.\n');
  const identity = resolveIdentity('ExampleOrg', FORGE_HOST);
  const repo = { host: FORGE_HOST, org: 'ExampleOrg', repo: 'test', branch: 'ticket', path: root, bodyFile, identity };
  const options = { base: 'main', draft: true }; const calls = [];
  const git = args => { calls.push(args); if (args[0] === 'rev-list') return 'first\nsecond'; if (args[0] === 'show') return 'feat: first change'; return ''; };
  let created;
  const api = (host, route, method, body, login) => {
    assert.equal(host, repo.host);
    assert.equal(login, 'forgeuser');
    if (method === 'POST') { created = body; return { html_url: `https://${FORGE_HOST}/ExampleOrg/test/pulls/1` }; }
    return [];
  };
  assert.equal(publishForgejoRepo(repo, options, { git, forgejoApi: api }).created, true);
  assert.equal(created.title, '[WIP] feat: first change');
  assert.equal(created.body, fs.readFileSync(bodyFile, 'utf8'));
  assert.deepEqual(calls.find(c => c[0] === 'push'), ['push', '--set-upstream', 'origin', 'ticket:ticket']);
  const existing = { html_url: `https://${FORGE_HOST}/ExampleOrg/test/pulls/1`, head: { repo: { full_name: 'ExampleOrg/test' }, ref: 'ticket' }, base: { ref: 'main' } };
  assert.equal(publishForgejoRepo(repo, options, { git, forgejoApi: () => [existing] }).created, false);
  let pushed = false;
  assert.throws(() => publishForgejoRepo(repo, options, { git: args => { if (args[0] === 'push') pushed = true; return ''; }, forgejoApi: api }), /No commits/);
  assert.equal(pushed, false);
});
