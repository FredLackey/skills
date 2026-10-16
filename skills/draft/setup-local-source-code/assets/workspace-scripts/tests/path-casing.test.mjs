import './helpers/test-config.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { FORGE_HOST } from './helpers/test-config.mjs';
import { workspaceFixture } from './helpers/workspace-fixture.mjs';

let env;
let git;
async function fixture(t) {
  const f = await workspaceFixture(t);
  ({ env, git } = f);
  return f;
}

test('owner and repo casing reuse a legacy clone and its owner for new repos', async t => {
  const f = await fixture(t);
  const dir = f.primary('exampleorg', 'tools');
  assert.equal(f.lib.repoPath('EXAMPLEORG', 'Tools'), dir);
  assert.equal(f.lib.repoPath('ExampleOrg', 'Other'), path.join(f.root, 'repos/exampleorg/Other'));
});

test('ambiguity rejects even an exact match and split owners with disjoint repos', async t => {
  const f = await fixture(t);
  if (!f.caseSensitive) return t.skip('Requires a case-sensitive filesystem for distinct case-variant directories');
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

test('repo-only case variants are rejected', async t => {
  const f = await fixture(t);
  if (!f.caseSensitive) return t.skip('Requires a case-sensitive filesystem for distinct case-variant directories');
  const dir = f.primary();
  const other = path.join(path.dirname(dir), 'tools');
  fs.mkdirSync(other);
  assert.throws(() => f.lib.repoPath('ExampleOrg', 'Tools'), /Case collision/);
  fs.rmdirSync(other);
});

test('wrong origins, files and symlinks are rejected', async t => {
  const f = await fixture(t);
  const dir = f.primary();
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
    return JSON.stringify(args.at(-1) === 'user' ? { login: 'EmployerUser' } : { full_name: 'Employer-Example/Tools' });
  };
  assert.deepEqual(f.lib.canonicalRepository('employer-example', 'tools', run), { org: 'Employer-Example', repo: 'Tools' });
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
  if (!f.caseSensitive) return t.skip('Requires a case-sensitive filesystem for distinct case-variant directories');
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
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'repos')).sort(), ['NewOrg', 'Seed']);
  assert.equal(git(path.join(f.root,'trees/client/TASK-2/NewRepo'),'branch','--show-current'),'TASK-2');
  for(const name of ['clone-all.mjs','clone-mine.mjs']) {
    const mod=await import(pathToFileURL(path.join(f.scripts,name)));
    assert.match(mod.cloneRepo('NEWORG','NEWREPO',{}),/^SKIP/);
  }
});

test('Forgejo and GitHub same-name clones stay distinct; all worktree operations recognize the host namespace', async t => {
  const f = await fixture(t);
  const github = f.primary();
  const forgejo = f.primary('ExampleOrg', 'Tools', FORGE_HOST);
  assert.equal(f.lib.repoPath('exampleorg', 'tools'), github);
  assert.equal(f.lib.repoPath('exampleorg', 'tools', FORGE_HOST), forgejo);
  const created = f.command('wt-create.mjs', 'exampleorg/tools', 'company', 'test-host', '--host', FORGE_HOST);
  assert.equal(created.status, 0, created.stderr);
  const wt = path.join(f.root, 'trees/company/test-host/Tools');
  assert.equal(f.lib.validateManagedWorktree(wt), forgejo);
  assert.equal(git(wt, 'config', 'user.email'), 'forge@example.invalid');
  assert.match(git(wt, 'config', 'user.signingkey'), /test-forge$/);
  assert.equal(f.lib.listPrimaryRepos().length, 2);
  const rejected = f.command('wt-create.mjs', 'ExampleOrg/Tools', 'company', 'test-host');
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /not the requested registered worktree/);
  assert.equal(f.command('wt-prune.mjs', '--force').status, 0);
  assert.equal(fs.existsSync(wt), true);
  assert.equal(f.command('wt-remove.mjs', 'company', 'test-host', 'Tools').status, 0);
  assert.equal(fs.existsSync(wt), false);
});

test('Forgejo canonical lookup is account-checked and never invokes GitHub', async t => {
  const f = await fixture(t);
  const noGh = () => { throw new Error('GitHub must not be called'); };
  const api = (host, route) => {
    assert.equal(host, FORGE_HOST);
    return route === 'user' ? { login: 'forgeuser' } : { full_name: 'ExampleOrg/Tools' };
  };
  assert.deepEqual(f.lib.canonicalRepository('exampleorg', 'tools', noGh, FORGE_HOST, api), { org: 'ExampleOrg', repo: 'Tools' });
  assert.throws(() => f.lib.canonicalRepository('x', 'y', noGh, FORGE_HOST, () => ({ login: 'wrong' })), /identity mismatch/);
  assert.throws(() => f.lib.repoPath('x','y','unknown.example'), /Unconfigured Git host/);
  assert.throws(() => f.lib.takeHostOption(['--host','github.com','--host',FORGE_HOST]), /once/);
});

test('Forgejo nested owner/repo case collisions are rejected and audited', async t => {
  const f = await fixture(t);
  if (!f.caseSensitive) return t.skip('Requires a case-sensitive filesystem for distinct case-variant directories');
  const dir = f.primary('ExampleOrg', 'Tools', FORGE_HOST);
  fs.mkdirSync(path.join(path.dirname(dir), 'tools'));
  assert.throws(() => f.lib.repoPath('ExampleOrg', 'Tools', FORGE_HOST), /Case collision/);
  assert.equal(f.command('wt-audit-paths.mjs').status, 1);
});


test('configured SSH host aliases preserve owner and identity restrictions', async t => {
  const f = await fixture(t);
  const dir = f.primary('employer-team', 'Tools');
  assert.throws(() => f.lib.repoPath('employer-team', 'Tools'), /Unexpected origin/);
  git(dir, 'remote', 'set-url', 'origin', 'git@github-employer-legacy:employer-team/Tools.git');
  assert.equal(f.lib.repoPath('employer-team', 'Tools'), dir);
  git(dir, 'remote', 'set-url', 'origin', 'git@github-employer-legacy:OtherOrg/Tools.git');
  assert.throws(() => f.lib.repoPath('employer-team', 'Tools'), /Unexpected origin/);
});
