// A throwaway workspace: a copy of the helpers, a generated configuration, an
// isolated global Git configuration with workstation signing installed, and a
// factory for offline primary clones.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installTestConfig, testConfig } from './test-config.mjs';

const assets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function workspaceFixture(t, { config, installSigning = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-workspace-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts');
  fs.cpSync(assets, scripts, { recursive: true });
  const { env, file: configFile } = installTestConfig(root, config ?? testConfig(root));
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const command = (name, ...args) => spawnSync(process.execPath, [path.join(scripts, name), ...args], { env, encoding: 'utf8' });
  const lib = await import(pathToFileURL(path.join(scripts, 'lib/wt-lib.mjs')));
  const importScript = name => import(pathToFileURL(path.join(scripts, name)));
  if (installSigning) {
    const result = command('wt-enforce-signing.mjs');
    if (result.status !== 0) throw new Error(`Signing setup failed: ${result.stderr}${result.stdout}`);
  }
  function primary(org = 'ExampleOrg', name = 'Tools', host = 'github.com', sshHost = host) {
    const dir = host === 'github.com' ? path.join(root, 'repos', org, name) : path.join(root, 'repos', host, org, name);
    fs.mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-b', 'main');
    git(dir, '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false',
      'commit', '--allow-empty', '-m', 'Initial');
    git(dir, 'remote', 'add', 'origin', `git@${sshHost}:${org}/${name}.git`);
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    return dir;
  }
  return { root, scripts, configFile, env, git, command, lib, importScript, primary };
}
