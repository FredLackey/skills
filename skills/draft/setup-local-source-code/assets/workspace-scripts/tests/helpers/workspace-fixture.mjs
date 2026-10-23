import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installTestConfig, testConfig } from './test-config.mjs';

export function workspaceFixture(t, change) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = testConfig(root);
  change?.(config);
  const { file: configFile, env } = installTestConfig(root, config);
  const scripts = path.join(root, 'scripts');
  fs.cpSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
    scripts,
    { recursive: true },
  );
  const command = (name, ...args) =>
    spawnSync(process.execPath, [path.join(scripts, name), ...args], {
      env,
      encoding: 'utf8',
    });
  const git = (cwd, ...args) =>
    execFileSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const runGit = (cwd, args, extra = {}) =>
    spawnSync('git', args, {
      cwd,
      env: { ...env, ...extra },
      encoding: 'utf8',
    });
  const installed = command('wt-enforce-signing.mjs');
  if (installed.status !== 0)
    throw new Error(installed.stdout + installed.stderr);
  function repository(
    owner = 'personalorg',
    name = 'Tools',
    host = 'alpha.example',
    directory,
  ) {
    const dir = directory ?? path.join(root, 'repos', owner, name);
    fs.mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-b', 'main');
    git(dir, 'remote', 'add', 'origin', `git@${host}:${owner}/${name}.git`);
    git(dir, 'commit', '--allow-empty', '-m', 'Initial');
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(
      dir,
      'symbolic-ref',
      'refs/remotes/origin/HEAD',
      'refs/remotes/origin/main',
    );
    return dir;
  }
  return {
    root,
    config,
    configFile,
    env,
    scripts,
    command,
    git,
    runGit,
    repository,
  };
}
