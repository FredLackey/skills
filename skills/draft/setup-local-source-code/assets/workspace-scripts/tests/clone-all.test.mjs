import test from 'node:test';
import assert from 'node:assert/strict';
import { main, parseArgs } from '../clone-all.mjs';
import { defaultIdentity, identities, orgIdentity } from '../lib/wt-config.mjs';

const profile = defaultIdentity;
const identity = identities[profile];
const user = identity.ghUser;
const org = Object.entries(orgIdentity)
  .find(([, identityId]) => identityId === profile)?.[0] ?? 'portable-test-org';
const repo = (name) => ({ name, owner: { login: org } });

function fixture({ argv = [], existing = [] } = {}) {
  const calls = [];
  const clones = [];
  const messages = [];
  const responses = {
    user: { login: user },
    'user/orgs?per_page=100': [[{ login: org }]],
    [`orgs/${org}/repos?per_page=100&type=all`]: [[repo('first'), repo('second')]],
  };
  const run = (command, args, options) => {
    calls.push({ command, args, env: options.env });
    assert.equal(command, 'gh');
    assert.equal(options.env.GITHUB_TOKEN, undefined);
    assert.equal(options.env.GH_DEBUG, undefined);
    if (args[0] === 'auth') {
      assert.equal(options.env.GH_TOKEN, undefined);
      if (args[1] === 'status') {
        return JSON.stringify({ hosts: { 'github.com': [{ login: user, state: 'success' }] } });
      }
      return 'test-token';
    }
    const endpoint = args[3];
    assert.ok(Object.hasOwn(responses, endpoint), `Unexpected request: ${endpoint}`);
    return JSON.stringify(responses[endpoint]);
  };
  const status = main(argv, {
    run,
    output: message => messages.push(message),
    log: message => messages.push(message),
    warn: message => messages.push(message),
    isDirectory: repoPath => existing.some(name => repoPath.endsWith(`/${name}`)),
    cloneRepo: (repoOrg, name, routedIdentity) => {
      clones.push({ org: repoOrg, name, identity: routedIdentity });
      return `OK ${name}`;
    },
  });
  return { calls, clones, messages, status };
}

test('clones every listed repository with the routed SSH identity', () => {
  const result = fixture({ argv: ['--profile', profile] });
  assert.equal(result.status, 0);
  assert.deepEqual(result.clones.map(({ name }) => name), ['first', 'second']);
  assert.ok(result.clones.every(item => item.identity === identity));

  const endpoints = result.calls
    .filter(({ args }) => args[0] === 'api')
    .map(({ args }) => args[3]);
  assert.deepEqual(endpoints, [
    'user',
    'user/orgs?per_page=100',
    `orgs/${org}/repos?per_page=100&type=all`,
  ]);
  assert.ok(endpoints.every(endpoint => !endpoint.includes('/commits')));
});

test('dry run lists every repository and does not clone', () => {
  const result = fixture({ argv: ['--profile', profile, '--dry-run'], existing: ['second'] });
  assert.equal(result.status, 0);
  assert.equal(result.clones.length, 0);
  assert.ok(result.messages.includes(`- ${org}/first`));
  assert.ok(result.messages.includes(`- ${org}/second`));
  assert.ok(result.messages.some(message => message.includes('1 would clone, 1 already present')));
});

test('argument validation accepts configured profile syntax and stays strict', () => {
  assert.deepEqual(parseArgs([]), { profile: null, dryRun: false, help: false });
  assert.equal(parseArgs([`--profile=${profile}`]).profile, profile);
  for (const args of [
    ['--profile'],
    ['--profile', '../bad'],
    ['--unknown'],
    ['--profile=x', '--profile=y'],
    ['--dry-run', '--dry-run'],
  ]) assert.throws(() => parseArgs(args));
});

test('unknown configured profile is rejected before GitHub access', () => {
  assert.throws(() => main(['--profile', 'missing'], { run: () => {
    throw new Error('GitHub should not be called');
  } }), /Unknown profile missing/);
});
