import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { workspaceFixture } from './helpers/workspace-fixture.mjs';

test('real SSH commits and tags use repository identity anywhere on disk and in linked worktrees', (t) => {
  const f = workspaceFixture(t);
  for (const [owner, host, account] of [
    ['personalorg', 'alpha.example', 'personal'],
    ['team', 'alpha.example', 'work'],
    ['team', 'beta.example', 'second'],
    ['thirdteam', 'gamma.example', 'third'],
  ]) {
    const dir = f.repository(
      owner,
      'Tools',
      host,
      path.join(f.root, 'outside', account, 'checkout'),
    );
    assert.equal(f.git(dir, 'config', 'user.email'), `${account}@example.test`);
    assert.equal(f.git(dir, 'log', '-1', '--format=%G?'), 'G');
    f.git(dir, 'verify-commit', 'HEAD');
    f.git(dir, 'tag', 'release', '-m', 'Release');
    f.git(dir, 'verify-tag', 'release');
    const wt = path.join(f.root, 'worktree-' + account);
    f.git(dir, 'worktree', 'add', '-b', 'change', wt);
    f.git(wt, 'commit', '--allow-empty', '-m', 'Worktree change');
    f.git(wt, 'verify-commit', 'HEAD');
    assert.equal(
      f.git(wt, 'config', 'user.signingkey'),
      f.config.accounts[account].sshKeyPath,
    );
  }
});

test('mixed remotes reject signing until explicitly bound; no-remote and unknown repos fail', (t) => {
  const f = workspaceFixture(t);
  const dir = f.repository();
  f.git(dir, 'remote', 'add', 'upstream', 'git@alpha.example:team/Tools.git');
  let result = f.runGit(dir, ['commit', '--allow-empty', '-m', 'Ambiguous']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /different identities/);
  result = spawnSync(
    process.execPath,
    [path.join(f.scripts, 'wt-identity.mjs'), 'bind', 'personal'],
    { cwd: dir, env: f.env, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  f.git(dir, 'commit', '--allow-empty', '-m', 'Bound');
  f.git(dir, 'verify-commit', 'HEAD');
  assert.equal(f.git(dir, 'config', 'user.email'), 'personal@example.test');
  for (const remote of [null, 'git@alpha.example:unknown/Repo.git']) {
    const unknown = path.join(
      f.root,
      'unknown-' + (remote ? 'remote' : 'local'),
    );
    fs.mkdirSync(unknown);
    f.git(unknown, 'init');
    if (remote) f.git(unknown, 'remote', 'add', 'origin', remote);
    assert.notEqual(
      f.runGit(unknown, ['commit', '--allow-empty', '-m', 'Must fail']).status,
      0,
    );
  }
});

test('exact repository exceptions, casing, raw URL forms and aliases choose one signing key', (t) => {
  const f = workspaceFixture(t, (c) => {
    c.repositories['alpha.example/team/exception'] = 'personal';
  });
  for (const [i, url] of [
    'git@alpha.example:TEAM/EXCEPTION.git',
    'ssh://git@alpha.example/team/exception',
    'https://alpha.example/team/exception.git',
    'git@personal.alpha.example:team/exception.git',
  ].entries()) {
    const dir = path.join(f.root, 'form-' + i);
    fs.mkdirSync(dir);
    f.git(dir, 'init');
    f.git(dir, 'remote', 'add', 'origin', url);
    f.git(dir, 'commit', '--allow-empty', '-m', 'Exception');
    assert.equal(f.git(dir, 'config', 'user.email'), 'personal@example.test');
    f.git(dir, 'verify-commit', 'HEAD');
  }
});

test('policy guard refuses a manually overridden key; ordinary failure never disables signing', (t) => {
  const f = workspaceFixture(t);
  const dir = f.repository();
  f.git(
    dir,
    'config',
    '--local',
    'user.signingkey',
    f.config.accounts.work.sshKeyPath,
  );
  const result = f.runGit(dir, ['commit', '--allow-empty', '-m', 'Wrong key']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match/);
  assert.equal(f.git(dir, 'config', 'commit.gpgsign'), 'true');
});

test('new owner routes refresh native signing selection without path assumptions', (t) => {
  const f = workspaceFixture(t);
  const result = f.command('wt-route.mjs', 'add', 'neworg', 'work');
  assert.equal(result.status, 0, result.stderr);
  const dir = f.repository('neworg', 'New');
  f.git(dir, 'verify-commit', 'HEAD');
  assert.equal(f.git(dir, 'config', 'user.email'), 'work@example.test');
});

test('actual committer overrides are rejected while original authors can be preserved', (t) => {
  const f = workspaceFixture(t);
  const dir = f.repository();
  const wrong = f.runGit(
    dir,
    ['commit', '--allow-empty', '-m', 'Wrong committer'],
    { GIT_COMMITTER_EMAIL: 'other@example.test' },
  );
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /Committer or tagger/);
  const replay = f.runGit(
    dir,
    ['commit', '--allow-empty', '-m', 'Preserved author'],
    {
      GIT_AUTHOR_NAME: 'Original Author',
      GIT_AUTHOR_EMAIL: 'original@example.test',
    },
  );
  assert.equal(replay.status, 0, replay.stderr);
  f.git(dir, 'verify-commit', 'HEAD');
  assert.equal(
    f.git(dir, 'log', '-1', '--format=%ae'),
    'original@example.test',
  );
});

test('historical signatures remain trusted when a persona key rotates', (t) => {
  const f = workspaceFixture(t);
  const dir = f.repository();
  const old = f.git(dir, 'rev-parse', 'HEAD');
  const key = path.join(f.root, 'keys/id_personalnext');
  const generated = spawnSync('ssh-keygen', [
    '-q',
    '-t',
    'ed25519',
    '-N',
    '',
    '-f',
    key,
  ]);
  assert.equal(generated.status, 0);
  f.config.accounts.personal.sshKeyPath = key;
  fs.writeFileSync(f.configFile, JSON.stringify(f.config));
  const result = f.command('wt-enforce-signing.mjs');
  assert.equal(result.status, 0, result.stderr);
  f.git(dir, 'verify-commit', old);
  f.git(dir, 'commit', '--allow-empty', '-m', 'New key');
  f.git(dir, 'verify-commit', 'HEAD');
});

test('one persona can use the same key across hosts without ambiguous signing', (t) => {
  const f = workspaceFixture(t, (c) => {
    for (const field of ['gitName', 'gitEmail', 'sshKeyPath'])
      c.accounts.second[field] = c.accounts.personal[field];
  });
  const dir = f.repository();
  f.git(dir, 'remote', 'add', 'upstream', 'git@beta.example:team/Tools.git');
  f.git(dir, 'commit', '--allow-empty', '-m', 'Same persona');
  f.git(dir, 'verify-commit', 'HEAD');
});

test('Git-invoked SSH routing selects the endpoint identity, including casing and exact exceptions', (t) => {
  const f = workspaceFixture(t, (c) => {
    c.repositories['alpha.example/team/exception'] = 'personal';
  });
  const bin = path.join(f.root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, 'ssh'),
    '#!/usr/bin/env node\nconst accounts = ' +
      JSON.stringify(f.config.accounts) +
      '; const a = process.argv.slice(2); if (a.includes("-G")) { const account = Object.values(accounts).find(v => a.includes("git@" + v.sshHost)); process.stdout.write("hostname " + account.host + "\\nuser git\\nport " + (account.host === "beta.example" ? 2222 : 22) + "\\nidentitiesonly yes\\nidentityfile " + account.sshKeyPath + "\\n"); } else process.stdout.write(JSON.stringify(a));\n',
    { mode: 0o755 },
  );
  const run = (destination, command, ...options) =>
    spawnSync(
      process.execPath,
      [path.join(f.scripts, 'wt-ssh.mjs'), ...options, destination, command],
      {
        env: { ...f.env, PATH: bin + path.delimiter + f.env.PATH },
        encoding: 'utf8',
      },
    );
  let result = run('git@alpha.example', "git-upload-pack 'TEAM/EXCEPTION.git'");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).includes('git@personal.alpha.example'));
  result = run('git@alpha.example', "git-receive-pack 'TEAM/Ordinary.git'");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).includes('git@work.alpha.example'));
  result = run(
    'git@beta.example',
    "git-upload-pack 'team/Tools.git'",
    '-p',
    '2222',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).includes('git@second.beta.example'));
  assert.equal(
    run('git@alpha.example', "git-upload-pack 'unknown/Repo.git'").status,
    1,
  );
  assert.equal(
    run('git@personal.alpha.example', "git-upload-pack 'team/Ordinary.git'")
      .status,
    1,
  );
});

test('post-push verification retains strict skipped/mismatched exit codes and preserves dirty work', (t) => {
  const f = workspaceFixture(t);
  const dir = f.repository();
  f.git(dir, 'branch', 'TASK');
  f.git(dir, 'update-ref', 'refs/remotes/origin/TASK', 'HEAD');
  const bin = path.join(f.root, 'sync-bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, 'git'),
    '#!/usr/bin/env node\nconst a=process.argv.slice(2); if (["fetch","pull"].includes(a[0])) process.exit(0); const r=require("node:child_process").spawnSync("git",a,{env:{...process.env,PATH:' +
      JSON.stringify(f.env.PATH) +
      '},stdio:"inherit"}); process.exit(r.status ?? 1);\n',
    { mode: 0o755 },
  );
  const run = () =>
    spawnSync(
      process.execPath,
      [
        path.join(f.scripts, 'wt-sync.mjs'),
        'personalorg/Tools',
        '--strict',
        '--verify-branch',
        'TASK',
      ],
      {
        env: { ...f.env, PATH: bin + path.delimiter + f.env.PATH },
        encoding: 'utf8',
      },
    );
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  f.git(dir, 'switch', 'TASK');
  result = run();
  assert.equal(result.status, 2, result.stderr);
  f.git(dir, 'commit', '--allow-empty', '-m', 'Unpushed change');
  result = run();
  assert.equal(result.status, 3, result.stderr);
  f.git(dir, 'update-ref', 'refs/remotes/origin/TASK', 'HEAD');
  f.git(dir, 'switch', 'main');
  fs.writeFileSync(path.join(dir, 'uncommitted.txt'), 'Keep this work');
  result = run();
  assert.equal(result.status, 2, result.stderr);
  assert.equal(
    fs.readFileSync(path.join(dir, 'uncommitted.txt'), 'utf8'),
    'Keep this work',
  );
});

test('dot-prefixed repository names support ownership routes and exact exceptions', (t) => {
  const f = workspaceFixture(t, (c) => {
    c.repositories['alpha.example/team/.github'] = 'personal';
  });
  const ordinary = f.repository('personalorg', '.github');
  f.git(ordinary, 'verify-commit', 'HEAD');
  const exception = f.repository('team', '.github');
  assert.equal(
    f.git(exception, 'config', 'user.email'),
    'personal@example.test',
  );
  f.git(exception, 'verify-commit', 'HEAD');
  f.git(
    exception,
    'remote',
    'set-url',
    'origin',
    'ssh://git@alpha.example/team/.github.git',
  );
  f.git(exception, 'commit', '--allow-empty', '-m', 'Dot repository SSH URL');
  f.git(exception, 'verify-commit', 'HEAD');
  for (const name of ['.', '..', '../escape']) {
    f.git(
      exception,
      'remote',
      'set-url',
      'origin',
      'git@alpha.example:team/' + name + '.git',
    );
    assert.notEqual(
      f.runGit(exception, ['commit', '--allow-empty', '-m', 'Invalid remote'])
        .status,
      0,
    );
  }
});

test('signing and verification work when PATH contains Git and SSH tools but no Node', (t) => {
  const f = workspaceFixture(t);
  const dir = f.repository();
  const minimal = path.join(f.root, 'minimal-tools');
  fs.mkdirSync(minimal);
  for (const name of ['git', 'ssh-keygen']) {
    const executable = f.env.PATH.split(path.delimiter)
      .map((directory) => path.join(directory, name))
      .find((file) => fs.existsSync(file));
    assert.ok(executable, name);
    fs.symlinkSync(executable, path.join(minimal, name));
  }
  const result = f.runGit(
    dir,
    ['commit', '--allow-empty', '-m', 'Minimal environment'],
    { PATH: minimal },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    f.runGit(dir, ['verify-commit', 'HEAD'], { PATH: minimal }).status,
    0,
  );
  assert.equal(
    f.runGit(dir, ['tag', 'minimal-path', '-m', 'Minimal PATH tag'], {
      PATH: minimal,
    }).status,
    0,
  );
  assert.equal(
    f.runGit(dir, ['verify-tag', 'minimal-path'], { PATH: minimal }).status,
    0,
  );
});
