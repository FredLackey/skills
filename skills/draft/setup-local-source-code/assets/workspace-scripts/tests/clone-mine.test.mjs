import test from 'node:test';
import assert from 'node:assert/strict';
import { main, parseArgs, apiForAccount, contributionReason, canScanOrg } from '../clone-mine.mjs';
import {
  defaultIdentity, identities, orgIdentity,
} from '../lib/wt-config.mjs';

const identity = identities[defaultIdentity];
const user = identity.ghUser;
const exactRoute = Object.entries(orgIdentity).find(([, identityId]) => identityId === defaultIdentity)?.[0];
const org = exactRoute ?? 'portable-test-org';
const repo = (name) => ({ name, owner: { login: org }, default_branch: 'main' });

function fixture({ dryRun = true, fail = false } = {}) {
  const calls = [];
  const clones = [];
  const messages = [];
  const responses = {
    user: { login: user },
    'user/orgs?per_page=100': [[{ login: org }]],
    [`orgs/${org}/repos?per_page=100&type=all`]: [[repo('matched'), repo('unrelated')]],
    [`repos/${org}/matched/commits?author=${user}&per_page=1`]: [{}],
    [`repos/${org}/unrelated/commits?author=${user}&per_page=1`]: [],
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
    if (fail && endpoint.includes('/matched/commits')) throw new Error('HTTP 403 rate limit');
    assert.ok(Object.hasOwn(responses, endpoint), `Unexpected request: ${endpoint}`);
    return JSON.stringify(responses[endpoint]);
  };
  const status = main(dryRun ? ['--dry-run'] : [], {
    run,
    output: (message) => messages.push(message),
    log: (message) => messages.push(message),
    warn: (message) => messages.push(message),
    isDirectory: () => false,
    cloneRepo: (repoOrg, name, routedIdentity) => {
      clones.push({ org: repoOrg, name, identity: routedIdentity });
      return `OK ${name}`;
    },
  });
  return { status, calls, clones, messages };
}

test('discovery isolates the account and clones with the routed identity', () => {
  const result = fixture({ dryRun: false });
  assert.equal(result.status, 0);
  assert.deepEqual(result.clones.map((item) => item.name), ['matched']);
  assert.equal(result.clones[0].identity.ghUser, user);
});

test('dry run makes no clone calls and emits a repository list', () => {
  const result = fixture();
  assert.equal(result.status, 0);
  assert.equal(result.clones.length, 0);
  assert.ok(result.messages.includes(`- ${org}/matched`));
});

test('API failures are reported without exposing ambient credentials', () => {
  const names = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_DEBUG'];
  const saved = names.map((name) => process.env[name]);
  try {
    names.forEach((name) => { process.env[name] = 'ambient-secret'; });
    const result = fixture({ dryRun: false, fail: true });
    assert.equal(result.status, 1);
    assert.ok(result.messages.some((message) => message.includes('HTTP 403')));
  } finally {
    names.forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    });
  }
});

test('routing and argument validation stay strict', () => {
  assert.equal(canScanOrg(org, user), true);
  assert.deepEqual(parseArgs([]), { org: null, user: null, dryRun: false, help: false });
  assert.equal(parseArgs(['--org', org, '--user', user, '--dry-run']).user, user);
  for (const args of [['--org'], ['--org', '../bad'], ['--unknown'], ['--user=x', '--user=y']]) {
    assert.throws(() => parseArgs(args));
  }
});

test('token identity mismatch aborts before organization access', () => {
  const calls = [];
  assert.throws(() => apiForAccount(user, (_, args) => {
    calls.push(args);
    return args[0] === 'auth' ? 'test-secret' : JSON.stringify({ login: 'different-user' });
  }), /identity mismatch/);
  assert.equal(calls.length, 2);
});

test('qualification makes one author-filtered commit request', () => {
  for (const response of [[], [{}]]) {
    const calls = [];
    const reason = contributionReason(org, repo('sample'), user, (endpoint) => {
      calls.push(endpoint);
      return response;
    });
    assert.deepEqual(calls, [`repos/${org}/sample/commits?author=${user}&per_page=1`]);
    assert.equal(reason, response.length ? 'authored commit' : null);
  }
});
