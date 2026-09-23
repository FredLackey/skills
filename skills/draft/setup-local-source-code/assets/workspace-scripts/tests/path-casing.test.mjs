import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const assets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-casing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts');
  fs.cpSync(assets, scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, 'lib/wt-config.mjs'), `
export const sourceRoot = ${JSON.stringify(root)};
export const defaultIdentity = 'personal';
export const identities = { personal: { ghUser: 'TestUser', gitUserName: 'Test User', gitUserEmail: 'test@example.invalid', sshHost: 'github.com', sshKeyPath: '~/.ssh/test' } };
export const orgIdentity = {};
export function resolveIdentity(org) { return org.toLowerCase().startsWith('ccsi') ? { ...identities.personal, ghUser: 'EmployerUser', sshHost: 'github.com-employer' } : identities.personal; }
`);
  const lib = await import(pathToFileURL(path.join(scripts, 'lib/wt-lib.mjs')));
  function primary(org = 'ExampleOrg', name = 'Tools') {
    const dir = path.join(root, 'repos', org, name);
    fs.mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-b', 'main');
    git(dir, 'config', 'user.name', 'Test User');
    git(dir, 'config', 'user.email', 'test@example.invalid');
    git(dir, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Initial');
    git(dir, 'remote', 'add', 'origin', `git@github.com:${org}/${name}.git`);
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    return dir;
  }
  const command = (file, ...args) => spawnSync(process.execPath, [path.join(scripts, file), ...args], { env, encoding: 'utf8' });
  return { root, scripts, lib, primary, command };
}

test('owner and repo casing reuse a legacy clone and its owner for new repos', async t => {
  const f = await fixture(t);
  const dir = f.primary('exampleorg', 'tools');
  assert.equal(f.lib.repoPath('EXAMPLEORG', 'Tools'), dir);
  assert.equal(f.lib.repoPath('ExampleOrg', 'Other'), path.join(f.root, 'repos/exampleorg/Other'));
});

test('ambiguity rejects even an exact match and split owners with disjoint repos', async t => {
  const f = await fixture(t);
  f.primary('ExampleOrg', 'Tools');
  const lower = path.join(f.root, 'repos/exampleorg');
  fs.mkdirSync(lower);
  assert.throws(() => f.lib.repoPath('ExampleOrg', 'Tools'), /Case collision/);
  assert.throws(() => f.lib.repoPath('ExampleOrg', 'New'), /Case collision/);
  assert.equal(f.command('wt-audit-paths.mjs').status, 1);
  assert.equal(f.command('wt-create.mjs', 'ExampleOrg/Tools', 'client', 'TASK-1').status, 1);
  assert.equal(fs.existsSync(path.join(f.root, '.wt-create.lock')), false);
  assert.equal(fs.existsSync(path.join(f.root, 'trees')), false);
});

test('repo-only variants, wrong origins, files and symlinks are rejected', async t => {
  const f = await fixture(t);
  const dir = f.primary();
  const other = path.join(path.dirname(dir), 'tools');
  fs.mkdirSync(other);
  assert.throws(() => f.lib.repoPath('ExampleOrg', 'Tools'), /Case collision/);
  fs.rmdirSync(other);
  git(dir, 'remote', 'set-url', 'origin', 'git@github.com:OtherOrg/Tools.git');
  assert.throws(() => f.lib.repoPath('ExampleOrg', 'Tools'), /Unexpected origin/);
  fs.writeFileSync(path.join(path.dirname(dir), 'File'), 'occupied');
  assert.throws(() => f.lib.repoPath('ExampleOrg', 'File'), /real directory/);
  fs.symlinkSync(dir, path.join(path.dirname(dir), 'Link'));
  assert.throws(() => f.lib.repoPath('ExampleOrg', 'Link'), /real directory/);
});

test('create is offline and idempotent with case variants; branch spelling remains exact', async t => {
  const f = await fixture(t);
  const dir = f.primary();
  for (const spec of ['exampleorg/tools', 'EXAMPLEORG/TOOLS']) {
    const result = f.command('wt-create.mjs', spec, 'CLIENT', 'TASK-123');
    assert.equal(result.status, 0, result.stderr);
  }
  const worktree = path.join(f.root, 'trees/client/TASK-123/Tools');
  assert.equal(git(worktree, 'branch', '--show-current'), 'TASK-123');
  assert.equal(f.lib.worktreePath('CLIENT', 'TASK-123', 'tools'), worktree);
  assert.equal(f.lib.getPrimaryRepoDirFromWorktree(worktree), dir);
  assert.equal(f.command('wt-create.mjs', 'ExampleOrg/Tools', 'client', 'task-123').status, 1);
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'repos')), ['ExampleOrg']);
});

test('same worktree basename from another owner refuses before clone or configuration', async t => {
  const f = await fixture(t);
  f.primary();
  assert.equal(f.command('wt-create.mjs', 'ExampleOrg/Tools', 'client', 'TASK-1').status, 0);
  const other = f.primary('OtherOrg');
  const before = fs.readFileSync(path.join(other, '.git/config'), 'utf8');
  const result = f.command('wt-create.mjs', 'OtherOrg/Tools', 'client', 'TASK-1');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not the requested registered worktree/);
  assert.equal(fs.readFileSync(path.join(other, '.git/config'), 'utf8'), before);
});

test('case-only branch conflicts are rejected before configuration or worktree creation', async t => {
  const f = await fixture(t);
  const dir = f.primary();
  git(dir, 'branch', 'task-1');
  const before = fs.readFileSync(path.join(dir, '.git/config'), 'utf8');
  const result = f.command('wt-create.mjs', 'ExampleOrg/Tools', 'client', 'TASK-1');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Branch case collision/);
  assert.equal(fs.readFileSync(path.join(dir, '.git/config'), 'utf8'), before);
});

test('both bulk cloners reuse a case-variant primary without changing config', async t => {
  const f = await fixture(t);
  const dir = f.primary('exampleorg', 'tools');
  const config = fs.readFileSync(path.join(dir, '.git/config'), 'utf8');
  for (const name of ['clone-all.mjs', 'clone-mine.mjs']) {
    const mod = await import(pathToFileURL(path.join(f.scripts, name)));
    assert.match(mod.cloneRepo('ExampleOrg', 'Tools', {}), /^SKIP/);
  }
  assert.equal(fs.readFileSync(path.join(dir, '.git/config'), 'utf8'), config);
});

test('canonical metadata uses routed account, redacts failures and rejects redirects', async t => {
  const f = await fixture(t);
  const calls = [];
  const run = (cmd, args, options) => {
    calls.push({ args, env: options.env });
    if (args[0] === 'auth') { assert.equal(args.at(-1), 'EmployerUser'); return 'secret-test-token'; }
    return JSON.stringify(args.at(-1) === 'user' ? { login: 'EmployerUser' } : { full_name: 'CCSI-Example/Tools' });
  };
  assert.deepEqual(f.lib.canonicalRepository('ccsi-example', 'tools', run), { org: 'CCSI-Example', repo: 'Tools' });
  assert.equal(calls[0].env.GH_TOKEN, undefined);
  assert.equal(calls[1].env.GH_TOKEN, 'secret-test-token');
  assert.throws(() => f.lib.canonicalRepository('old', 'tools', (cmd, args) => {
    if (args[0] === 'auth') return 'token';
    return JSON.stringify(args.at(-1) === 'user' ? { login: 'TestUser' } : { full_name: 'New/Tools' });
  }), /redirected/);
  assert.throws(() => f.lib.canonicalRepository('org', 'repo', (cmd, args) => {
    if (args[0] === 'auth') return 'secret-value';
    throw new Error('failure secret-value');
  }), error => !error.message.includes('secret-value'));
});

test('creation lock excludes a competing process and is released on failure', async t => {
  const f = await fixture(t);
  const url = pathToFileURL(path.join(f.scripts, 'lib/wt-lib.mjs')).href;
  f.lib.withWorkspaceLock(() => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {withWorkspaceLock} from ${JSON.stringify(url)}; withWorkspaceLock(() => {});`], { encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /creation is locked/);
  });
  assert.throws(() => f.lib.withWorkspaceLock(() => { throw new Error('test failure'); }), /test failure/);
  assert.equal(fs.existsSync(path.join(f.root, '.wt-create.lock')), false);
});

test('prune respects actual registrations when worktree basename differs in case', async t => {
  const f = await fixture(t);
  const dir = f.primary();
  const wt = path.join(f.root, 'trees/client/TASK-1/tools');
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-b', 'TASK-1', wt);
  const result = f.command('wt-prune.mjs', '--force');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(wt), true);
});


test('bulk dry runs report ambiguous existing paths without creating a lock or clone', async t => {
  const f = await fixture(t);
  f.primary();
  fs.mkdirSync(path.join(f.root, 'repos/exampleorg'));
  for (const name of ['clone-all.mjs', 'clone-mine.mjs']) {
    const mod = await import(pathToFileURL(path.join(f.scripts, name)));
    const messages = [];
    const run = (cmd, args) => {
      if (args[0] === 'auth') return args[1] === 'status'
        ? JSON.stringify({hosts:{'github.com':[{login:'TestUser',state:'success'}]}}) : 'token';
      const endpoint = args[3];
      if (endpoint === 'user') return JSON.stringify({login:'TestUser'});
      if (endpoint.startsWith('user/orgs')) return JSON.stringify([[{login:'ExampleOrg'}]]);
      if (endpoint.startsWith('orgs/')) return JSON.stringify([[{name:'Tools',owner:{login:'ExampleOrg'}}]]);
      if (endpoint.includes('/commits')) return JSON.stringify([{sha:'test'}]);
      throw new Error(endpoint);
    };
    assert.equal(mod.main(['--dry-run'], {run, log:m=>messages.push(m), warn:m=>messages.push(m), output:m=>messages.push(m)}), 1);
    assert.ok(messages.some(m=>m.includes('Case collision')));
    assert.equal(fs.existsSync(path.join(f.root, '.wt-create.lock')), false);
  }
});

test('sync resolves the existing alternate-case clone, and removal resolves its worktree', async t => {
  const f = await fixture(t);
  const dir = f.primary('exampleorg', 'tools');
  // A dirty clone is never changed by sync; its existing fetch behavior is intercepted locally.
  const bin = path.join(f.root, 'bin'); fs.mkdirSync(bin);
  const log = path.join(f.root, 'git-calls.jsonl');
  const executable = path.join(bin, 'git');
  fs.writeFileSync(executable, '#!/usr/bin/env node\n' + `
const fs=require('fs'), {spawnSync}=require('child_process');
const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args,cwd:process.cwd()})+'\\n');
if(args[0]==='fetch') process.exit(0);
const r=spawnSync('/usr/bin/git',args,{stdio:'inherit'}); process.exit(r.status ?? 1);
`); fs.chmodSync(executable,0o755);
  fs.writeFileSync(path.join(dir,'untracked'), 'preserve');
  const result = spawnSync(process.execPath,[path.join(f.scripts,'wt-sync.mjs'),'EXAMPLEORG/TOOLS'],{env:{...env,PATH:bin+path.delimiter+env.PATH},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/uncommitted changes/);
  assert.equal(JSON.parse(fs.readFileSync(log,'utf8').trim().split('\n')[0]).cwd,dir);
  fs.unlinkSync(path.join(dir,'untracked'));
  assert.equal(f.command('wt-create.mjs','ExampleOrg/Tools','client','TASK-1').status,0);
  const removed=f.command('wt-remove.mjs','CLIENT','TASK-1','TOOLS');
  assert.equal(removed.status,0,removed.stderr+removed.stdout);
  assert.equal(fs.existsSync(path.join(f.root,'trees/client/TASK-1/tools')),false);
});

test('new create uses canonical metadata and bulk cloning then reuses it', async t => {
  const f = await fixture(t);
  const seed = f.primary('Seed', 'Source');
  const bin = path.join(f.root, 'fake-bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const args=process.argv.slice(2);
if(args[0]==='auth') console.log('test-token');
else console.log(JSON.stringify(args.at(-1)==='user'?{login:'TestUser'}:{full_name:'NewOrg/NewRepo'}));
`);
  fs.writeFileSync(path.join(bin, 'git'), `#!/usr/bin/env node
const {spawnSync,execFileSync}=require('child_process');
const args=process.argv.slice(2);
if(args[0]==='clone') {
  const remote=args[1], target=args[2];
  execFileSync('/usr/bin/git',['clone',${JSON.stringify(seed)},target]);
  execFileSync('/usr/bin/git',['-C',target,'remote','set-url','origin',remote]);
} else {const r=spawnSync('/usr/bin/git',args,{stdio:'inherit'});process.exit(r.status ?? 1);}
`);
  for (const name of ['git','gh']) fs.chmodSync(path.join(bin,name),0o755);
  const result=spawnSync(process.execPath,[path.join(f.scripts,'wt-create.mjs'),'neworg/newrepo','client','TASK-2'],{env:{...env,PATH:bin+path.delimiter+env.PATH},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(fs.existsSync(path.join(f.root,'repos/NewOrg/NewRepo/.git')),true);
  assert.equal(fs.existsSync(path.join(f.root,'repos/neworg')),false);
  assert.equal(git(path.join(f.root,'trees/client/TASK-2/NewRepo'),'branch','--show-current'),'TASK-2');
  for(const name of ['clone-all.mjs','clone-mine.mjs']) {
    const mod=await import(pathToFileURL(path.join(f.scripts,name)));
    assert.match(mod.cloneRepo('NEWORG','NEWREPO',{}),/^SKIP/);
  }
});
