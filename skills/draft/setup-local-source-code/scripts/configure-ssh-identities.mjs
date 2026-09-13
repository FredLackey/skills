#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

function usage() {
  return [
    'Usage:',
    '  configure-ssh-identities.mjs --config-base64 <base64url-json> [--dry-run] [--replace] [--generate-missing-keys]',
    '',
    '--dry-run               Report changes without writing anything.',
    '--replace               Replace a conflicting managed SSH fragment.',
    '--generate-missing-keys Interactively run ssh-keygen for missing keys.',
    '',
    'Private keys are never printed, copied, replaced, or sent to GitHub.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    configBase64: null, dryRun: false, replace: false, generateMissingKeys: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config-base64') options.configBase64 = argv[++index];
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--replace') options.replace = true;
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
    for (const name of ['githubUser', 'sshHost', 'sshKeyPath']) {
      if (typeof identity[name] !== 'string' || !identity[name].trim()) {
        throw new Error(`${label}.${name} must be a non-empty string.`);
      }
    }
    if (!/^[A-Za-z0-9.-]+$/.test(identity.sshHost)) {
      throw new Error(`${label}.sshHost contains unsupported characters.`);
    }
    const hostKey = identity.sshHost.toLowerCase();
    if (hosts.has(hostKey)) throw new Error(`Duplicate SSH host alias: ${identity.sshHost}`);
    hosts.add(hostKey);
    const privateKey = expandHome(identity.sshKeyPath);
    if (privateKey === path.parse(privateKey).root) throw new Error(`${label}.sshKeyPath is unsafe.`);
    if (keyPaths.has(privateKey)) throw new Error(`SSH private key is shared by multiple identities: ${privateKey}`);
    keyPaths.add(privateKey);
    return {
      githubUser: identity.githubUser.trim(),
      sshHost: identity.sshHost.trim(),
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
    `Host ${identity.sshHost}`,
    '  HostName github.com',
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
function findExternalHostConflicts(configContent, fragmentPath, identities) {
  const wanted = new Set(identities.map((identity) => identity.sshHost.toLowerCase()));
  const conflicts = new Set();
  let insideManagedFragment = false;
  for (const rawLine of configContent.split(/\r?\n/)) {
    const includeMatch = rawLine.match(/^\s*Include\s+(.+?)\s*$/i);
    if (includeMatch) {
      insideManagedFragment = path.resolve(path.dirname(fragmentPath), '..', includeMatch[1]) === fragmentPath
        || includeMatch[1].includes('local-source-code.conf');
      continue;
    }
    const hostMatch = rawLine.match(/^\s*Host\s+(.+?)\s*$/i);
    if (!hostMatch || insideManagedFragment) continue;
    for (const pattern of hostMatch[1].split(/\s+/)) {
      if (wanted.has(pattern.toLowerCase())) conflicts.add(pattern);
    }
  }
  return [...conflicts];
}

function ensureFragment(identities, options) {
  const sshDirectory = path.join(os.homedir(), '.ssh');
  const includeDirectory = path.join(sshDirectory, 'config.d');
  const fragmentPath = path.join(includeDirectory, 'local-source-code.conf');
  const configPath = path.join(sshDirectory, 'config');
  const current = pathExists(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const conflicts = findExternalHostConflicts(current, fragmentPath, identities);
  if (conflicts.length) {
    throw new Error(
      `Conflict: ${configPath} already declares Host ${conflicts.join(', ')} ` +
      `outside the managed config.d/local-source-code.conf fragment. ssh_config uses the first ` +
      'match, so adding the managed fragment would silently shadow (or be shadowed by) that ' +
      'existing block. Remove or migrate the conflicting Host block by hand, then rerun.',
    );
  }
  const expected = sshFragment(identities);
  const exists = pathExists(fragmentPath);
  if (exists && fs.readFileSync(fragmentPath, 'utf8') === expected) {
    console.log(`KEEP    ${fragmentPath}`);
  } else {
    if (exists && !options.replace) {
      throw new Error(`Conflict: ${fragmentPath} differs. Review it before using --replace.`);
    }
    console.log(`${exists ? 'REPLACE' : 'CREATE '} ${fragmentPath}`);
    if (!options.dryRun) {
      fs.mkdirSync(includeDirectory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(fragmentPath, expected, { mode: 0o600 });
      fs.chmodSync(fragmentPath, 0o600);
    }
  }

  const includePattern = /^\s*Include\s+(?:~\/\.ssh\/)?config\.d\/\*\s*$/im;
  if (includePattern.test(current)) {
    console.log(`KEEP    ${configPath} includes config.d/*`);
    return;
  }
  console.log(`${current ? 'UPDATE ' : 'CREATE '} ${configPath} with Include config.d/*`);
  if (!options.dryRun) {
    fs.mkdirSync(sshDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(configPath, `Include config.d/*\n${current ? `\n${current}` : ''}`, { mode: 0o600 });
    fs.chmodSync(configPath, 0o600);
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
  } else {
    const identities = readIdentities(options.configBase64);
    ensureKeys(identities, options);
    ensureFragment(identities, options);
    console.log(options.dryRun ? 'Dry run complete; no files were changed.' : 'SSH identity setup complete.');
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
