import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationTitle } from '../lib/key-policy.mjs';
import { createHostClient } from '../lib/host-api.mjs';

for (const provider of ['github', 'forgejo', 'bitbucket'])
  test(`shared API contract: ${provider}`, async () => {
    const calls = [];
    let keys = [];
    const identity = {
      id: 'test',
      login: 'example',
      provider,
      gitUserEmail: 'example@example.test',
    };
    const request = async (route, method, body) => {
      calls.push({ route, method, body });
      if (route === 'user') return { login: 'example', username: 'example' };
      if (route.includes('keys')) {
        if (method === 'POST') {
          keys.push(body);
          return body;
        }
        return provider === 'bitbucket' ? { values: keys } : keys;
      }
      if (route.includes('/commits'))
        return provider === 'bitbucket'
          ? { values: [{ author: { user: { nickname: 'example' } } }] }
          : [{ sha: 'commit', author: { login: 'example' } }];
      if (method === 'POST')
        return {
          html_url: 'https://code.example/team/repo/pull/1',
          links: { html: { href: 'https://code.example/team/repo/pull/1' } },
        };
      if (route.includes('pull'))
        return provider === 'bitbucket' ? { values: [] } : [];
      if (route.includes('orgs') || route.startsWith('workspaces'))
        return provider === 'bitbucket'
          ? { values: [{ slug: 'team' }] }
          : [{ login: 'team' }];
      return { full_name: 'team/repo', name: 'repo', owner: { login: 'team' } };
    };
    const api = createHostClient(identity, request, {
      machineName: 'Engineering Station',
      expectedKey: 'ssh-ed25519 AAA',
    });
    assert.equal((await api('validate')).valid, true);
    assert.deepEqual(await api('owners'), [{ login: 'team' }]);
    assert.equal(
      (await api('repository', { owner: 'team', repo: 'repo' })).full_name,
      'team/repo',
    );
    assert.equal(await api('authored', { owner: 'team', repo: 'repo' }), true);
    const signing = await api('keys', { type: 'signing' });
    assert.equal(signing.supported, provider === 'github');
    await api('addKey', {
      type: 'authentication',
      key: 'ssh-ed25519 AAA',
      title: registrationTitle('Engineering Station'),
    });
    assert.equal(
      (await api('keys', { type: 'authentication' })).keys.length,
      1,
    );
    assert.equal(
      (
        await api('createPull', {
          owner: 'team',
          repo: 'repo',
          title: 'Change',
          head: 'task',
          base: 'main',
          draft: true,
        })
      ).url,
      'https://code.example/team/repo/pull/1',
    );
    const body = calls.find(
      (c) => c.method === 'POST' && !c.route.includes('keys'),
    ).body;
    assert.ok(body.title);
    assert.ok(body.head || body.source);
  });

test('every operation verifies the selected account and handles pagination', async () => {
  const identity = { provider: 'bitbucket', login: 'expected' };
  const mismatch = createHostClient(identity, async () => ({
    username: 'other',
  }));
  await assert.rejects(mismatch('owners'), /identity/);
  let pages = 0;
  const api = createHostClient(identity, async (route) =>
    route === 'user'
      ? { username: 'expected' }
      : ++pages === 1
        ? { values: [{ slug: 'one' }], next: 'workspaces?page=2' }
        : { values: [{ slug: 'two' }] },
  );
  assert.equal((await api('owners')).length, 2);
});

test('registration boundary rejects arbitrary labels and mismatched public keys before POST', async () => {
  let mutated = false;
  const api = createHostClient(
    { provider: 'github', login: 'example' },
    async (route, method) => {
      if (method === 'POST') mutated = true;
      return { login: 'example' };
    },
    { machineName: 'Engineering Station', expectedKey: 'ssh-ed25519 AAA' },
  );
  await assert.rejects(
    api('addKey', {
      type: 'authentication',
      title: 'macos',
      key: 'ssh-ed25519 AAA',
    }),
    /title/,
  );
  await assert.rejects(
    api('addKey', {
      type: 'authentication',
      title: registrationTitle('Engineering Station'),
      key: 'ssh-ed25519 BBB',
    }),
    /key differs/,
  );
  assert.equal(mutated, false);
});

test('repository display names do not replace canonical slugs', async () => {
  const api = createHostClient(
    { provider: 'bitbucket', login: 'example' },
    async (route) =>
      route === 'user'
        ? { username: 'example' }
        : {
            name: 'Human Readable Project',
            slug: 'actual-repo',
            full_name: 'team/actual-repo',
            workspace: { slug: 'team' },
          },
  );
  assert.equal(
    (await api('repository', { owner: 'team', repo: 'actual-repo' })).name,
    'actual-repo',
  );
});

test('API worker validates account credentials and mutation policy through its real entry point', async (t) => {
  const { workspaceFixture } = await import('./helpers/workspace-fixture.mjs');
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const f = workspaceFixture(t);
  const credential = path.join(f.root, 'credential.json');
  fs.writeFileSync(
    credential,
    JSON.stringify({
      host: 'alpha.example',
      login: 'personal',
      token: 'fixture-only-token',
    }),
    { mode: 0o600 },
  );
  f.config.accounts.personal.tokenFile = credential;
  fs.writeFileSync(f.configFile, JSON.stringify(f.config));
  const preload = path.join(f.root, 'mock-fetch.mjs'),
    mutations = path.join(f.root, 'mutations.json');
  fs.writeFileSync(
    preload,
    `import fs from 'node:fs'; globalThis.fetch = async (url, options) => { if (options.headers.Authorization !== 'Bearer fixture-only-token') throw new Error('Wrong credentials'); if (options.method === 'POST') { fs.writeFileSync(${JSON.stringify(mutations)}, options.body); return Response.json({}); } return Response.json({ login: 'personal' }); };`,
  );
  const run = (operation, params) =>
    spawnSync(
      process.execPath,
      ['--import', preload, path.join(f.scripts, 'lib/host-api.mjs')],
      {
        env: f.env,
        input: JSON.stringify({ account: 'personal', operation, params }),
        encoding: 'utf8',
      },
    );
  let result = run('validate', {});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, true);
  const key = fs
    .readFileSync(f.config.accounts.personal.sshKeyPath + '.pub', 'utf8')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
  result = run('addKey', { type: 'authentication', key, title: 'macos' });
  assert.equal(result.status, 1);
  assert.ok(!fs.existsSync(mutations));
  result = run('addKey', {
    type: 'authentication',
    key,
    title: registrationTitle(f.config.machineName),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(fs.readFileSync(mutations, 'utf8')).title,
    registrationTitle(f.config.machineName),
  );
});

for (const provider of ['github', 'forgejo', 'bitbucket'])
  test(`authorship excludes another author's commits: ${provider}`, async () => {
    const api = createHostClient(
      { provider, login: 'example', gitUserEmail: 'example@example.test' },
      async (route) => {
        if (route === 'user') return { login: 'example' };
        const values = [
          {
            author: {
              login: 'other',
              user: { nickname: 'other' },
              raw: 'Other <other@example.test>',
            },
            commit: { author: { email: 'other@example.test' } },
          },
        ];
        return provider === 'bitbucket' ? { values } : values;
      },
    );
    assert.equal(await api('authored', { owner: 'team', repo: 'Repo' }), false);
  });
