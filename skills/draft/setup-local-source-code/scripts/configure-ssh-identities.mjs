#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

function usage() {
  return [
    'Usage:',
    '  configure-ssh-identities.mjs --config-base64 <base64url-json> [--dry-run] [--replace] [--generate-missing-keys] [--migrate-existing-hosts]',
    '',
    '--dry-run               Report changes without writing anything.',
    '--replace               Replace a conflicting managed SSH fragment.',
    '--generate-missing-keys Interactively run ssh-keygen for missing keys.',
    '',
    '--migrate-existing-hosts Move conflicting dedicated Host blocks into the managed fragment.',
    '                         Preview first; requires sourceRoot for a quarantine backup.',
    '',
    'Private keys are never printed, copied, replaced, or sent to GitHub.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    configBase64: null, dryRun: false, replace: false, generateMissingKeys: false, migrateExistingHosts: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config-base64') options.configBase64 = argv[++index];
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--replace') options.replace = true;
    else if (arg === '--migrate-existing-hosts') options.migrateExistingHosts = true;
    else if (arg === '--generate-missing-keys') options.generateMissingKeys = true;
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
    throw new Error('The --config-base64 value must be Base64URL-encoded JSON.');
  }
  if (!Array.isArray(config.identities) || !config.identities.length) {
    throw new Error('Configuration must contain at least one identity.');
  }
  const hosts = new Set();
  const keyPaths = new Set();
  return config.identities.map((identity, index) => {
    const label = `identities[${index}]`;
    // `login` is the account name on its host; `githubUser` is the older spelling.
    const login = identity.login ?? identity.githubUser;
    for (const [name, value] of [['login', login], ['sshHost', identity.sshHost], ['sshKeyPath', identity.sshKeyPath]]) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label}.${name} must be a non-empty string.`);
      }
    }
    const gitHost = String(identity.host ?? 'github.com').toLowerCase();
    const sshPort = config.hosts?.[gitHost]?.sshPort ?? 22;
    if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) throw new Error(`hosts.${gitHost}.sshPort must be a TCP port.`);
    const aliases = identity.sshHostAliases ?? [];
    if (!Array.isArray(aliases)) throw new Error(`${label}.sshHostAliases must be an array.`);
    for (const alias of [identity.sshHost, gitHost, ...aliases]) {
      if (!/^[A-Za-z0-9.-]+$/.test(alias)) throw new Error(`${label} has an SSH host with unsupported characters: ${alias}`);
    }
    for (const alias of [identity.sshHost, ...aliases]) {
      const hostKey = alias.toLowerCase();
      if (hosts.has(hostKey)) throw new Error(`Duplicate SSH host alias: ${alias}`);
      hosts.add(hostKey);
    }
    const privateKey = expandHome(identity.sshKeyPath);
    if (privateKey === path.parse(privateKey).root) throw new Error(`${label}.sshKeyPath is unsafe.`);
    if (keyPaths.has(privateKey)) throw new Error(`SSH private key is shared by multiple identities: ${privateKey}`);
    keyPaths.add(privateKey);
    return {
      githubUser: login.trim(),
      sshHost: identity.sshHost.trim(),
      sshHostAliases: aliases.map((alias) => alias.trim()),
      gitHost,
      sshPort,
      privateKey,
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
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`);
}

function ensureKeys(identities, options) {
  for (const identity of identities) {
    const publicKey = `${identity.privateKey}.pub`;
    const privateExists = pathExists(identity.privateKey);
    const publicExists = pathExists(publicKey);
    if (privateExists && publicExists) {
      console.log(`PRESERVE key pair for ${identity.githubUser}: ${identity.privateKey}`);
      continue;
    }
    if (!privateExists && publicExists) {
      throw new Error(`Public key exists without its private key: ${publicKey}`);
    }
    if (!options.generateMissingKeys) {
      throw new Error(`Missing SSH key for ${identity.githubUser}: ${identity.privateKey}. ` +
        'Review the path or rerun with --generate-missing-keys.');
    }
    if (!privateExists) {
      console.log(`CREATE  interactive SSH key pair for ${identity.githubUser}: ${identity.privateKey}`);
      if (!options.dryRun) {
        fs.mkdirSync(path.dirname(identity.privateKey), { recursive: true, mode: 0o700 });
        runInteractive('ssh-keygen', [
          '-t', 'ed25519', '-C', identity.githubUser, '-f', identity.privateKey,
        ]);
      }
      continue;
    }
    console.log(`CREATE  public key from existing private key: ${publicKey}`);
    if (!options.dryRun) {
      const result = spawnSync('ssh-keygen', ['-y', '-f', identity.privateKey], {
        encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'],
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`ssh-keygen exited with status ${result.status}.`);
      fs.writeFileSync(publicKey, `${result.stdout.trim()}\n`, { mode: 0o644 });
    }
  }
}

function sshFragment(identities) {
  return `${identities.map((identity) => [
    `Host ${[identity.sshHost, ...identity.sshHostAliases].join(' ')}`,
    `  HostName ${identity.gitHost}`,
    ...(identity.sshPort === 22 ? [] : [`  Port ${identity.sshPort}`]),
    '  User git',
    `  IdentityFile ${identity.configuredKeyPath}`,
    '  IdentitiesOnly yes',
  ].join('\n')).join('\n\n')}\n`;
}

/**
 * Finds Host aliases we're about to manage that are already declared
 * somewhere else in the user's ~/.ssh/config. ssh_config resolves each
 * parameter from the first matching Host block, so a pre-existing block
 * with the same alias would silently be shadowed by (or shadow) our managed
 * fragment rather than cleanly conflict — surface it instead of guessing.
 */
function findExternalHostConflicts(configContent, identities) {
  const wanted = new Set(identities.flatMap((identity) =>
    [identity.sshHost, ...identity.sshHostAliases].map((alias) => alias.toLowerCase())));
  const conflicts = new Set();
  for (const rawLine of configContent.split(/\r?\n/)) {
    const hostMatch = rawLine.match(/^\s*Host\s+(.+?)\s*$/i);
    if (!hostMatch) continue;
    for (const pattern of hostMatch[1].split(/\s+/)) {
      if (wanted.has(pattern.toLowerCase())) conflicts.add(pattern);
    }
  }
  return [...conflicts];
}

/** Only dedicated, literal Host blocks may be migrated automatically. */
function migrateHostBlocks(current, aliases) {
  const wanted = new Set(aliases.map(alias => alias.toLowerCase()));
  const blocks = current.split(/(?=^[ \t]*(?:Host|Match)[ \t]+)/im);
  const removed = [];
  const updated = blocks.map(block => {
    const match = block.match(/^[ \t]*Host[ \t]+([^\r\n]+)/i);
    if (!match) return block;
    const patterns = match[1].split('#')[0].trim().split(/\s+/);
    if (!patterns.some(pattern => wanted.has(pattern.toLowerCase()))) return block;
    if (patterns.some(pattern => !wanted.has(pattern.toLowerCase())) || /^\s*Include\s/im.test(block)) {
      throw new Error('Cannot migrate a shared Host block or one containing Include; split it manually first.');
    }
    removed.push(block.split('\n').filter(line => !/^\s*(?:#|$)/.test(line)).join('\n'));
    // Retain comments and blank lines, including headings for the next block.
    return block.split('\n').filter(line => /^\s*(?:#|$)/.test(line)).join('\n');
  }).join('');
  return { updated, removed };
}

function ensureFragment(identities, options) {
  const sshDirectory = path.join(os.homedir(), '.ssh');
  const includeDirectory = path.join(sshDirectory, 'config.d');
  const fragmentPath = path.join(includeDirectory, 'local-source-code.conf');
  const configPath = path.join(sshDirectory, 'config');
  const original = pathExists(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  let current = original;
  const conflicts = findExternalHostConflicts(current, identities);
  if (conflicts.length && !options.migrateExistingHosts) {
    throw new Error(
      `Conflict: ${configPath} already declares Host ${conflicts.join(', ')} ` +
      `outside the managed config.d/local-source-code.conf fragment. ssh_config uses the first ` +
      'match. Preview --migrate-existing-hosts to back up and migrate dedicated blocks, ' +
      'or split shared blocks manually first.',
    );
  }
  if (conflicts.length) {
    if (!options.sourceRoot) throw new Error('--migrate-existing-hosts requires sourceRoot in the setup object.');
    const migration = migrateHostBlocks(original, conflicts);
    current = migration.updated;
    console.log(`MIGRATE Host ${conflicts.join(', ')} from ${configPath}`);
    console.log('--- existing SSH config blocks');
    console.log(migration.removed.join('\n\n'));
    console.log('+++ managed SSH fragment');
    console.log(sshFragment(identities).trimEnd());
    console.log(`BACKUP  SSH config and any managed fragment under ${path.join(options.sourceRoot, 'quarantine')}`);
  }
  const expected = sshFragment(identities);
  const exists = pathExists(fragmentPath);
  if (exists && fs.readFileSync(fragmentPath, 'utf8') !== expected && !options.replace) {
    throw new Error(`Conflict: ${fragmentPath} differs. Review it before using --replace.`);
  }
  const includePattern = /^\s*Include\s+(?:~\/\.ssh\/)?config\.d\/\*\s*$/im;
  const needsBackup = conflicts.length || (original && !includePattern.test(original)) || (exists && fs.readFileSync(fragmentPath, 'utf8') !== expected);
  if (needsBackup && !options.sourceRoot) throw new Error('Changing existing SSH configuration requires sourceRoot for quarantine.');
  if (needsBackup) console.log(`BACKUP  Existing SSH configuration under ${path.join(options.sourceRoot, 'quarantine')}`);
  if (!options.dryRun && needsBackup) {
    const quarantine = path.join(options.sourceRoot, 'quarantine');
    fs.mkdirSync(quarantine, { recursive: true });
    const backup = fs.mkdtempSync(path.join(quarantine, `${new Date().toISOString().slice(0, 10)}-ssh-migration-`));
    fs.writeFileSync(path.join(backup, 'config'), original, { mode: 0o600 });
    if (exists) fs.copyFileSync(fragmentPath, path.join(backup, 'local-source-code.conf'));
    fs.writeFileSync(path.join(backup, 'README.md'),
      'SSH configuration preserved before approved migration/replacement. config came from ~/.ssh/config; local-source-code.conf, if present, came from ~/.ssh/config.d/. Restore together after reviewing the Include. No private keys were copied.\n');
    console.log(`BACKUP  ${backup}`);
  }
  if (exists && fs.readFileSync(fragmentPath, 'utf8') === expected) {
    console.log(`KEEP    ${fragmentPath}`);
  } else {
    console.log(`${exists ? 'REPLACE' : 'CREATE '} ${fragmentPath}`);
    if (!options.dryRun) {
      fs.mkdirSync(includeDirectory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(fragmentPath, expected, { mode: 0o600 });
      fs.chmodSync(fragmentPath, 0o600);
    }
  }

  if (includePattern.test(current) && current === original) {
    console.log(`KEEP    ${configPath} includes config.d/*`);
    return;
  }
  console.log(`${current ? 'UPDATE ' : 'CREATE '} ${configPath} with Include config.d/*`);
  if (!options.dryRun) {
    fs.mkdirSync(sshDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(configPath, includePattern.test(current) ? current : `Include config.d/*\n${current ? `\n${current}` : ''}`, { mode: 0o600 });
    fs.chmodSync(configPath, 0o600);
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
  } else {
    const identities = readIdentities(options.configBase64);
    const input = JSON.parse(Buffer.from(options.configBase64, 'base64url').toString('utf8'));
    options.sourceRoot = input.sourceRoot ? expandHome(input.sourceRoot) : null;
    // Validate the complete SSH plan before generating keys or writing files.
    if (!options.dryRun) ensureFragment(identities, { ...options, dryRun: true });
    ensureKeys(identities, options);
    ensureFragment(identities, options);
    console.log(options.dryRun ? 'Dry run complete; no files were changed.' : 'SSH identity setup complete.');
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
