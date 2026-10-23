#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { preserveBeforeWrite } from '../assets/workspace-scripts/lib/preserve.mjs';
import {
  validateKeyPath,
  verifyKeyPair,
  validateIdentityKeys,
} from '../assets/workspace-scripts/lib/key-policy.mjs';

function usage() {
  return [
    'Usage:',
    '  configure-ssh-identities.mjs --config-base64 <base64url-json> [--dry-run] [--replace] [--generate-missing-keys]',
    '',
    '--dry-run               Report changes without writing anything.',
    '--replace               Replace a conflicting managed SSH fragment.',
    '--generate-missing-keys Interactively run ssh-keygen for missing keys.',
    '',
    'Private keys are never printed, copied, replaced, or sent to a remote host.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    configBase64: null,
    dryRun: false,
    replace: false,
    generateMissingKeys: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config-base64') options.configBase64 = argv[++index];
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--replace') options.replace = true;
    else if (arg === '--generate-missing-keys')
      options.generateMissingKeys = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }
  if (!options.help && !options.configBase64) throw new Error(usage());
  return options;
}

function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}

function readIdentities(encoded) {
  let config;
  try {
    config = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new Error(
      'The --config-base64 value must be Base64URL-encoded JSON.',
    );
  }
  if (!Array.isArray(config.identities) || !config.identities.length) {
    throw new Error('Configuration must contain at least one identity.');
  }
  const hosts = new Set();
  const keyPaths = new Map();
  return config.identities.map((identity, index) => {
    const label = `identities[${index}]`;
    const login = identity.login;
    for (const [name, value] of [
      ['gitName', identity.gitName],
      ['gitEmail', identity.gitEmail],
      ['login', login],
      ['sshHost', identity.sshHost],
      ['sshKeyPath', identity.sshKeyPath],
    ]) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label}.${name} must be a non-empty string.`);
      }
    }
    const gitHost = String(identity.host ?? '').toLowerCase();
    const sshPort = config.hosts?.[gitHost]?.sshPort ?? 22;
    if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535)
      throw new Error(`hosts.${gitHost}.sshPort must be a TCP port.`);
    const endpoint = config.hosts?.[gitHost]?.sshHostname ?? gitHost;
    const sshUser = config.hosts?.[gitHost]?.sshUser ?? 'git';
    if (!/^[A-Za-z0-9.-]+$/.test(endpoint) || !/^[A-Za-z0-9_-]+$/.test(sshUser))
      throw new Error('Invalid SSH endpoint or user.');
    const aliases = identity.sshHostAliases ?? [];
    if (!Array.isArray(aliases))
      throw new Error(`${label}.sshHostAliases must be an array.`);
    for (const alias of [identity.sshHost, gitHost, ...aliases]) {
      if (!/^[A-Za-z0-9.-]+$/.test(alias))
        throw new Error(
          `${label} has an SSH host with unsupported characters: ${alias}`,
        );
    }
    for (const alias of [identity.sshHost, ...aliases]) {
      const hostKey = alias.toLowerCase();
      if (hosts.has(hostKey))
        throw new Error(`Duplicate SSH host alias: ${alias}`);
      hosts.add(hostKey);
    }
    validateKeyPath(identity.sshKeyPath);
    const privateKey = expandHome(identity.sshKeyPath);
    if (privateKey === path.parse(privateKey).root)
      throw new Error(`${label}.sshKeyPath is unsafe.`);
    const persona = `${identity.gitName} <${identity.gitEmail}>`;
    if (keyPaths.has(privateKey) && keyPaths.get(privateKey) !== persona)
      throw new Error('Different identities must have different SSH keys.');
    keyPaths.set(privateKey, persona);
    return {
      login: login.trim(),
      gitName: identity.gitName,
      gitEmail: identity.gitEmail,
      sshKeyPath: identity.sshKeyPath,
      sshHost: identity.sshHost.trim(),
      sshHostAliases: aliases.map((alias) => alias.trim()),
      gitHost,
      sshHostname: config.hosts?.[gitHost]?.sshHostname ?? gitHost,
      sshUser: config.hosts?.[gitHost]?.sshUser ?? 'git',
      agentCaching: config.settings?.agentCaching === true,
      useKeychain: config.settings?.useKeychain === true,
      sshPort,
      privateKey,
      sourceRoot: config.sourceRoot ?? '~/Source',
      configuredKeyPath: identity.sshKeyPath.trim(),
    };
  });
}

function pathExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function runInteractive(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} exited with status ${result.status}.`);
}

function ensureKeys(identities, options) {
  for (const identity of identities) {
    const publicKey = `${identity.privateKey}.pub`;
    const privateExists = pathExists(identity.privateKey);
    const publicExists = pathExists(publicKey);
    if (privateExists && publicExists) {
      verifyKeyPair(identity.privateKey);
      console.log(
        `PRESERVE key pair for ${identity.login}: ${identity.privateKey}`,
      );
      continue;
    }
    if (!privateExists && publicExists) {
      throw new Error(
        `Public key exists without its private key: ${publicKey}`,
      );
    }
    if (!options.generateMissingKeys) {
      throw new Error(
        `Missing SSH key for ${identity.login}: ${identity.privateKey}. ` +
          'Review the path or rerun with --generate-missing-keys.',
      );
    }
    if (!privateExists) {
      console.log(
        `CREATE  interactive SSH key pair for ${identity.login}: ${identity.privateKey}`,
      );
      if (!options.dryRun) {
        fs.mkdirSync(path.dirname(identity.privateKey), {
          recursive: true,
          mode: 0o700,
        });
        runInteractive('ssh-keygen', [
          '-t',
          'ed25519',
          '-C',
          identity.login,
          '-f',
          identity.privateKey,
        ]);
      }
      continue;
    }
    console.log(`CREATE  public key from existing private key: ${publicKey}`);
    if (!options.dryRun) {
      const result = spawnSync(
        'ssh-keygen',
        ['-y', '-f', identity.privateKey],
        {
          encoding: 'utf8',
          stdio: ['inherit', 'pipe', 'inherit'],
        },
      );
      if (result.error) throw result.error;
      if (result.status !== 0)
        throw new Error(`ssh-keygen exited with status ${result.status}.`);
      fs.writeFileSync(publicKey, `${result.stdout.trim()}\n`, { mode: 0o644 });
    }
  }
}

function sshFragment(identities) {
  return `${identities
    .map((identity) =>
      [
        `Host ${[identity.sshHost, ...identity.sshHostAliases].join(' ')}`,
        `  HostName ${identity.sshHostname}`,
        ...(identity.sshPort === 22 ? [] : [`  Port ${identity.sshPort}`]),
        `  User ${identity.sshUser}`,
        ...(identity.agentCaching ? ['  AddKeysToAgent yes'] : []),
        ...(identity.useKeychain
          ? ['  IgnoreUnknown UseKeychain', '  UseKeychain yes']
          : []),
        `  IdentityFile "${identity.configuredKeyPath}"`,
        '  IdentitiesOnly yes',
      ].join('\n'),
    )
    .join('\n\n')}\n`;
}

function projectIncludes(content, managedPath, temporary, seen = new Set()) {
  if (seen.size > 30) throw new Error('SSH Include nesting is too deep.');
  return content
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*Include\s+(.+?)\s*$/i);
      if (!match) return line;
      const tokens = match[1].match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
      const pieces = [];
      for (let token of tokens) {
        if (token.startsWith('#')) break;
        token = token.replace(/^["']|["']$/g, '');
        const pattern =
          path.isAbsolute(token) || token.startsWith('~/')
            ? expandHome(token)
            : path.join(os.homedir(), '.ssh', token);
        for (const file of fs.globSync(pattern)) {
          if (path.resolve(file) === managedPath) continue;
          if (seen.has(file)) throw new Error('Cyclic SSH Include.');
          const projectedFile = path.join(
            temporary,
            `include-${Math.random().toString(16).slice(2)}.conf`,
          );
          fs.writeFileSync(
            projectedFile,
            projectIncludes(
              fs.readFileSync(file, 'utf8'),
              managedPath,
              temporary,
              new Set([...seen, file]),
            ),
            { mode: 0o600 },
          );
          pieces.push(`Include "${projectedFile}"`);
        }
      }
      return pieces.join('\n');
    })
    .join('\n');
}

function ensureFragment(identities, options) {
  const sshDirectory = path.join(os.homedir(), '.ssh');
  const includeDirectory = path.join(sshDirectory, 'config.d');
  const fragmentPath = path.join(includeDirectory, 'local-source-code.conf');
  const configPath = path.join(sshDirectory, 'config');
  const current = pathExists(configPath)
    ? fs.readFileSync(configPath, 'utf8')
    : '';
  const expected = sshFragment(identities);
  const exists = pathExists(fragmentPath);
  if (
    exists &&
    fs.readFileSync(fragmentPath, 'utf8') !== expected &&
    !options.replace
  )
    throw new Error(
      'Conflict: review the managed SSH fragment before --replace.',
    );
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'source-ssh-'));
  try {
    const candidate = path.join(temporary, 'config');
    fs.writeFileSync(
      candidate,
      `${expected}\nHost *\n${projectIncludes(current, fragmentPath, temporary)}`,
      { mode: 0o600 },
    );
    for (const identity of identities)
      for (const alias of [identity.sshHost, ...identity.sshHostAliases]) {
        const result = spawnSync('ssh', ['-G', '-F', candidate, alias], {
          encoding: 'utf8',
        });
        if (result.status !== 0)
          throw new Error('Projected SSH configuration is invalid.');
        const lines = result.stdout.split('\n').map((line) => line.split(/ +/));
        const get = (key) =>
          lines.filter(([k]) => k === key).map(([, ...v]) => v.join(' '));
        const keys = [...new Set(get('identityfile').map(expandHome))];
        if (
          get('hostname')[0] !== identity.sshHostname ||
          get('user')[0] !== identity.sshUser ||
          keys.length !== 1 ||
          keys[0] !== identity.privateKey ||
          get('identitiesonly')[0] !== 'yes' ||
          Number(get('port')[0]) !== identity.sshPort
        )
          throw new Error(
            `Conflicting effective SSH configuration for ${alias}; reconcile existing Includes and keys before applying.`,
          );
      }
  } finally {
    fs.rmSync(temporary, { recursive: true });
  }
  const include = `Include "${fragmentPath}"`;
  const desired = current.startsWith(include + '\nHost *\n')
    ? current
    : `${include}\nHost *\n${current}`;
  console.log(
    `${exists ? 'CHECK' : 'CREATE'} managed SSH fragment; effective aliases verified.`,
  );
  if (options.dryRun) return;
  fs.mkdirSync(includeDirectory, { recursive: true, mode: 0o700 });
  if (
    current !== desired ||
    (exists && fs.readFileSync(fragmentPath, 'utf8') !== expected)
  ) {
    preserveBeforeWrite(
      [configPath, fragmentPath],
      'Installing verified SSH account aliases.',
      identities[0].sourceRoot,
    );
  }
  fs.writeFileSync(fragmentPath, expected, { mode: 0o600 });
  fs.chmodSync(fragmentPath, 0o600);
  fs.writeFileSync(configPath, desired, { mode: 0o600 });
  fs.chmodSync(configPath, 0o600);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
  } else {
    const identities = readIdentities(options.configBase64);
    ensureFragment(identities, { ...options, dryRun: true });
    ensureKeys(identities, options);
    if (!options.dryRun)
      validateIdentityKeys(identities, { requireFiles: true });
    ensureFragment(identities, options);
    console.log(
      options.dryRun
        ? 'Dry run complete; no files were changed.'
        : 'SSH identity setup complete.',
    );
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
