import { FORGE_HOST, testConfig } from './helpers/test-config.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalizeConfig } from '../lib/wt-config.mjs';
import { workspaceFixture } from './helpers/workspace-fixture.mjs';

function fakeNetworkGit(f) {
  // Intercepts network operations only; everything else runs real Git.
  const bin = path.join(f.root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'git'), `#!/usr/bin/env node
const {spawnSync}=require('child_process');
const args=process.argv.slice(2);
if(['fetch','pull','push'].includes(args[0])) process.exit(0);
const r=spawnSync('/usr/bin/git',args,{stdio:'inherit'}); process.exit(r.status ?? 1);
`);
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  return { ...f.env, PATH: bin + path.delimiter + f.env.PATH };
}

test('configuration validation rejects defaults, cross-host routes, and shared aliases', () => {
  const base = testConfig('/tmp/example');
  assert.throws(() => normalizeConfig({ ...base, defaultIdentity: 'personal' }), /default accounts are not supported/);
  assert.throws(() => normalizeConfig({ ...base, routes: { 'github.com': { someorg: 'forge' } } }), /belongs to/);
  assert.throws(() => normalizeConfig({ ...base, routes: { 'github.com': { a: 'personal', A: 'personal' } } }), /more than once/);
  const shared = structuredClone(base);
  shared.accounts.employer.sshHostAliases = ['github.com'];
  assert.throws(() => normalizeConfig(shared), /used by both/);
  assert.throws(() => normalizeConfig({ ...base, version: 2 }), /version/);
  assert.throws(() => normalizeConfig({ ...base, settings: { commitAndPush: 'yes' } }), /commitAndPush/);
  assert.equal(normalizeConfig(base).routes['github.com']['employer-team'], 'employer');
});

test('an unrouted owner fails closed with the command that fixes it', async t => {
  const f = await workspaceFixture(t);
  const config = await f.importScript('lib/wt-config.mjs');
  assert.throws(() => config.resolveIdentity('Unrouted-Org'), /No route for owner "Unrouted-Org".*\n.*wt-route\.mjs add Unrouted-Org \{account\}/);
  assert.throws(() => config.resolveIdentity('Unrouted', FORGE_HOST), new RegExp(`--host ${FORGE_HOST.replaceAll('.', '\\.')}`));
  assert.equal(config.findIdentity('Unrouted-Org'), null);
  assert.equal(config.resolveIdentity('EXAMPLEORG').id, 'personal');
  const created = f.command('wt-create.mjs', 'Unrouted-Org/Tools', 'client', 'TASK-1');
  assert.equal(created.status, 1);
  assert.match(created.stderr, /wt-route\.mjs add Unrouted-Org/);
  assert.equal(fs.existsSync(path.join(f.root, 'repos', 'Unrouted-Org')), false);
});

test('wt-route adds and lists routes, refuses silent changes, and refreshes includes', async t => {
  const f = await workspaceFixture(t);
  const added = f.command('wt-route.mjs', 'add', 'New-Org', 'employer');
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stdout, /ADD {5}github\.com: New-Org -> employer/);
  assert.equal(JSON.parse(fs.readFileSync(f.configFile, 'utf8')).routes['github.com']['new-org'], 'employer');
  assert.equal(fs.statSync(f.configFile).mode & 0o777, 0o600);
  const routes = fs.readFileSync(path.join(path.dirname(f.configFile), 'git', 'routes.gitconfig'), 'utf8');
  assert.match(routes, new RegExp(`gitdir/i:${f.root.replaceAll('/', '\\/')}\\/repos\\/new-org\\/`));
  assert.equal(f.command('wt-route.mjs', 'add', 'new-org', 'employer').status, 0);
  const changed = f.command('wt-route.mjs', 'add', 'New-Org', 'personal');
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /already routed to employer/);
  const wrongHost = f.command('wt-route.mjs', 'add', 'Other', 'forge');
  assert.equal(wrongHost.status, 1);
  assert.match(wrongHost.stderr, /Unknown account "forge" on github\.com/);
  assert.equal(f.command('wt-route.mjs', 'add', 'Other', 'forge', '--host', FORGE_HOST).status, 0);
  const listed = f.command('wt-route.mjs', 'list', '--host', FORGE_HOST);
  assert.match(listed.stdout, /other -> forge/);
  assert.doesNotMatch(listed.stdout, /new-org/);
});

test('workstation signing applies to primaries and their worktrees; overrides are reported and removable', async t => {
  const f = await workspaceFixture(t);
  const global = fs.readFileSync(f.env.GIT_CONFIG_GLOBAL, 'utf8');
  assert.match(global, /routes\.gitconfig/);
  const dir = f.primary('ExampleOrg', 'Tools');
  const employer = f.primary('Employer-Team', 'Api', 'github.com', 'github.com-employer');
  const wt = path.join(f.root, 'trees', 'client', 'TASK-1', 'Tools');
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  f.git(dir, 'worktree', 'add', '-b', 'TASK-1', wt);
  for (const [cwd, email] of [[dir, 'test@example.invalid'], [wt, 'test@example.invalid'], [employer, 'work@example.invalid']]) {
    assert.equal(f.git(cwd, 'config', 'user.email'), email);
    assert.equal(f.git(cwd, 'config', 'gpg.format'), 'ssh');
    assert.equal(f.git(cwd, 'config', 'commit.gpgsign'), 'true');
    assert.equal(f.git(cwd, 'config', 'tag.gpgsign'), 'true');
  }
  assert.match(f.git(employer, 'config', 'user.signingkey'), /test-employer$/);
  const ok = f.command('wt-enforce-signing.mjs', '--dry-run');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /2 of 2 primary clone/);

  f.git(dir, 'config', 'user.email', 'stale@example.invalid');
  const drift = f.command('wt-enforce-signing.mjs', '--dry-run');
  assert.equal(drift.status, 1);
  assert.match(drift.stderr, /DRIFT {3}ExampleOrg\/Tools \(personal\): user\.email=stale@example\.invalid/);
  assert.equal(f.git(dir, 'config', 'user.email'), 'stale@example.invalid');
  const fixed = f.command('wt-enforce-signing.mjs', '--remove-local-overrides');
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.match(fixed.stdout, /UNSET {3}ExampleOrg\/Tools: user\.email/);
  assert.equal(f.git(wt, 'config', 'user.email'), 'test@example.invalid');

  f.primary('Stray', 'Repo');
  const unrouted = f.command('wt-enforce-signing.mjs', '--dry-run');
  assert.equal(unrouted.status, 1);
  assert.match(unrouted.stderr, /UNROUTED Stray\/Repo/);
});

test('helpers refuse to clone before workstation signing is installed', async t => {
  const f = await workspaceFixture(t, { installSigning: false });
  f.primary('ExampleOrg', 'Tools');
  const result = f.command('wt-create.mjs', 'ExampleOrg/Tools', 'client', 'TASK-1');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Run wt-enforce-signing\.mjs/);
});

test('wt-sync --strict fails on a skipped update and --verify-branch checks the pushed commit', async t => {
  const f = await workspaceFixture(t);
  const dir = f.primary('ExampleOrg', 'Tools');
  const env = fakeNetworkGit(f);
  const sync = (...args) => spawnSync(process.execPath, [path.join(f.scripts, 'wt-sync.mjs'), 'ExampleOrg/Tools', ...args], { env, encoding: 'utf8' });

  assert.equal(sync().status, 0);
  f.git(dir, 'checkout', '-q', '-b', 'side');
  const lenient = sync();
  assert.equal(lenient.status, 0);
  assert.match(lenient.stdout, /Skipped fast-forward/);
  const strict = sync('--strict');
  assert.equal(strict.status, 2);
  assert.match(strict.stderr, /Skipped fast-forward/);
  f.git(dir, 'checkout', '-q', 'main');

  f.git(dir, 'branch', 'TASK-1');
  const missing = sync('--strict', '--verify-branch', 'TASK-1');
  assert.equal(missing.status, 3);
  assert.match(missing.stderr, /origin\/TASK-1 does not exist/);
  f.git(dir, 'update-ref', 'refs/remotes/origin/TASK-1', 'refs/heads/TASK-1');
  const verified = sync('--strict', '--verify-branch', 'TASK-1');
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /Verified: origin\/TASK-1 matches/);
  f.git(dir, '-c', 'user.name=T', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false',
    'commit', '-q', '--allow-empty', '-m', 'Unpushed');
  const head = f.git(dir, 'rev-parse', 'HEAD');
  const mismatch = sync('--verify-branch', 'TASK-1', '--commit', head);
  assert.equal(mismatch.status, 3);
  assert.match(mismatch.stderr, /but the pushed commit is/);
  assert.equal(sync('--commit', head).status, 1);
});

test('PR preflight accepts a configured SSH alias and still rejects other hosts', async t => {
  const f = await workspaceFixture(t);
  const dir = f.primary('Employer-Team', 'Api', 'github.com', 'github-employer-legacy');
  const wt = path.join(f.root, 'trees', 'client', 'TASK-9', 'Api');
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  f.git(dir, 'worktree', 'add', '-b', 'TASK-9', wt);
  const body = path.join(f.root, 'body.md');
  fs.writeFileSync(body, 'Body\n');
  const accepted = f.command('wt-pr-create.mjs', 'client', 'TASK-9', 'main', '--body-file', body, '--dry-run');
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /Validated 1 repo worktree/);
  f.git(dir, 'remote', 'set-url', 'origin', 'git@github.com:Employer-Team/Api.git');
  const rejected = f.command('wt-pr-create.mjs', 'client', 'TASK-9', 'main', '--body-file', body, '--dry-run');
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /expected the employer account's SSH host "github\.com-employer" or an alias/);
});
