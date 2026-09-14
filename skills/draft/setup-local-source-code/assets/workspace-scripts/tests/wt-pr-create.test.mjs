import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanAuthEnv,
  main,
  parseArgs,
  parseGitHubRemote,
  publishRepo,
  resolveBodyFiles,
} from '../wt-pr-create.mjs';
import { defaultIdentity, identities, orgIdentity } from '../lib/wt-config.mjs';

const identity = identities[defaultIdentity];
const routedOrg = Object.entries(orgIdentity)
  .find(([, identityId]) => identityId === defaultIdentity)?.[0] ?? 'portable-test-org';

test('parses shared and repo-specific body files', () => {
  const parsed = parseArgs([
    'ptg', 'PTG-1423-fix', 'release/next', '--body-file', 'shared.md',
    '--body-file-for', 'billing-ui=ui.md', '--draft',
  ]);
  assert.equal(parsed.client, 'ptg');
  assert.equal(parsed.ticket, 'PTG-1423-fix');
  assert.equal(parsed.base, 'release/next');
  assert.equal(parsed.bodyFile, 'shared.md');
  assert.deepEqual(parsed.bodyFilesFor, [{ repo: 'billing-ui', file: 'ui.md' }]);
  assert.equal(parsed.draft, true);
});

test('rejects missing bodies, malformed mappings, and unsafe values', () => {
  for (const argv of [
    ['ptg', 'ticket', 'main'],
    ['ptg', 'ticket', 'main', '--body-file-for', 'repo'],
    ['../ptg', 'ticket', 'main', '--body-file', 'body.md'],
    ['ptg', 'ticket', '-bad', '--body-file', 'body.md'],
  ]) assert.throws(() => parseArgs(argv));
});

test('parses routed SSH remotes and rejects non-SSH origins', () => {
  assert.deepEqual(parseGitHubRemote('git@github.com-ccsi:ccsi-ptg/billing.git'), {
    transport: 'ssh', host: 'github.com-ccsi', org: 'ccsi-ptg', repo: 'billing',
  });
  assert.deepEqual(parseGitHubRemote('ssh://git@github.com/briskhaven/tools.git'), {
    transport: 'ssh', host: 'github.com', org: 'briskhaven', repo: 'tools',
  });
  assert.throws(() => parseGitHubRemote('https://github.com/briskhaven/tools.git'), /must use SSH/);
  assert.throws(() => parseGitHubRemote('git@example.com:group/subgroup/repo.git'));
});

test('resolves shared bodies with per-repo overrides and requires non-empty files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-pr-create-'));
  try {
    fs.writeFileSync(path.join(dir, 'shared.md'), 'Shared body\n');
    fs.writeFileSync(path.join(dir, 'ui.md'), 'UI body\n');
    fs.writeFileSync(path.join(dir, 'empty.md'), '  \n');
    const repos = [{ repo: 'api' }, { repo: 'ui' }];
    const bodies = resolveBodyFiles(repos, {
      bodyFile: 'shared.md', bodyFilesFor: [{ repo: 'ui', file: 'ui.md' }],
    }, dir);
    assert.equal(bodies.get('api'), path.join(dir, 'shared.md'));
    assert.equal(bodies.get('ui'), path.join(dir, 'ui.md'));
    assert.throws(() => resolveBodyFiles(repos, {
      bodyFile: 'empty.md', bodyFilesFor: [],
    }, dir), /empty/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dry run preflights every repo without authentication, push, or PR creation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-pr-create-'));
  try {
    const body = path.join(dir, 'body.md');
    fs.writeFileSync(body, '## Summary\nA useful change.\n');
    const repos = ['api', 'ui'].map((repo) => ({ repo, path: path.join(dir, repo) }));
    const calls = [];
    const fakeGit = (args, { cwd }) => {
      calls.push({ args, cwd });
      if (args[0] === 'check-ref-format') return args[2];
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return 'true';
      if (args[0] === 'rev-parse') return 'ticket';
      if (args[0] === 'status') return '';
      if (args[0] === 'remote') return `git@${identity.sshHost}:${routedOrg}/${path.basename(cwd)}.git`;
      throw new Error(`Unexpected git call: ${args.join(' ')}`);
    };
    let authenticated = false;
    let published = false;
    const messages = [];
    const status = main(['demo', 'ticket', 'main', '--body-file', body, '--dry-run'], {
      cwd: dir,
      git: fakeGit,
      getPrimaryRepoDirFromWorktree: (worktree) => path.join('/workspace/repos', routedOrg, path.basename(worktree)),
      reposRoot: '/workspace/repos',
      listTicketFolders: () => [{ client: 'demo', ticket: 'ticket', path: dir, repos }],
      verifiedAuth: () => { authenticated = true; },
      publishRepo: () => { published = true; },
      log: (message) => messages.push(message),
    });
    assert.equal(status, 0);
    assert.equal(authenticated, false);
    assert.equal(published, false);
    assert.equal(calls.length, 9);
    assert.ok(messages.some((message) => message.includes('no fetch, push, or PR creation')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('publishes only the ticket branch and creates a PR with the requested files and refs', () => {
  const gitCalls = [];
  const ghCalls = [];
  const repo = {
    org: 'briskhaven', repo: 'api', branch: 'ticket', path: '/tmp/api', bodyFile: '/tmp/api-body.md',
  };
  const result = publishRepo(repo, { base: 'develop', draft: true }, {
    env: { GH_TOKEN: 'secret' }, token: 'secret',
  }, {
    git: (args, options) => { gitCalls.push({ args, options }); return ''; },
    run: (command, args, options) => {
      ghCalls.push({ command, args, options });
      if (args[0] === 'api') return '[]';
      return 'https://github.com/briskhaven/api/pull/42';
    },
  });
  assert.deepEqual(result, { url: 'https://github.com/briskhaven/api/pull/42', created: true });
  assert.deepEqual(gitCalls[0].args, ['push', '--set-upstream', 'origin', 'ticket:ticket']);
  assert.ok(ghCalls[0].args.includes('base=develop'));
  assert.ok(ghCalls[1].args.includes('/tmp/api-body.md'));
  assert.ok(ghCalls[1].args.includes('--draft'));
});

test('reports an existing open PR without creating a duplicate', () => {
  const ghCalls = [];
  const result = publishRepo({
    org: 'briskhaven', repo: 'api', branch: 'ticket', path: '/tmp/api', bodyFile: '/tmp/body.md',
  }, { base: 'main', draft: false }, { env: {}, token: 'secret' }, {
    git: () => '',
    run: (_command, args) => {
      ghCalls.push(args);
      return JSON.stringify([{
        html_url: 'https://github.com/briskhaven/api/pull/7',
        head: { ref: 'ticket', repo: { full_name: 'briskhaven/api' } },
        base: { ref: 'main' },
      }]);
    },
  });
  assert.deepEqual(result, { url: 'https://github.com/briskhaven/api/pull/7', created: false });
  assert.equal(ghCalls.length, 1);
});

test('does not mistake a same-named fork branch for this repository branch', () => {
  const ghCalls = [];
  const result = publishRepo({
    org: 'briskhaven', repo: 'api', branch: 'ticket', path: '/tmp/api', bodyFile: '/tmp/body.md',
  }, { base: 'main', draft: false }, { env: {}, token: 'secret' }, {
    git: () => '',
    run: (_command, args) => {
      ghCalls.push(args);
      if (args[0] === 'api') return JSON.stringify([{
        html_url: 'https://github.com/briskhaven/api/pull/6',
        head: { ref: 'ticket', repo: { full_name: 'someone/api-fork' } },
        base: { ref: 'main' },
      }]);
      return 'https://github.com/briskhaven/api/pull/8';
    },
  });
  assert.deepEqual(result, { url: 'https://github.com/briskhaven/api/pull/8', created: true });
  assert.equal(ghCalls.length, 2);
});

test('rejects an invalid base branch before inspecting or publishing tickets', () => {
  let listed = false;
  assert.throws(() => main(['demo', 'ticket', 'bad..base', '--body-file', 'body.md'], {
    git: () => { throw new Error('invalid ref'); },
    listTicketFolders: () => { listed = true; return []; },
  }), /Invalid base branch/);
  assert.equal(listed, false);
});

test('rejects an origin organization that differs from the owning primary clone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-pr-create-'));
  try {
    const body = path.join(dir, 'body.md');
    fs.writeFileSync(body, 'PR body\n');
    assert.throws(() => main(['demo', 'ticket', 'main', '--body-file', body, '--dry-run'], {
      git: (args) => {
        if (args[0] === 'check-ref-format') return 'main';
        if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return 'true';
        if (args[0] === 'rev-parse') return 'ticket';
        if (args[0] === 'status') return '';
        if (args[0] === 'remote') return `git@${identity.sshHost}:org-b/api.git`;
        throw new Error(`Unexpected git call: ${args.join(' ')}`);
      },
      getPrimaryRepoDirFromWorktree: () => '/workspace/repos/org-a/api',
      reposRoot: '/workspace/repos',
      listTicketFolders: () => [{
        client: 'demo', ticket: 'ticket', path: dir, repos: [{ repo: 'api', path: path.join(dir, 'api') }],
      }],
    }), /does not match its primary clone/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('removes ambient GitHub credentials from the routed auth environment', () => {
  const names = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST', 'GH_DEBUG'];
  const saved = names.map((name) => process.env[name]);
  try {
    names.forEach((name) => { process.env[name] = 'ambient-secret'; });
    const env = cleanAuthEnv();
    names.forEach((name) => assert.equal(env[name], undefined));
    assert.equal(env.GH_PROMPT_DISABLED, '1');
  } finally {
    names.forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    });
  }
});
