#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const DEBIAN_KEY_URL = 'https://cli.github.com/packages/githubcli-archive-keyring.gpg';
const DEBIAN_KEY_SHA256 = '6084d5d7bd8e288441e0e94fc6275570895da18e6751f70f057485dc2d1a811b';

function usage() {
  return [
    'Usage: install-github-cli.mjs [--dry-run]',
    '',
    'Installs GitHub CLI only when gh is absent. Supported targets:',
    'Windows with WinGet, macOS with Homebrew, Ubuntu/Debian, and Arch Linux.',
  ].join('\n');
}

function commandExists(command) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(finder, [command], { stdio: 'ignore' }).status === 0;
}

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? String(result.stderr || result.stdout).trim() : '';
    throw new Error(`${command} exited with status ${result.status}${detail ? `: ${detail}` : ''}.`);
  }
  return capture ? result.stdout.trim() : '';
}

function linuxDistribution() {
  const values = {};
  const content = fs.readFileSync('/etc/os-release', 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '').toLowerCase();
  }
  return `${values.ID ?? ''} ${values.ID_LIKE ?? ''}`;
}

function describePlan() {
  if (process.platform === 'win32') return ['winget install --id GitHub.cli --source winget'];
  if (process.platform === 'darwin') return ['brew install gh'];
  if (process.platform !== 'linux') throw new Error(`Unsupported operating system: ${process.platform}`);
  const distribution = linuxDistribution();
  if (/\barch\b/.test(distribution)) return ['sudo pacman -S --needed github-cli'];
  if (/\b(?:ubuntu|debian)\b/.test(distribution)) {
    return [
      `download and SHA-256 verify ${DEBIAN_KEY_URL}`,
      'install the GitHub CLI apt keyring and official package source',
      'sudo apt-get update',
      'sudo apt-get install -y gh',
    ];
  }
  if (commandExists('brew')) return ['brew install gh'];
  throw new Error(`Unsupported Linux distribution: ${distribution.trim() || 'unknown'}`);
}

async function installDebian() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'install-gh-'));
  try {
    const keyPath = path.join(temporaryDirectory, 'githubcli-archive-keyring.gpg');
    const sourcePath = path.join(temporaryDirectory, 'github-cli.list');
    const response = await fetch(DEBIAN_KEY_URL, { redirect: 'follow' });
    if (!response.ok) throw new Error(`Unable to download GitHub CLI keyring: HTTP ${response.status}`);
    const key = Buffer.from(await response.arrayBuffer());
    const digest = createHash('sha256').update(key).digest('hex');
    if (digest !== DEBIAN_KEY_SHA256) {
      throw new Error(`GitHub CLI keyring checksum mismatch: received ${digest}.`);
    }
    fs.writeFileSync(keyPath, key, { mode: 0o644 });
    run('sudo', ['mkdir', '-p', '-m', '755', '/etc/apt/keyrings', '/etc/apt/sources.list.d']);
    run('sudo', ['install', '-m', '0644', keyPath, '/etc/apt/keyrings/githubcli-archive-keyring.gpg']);
    const architecture = run('dpkg', ['--print-architecture'], { capture: true });
    fs.writeFileSync(sourcePath,
      `deb [arch=${architecture} signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\n`,
      { mode: 0o644 });
    run('sudo', ['install', '-m', '0644', sourcePath, '/etc/apt/sources.list.d/github-cli.list']);
    run('sudo', ['apt-get', 'update']);
    run('sudo', ['apt-get', 'install', '-y', 'gh']);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function install() {
  if (process.platform === 'win32') {
    if (!commandExists('winget')) throw new Error('WinGet is required to install GitHub CLI on Windows.');
    run('winget', ['install', '--id', 'GitHub.cli', '--source', 'winget']);
    return;
  }
  if (process.platform === 'darwin') {
    if (!commandExists('brew')) throw new Error('Homebrew is required to install GitHub CLI on macOS.');
    run('brew', ['install', 'gh']);
    return;
  }
  const distribution = linuxDistribution();
  if (/\barch\b/.test(distribution)) {
    run('sudo', ['pacman', '-S', '--needed', 'github-cli']);
    return;
  }
  if (/\b(?:ubuntu|debian)\b/.test(distribution)) {
    await installDebian();
    return;
  }
  if (commandExists('brew')) {
    run('brew', ['install', 'gh']);
    return;
  }
  throw new Error(`Unsupported Linux distribution: ${distribution.trim() || 'unknown'}`);
}

try {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    if (args.length !== 1) throw new Error(usage());
    console.log(usage());
  } else {
    if (args.some((arg) => arg !== '--dry-run') || args.filter((arg) => arg === '--dry-run').length > 1) {
      throw new Error(usage());
    }
    if (commandExists('gh')) {
      console.log(`GitHub CLI is already installed: ${run('gh', ['--version'], { capture: true }).split(/\r?\n/)[0]}`);
    } else {
      const plan = describePlan();
      plan.forEach((step) => console.log(`INSTALL ${step}`));
      if (args.includes('--dry-run')) {
        console.log('Dry run complete; no software was installed.');
      } else {
        await install();
        if (!commandExists('gh')) {
          if (process.platform === 'win32') {
            console.log('GitHub CLI installation completed. Open a new terminal before continuing so PATH is refreshed.');
          } else {
            throw new Error('Installation completed but gh is still unavailable on PATH.');
          }
        } else {
          console.log(`Installed ${run('gh', ['--version'], { capture: true }).split(/\r?\n/)[0]}.`);
        }
      }
    }
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
