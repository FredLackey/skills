#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

function cleanEnvironment() {
  const environment = { ...process.env, GH_PROMPT_DISABLED: '1' };
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN',
    'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_DEBUG']) delete environment[name];
  return environment;
}

function runGh(args, environment = cleanEnvironment()) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message).trim();
    throw new Error(`GitHub CLI command failed: ${detail}`);
  }
}

function runGhInteractive(args) {
  const environment = cleanEnvironment();
  delete environment.GH_PROMPT_DISABLED;
  const result = spawnSync('gh', args, { env: environment, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`GitHub CLI command exited with status ${result.status}.`);
}

function accounts() {
  const result = JSON.parse(runGh([
    'auth', 'status', '--hostname', 'github.com', '--json', 'hosts',
  ]));
  return result.hosts?.['github.com'] ?? [];
}

function tokenFor(user) {
  try {
    return runGh(['auth', 'token', '--hostname', 'github.com', '--user', user]);
  } catch {
    throw new Error(`No stored GitHub token is available for ${user}.`);
  }
}

function authenticatedUser(user) {
  const token = tokenFor(user);
  const environment = { ...cleanEnvironment(), GH_TOKEN: token };
  try {
    return JSON.parse(runGh(['api', '--hostname', 'github.com', 'user'], environment)).login;
  } catch (error) {
    throw new Error(error.message.split(token).join('[REDACTED]'));
  }
}

function optionMap(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(usage());
    }
    if (options.has(name)) throw new Error(`Duplicate option: ${name}`);
    options.set(name, value);
  }
  return options;
}

function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}

function login() {
  runGhInteractive([
    'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'ssh', '--web',
    '--skip-ssh-key', '--scopes', 'admin:public_key,admin:ssh_signing_key',
  ]);
  runGh(['config', 'set', 'git_protocol', 'ssh', '--host', 'github.com']);
  const active = accounts().find((account) => account.active);
  if (!active) throw new Error('Login completed but no account is active in GitHub CLI.');
  console.log(JSON.stringify({ githubUser: active.login }, null, 2));
}

function selectedToken(user) {
  const token = tokenFor(user);
  const environment = { ...cleanEnvironment(), GH_TOKEN: token };
  const actual = JSON.parse(runGh(['api', '--hostname', 'github.com', 'user'], environment)).login;
  if (actual.toLowerCase() !== user.toLowerCase()) {
    throw new Error(`Token identity mismatch: expected ${user}, received ${actual}.`);
  }
  return { token, environment };
}

function publicKeyIdentity(value) {
  const parts = value.trim().split(/\s+/);
  if (parts.length < 2) throw new Error('Public key must contain a key type and encoded key.');
  return { type: parts[0], encoded: parts[1] };
}

function githubKeys(user, type, environment) {
  const suffix = type === 'authentication' ? 'keys' : 'ssh_signing_keys';
  const pages = JSON.parse(runGh([
    'api', '--hostname', 'github.com', `users/${encodeURIComponent(user)}/${suffix}?per_page=100`,
    '--paginate', '--slurp',
  ], environment));
  return pages.flat();
}

function hasKey(keys, wanted) {
  return keys.some(({ key }) => {
    if (typeof key !== 'string') return false;
    const parts = key.trim().split(/\s+/);
    if (parts.length === 1) return parts[0] === wanted.encoded;
    return parts[0] === wanted.type && parts[1] === wanted.encoded;
  });
}

function addOrVerifyKey({ user, publicKey, title, type, environment }) {
  const wanted = publicKeyIdentity(fs.readFileSync(publicKey, 'utf8'));
  if (hasKey(githubKeys(user, type, environment), wanted)) {
    console.log(`KEEP    ${type} key is already registered for ${user}.`);
    return;
  }
  runGh(['ssh-key', 'add', publicKey, '--title', title, '--type', type], environment);
  if (!hasKey(githubKeys(user, type, environment), wanted)) {
    throw new Error(`GitHub did not report the newly added ${type} key for ${user}.`);
  }
  console.log(`CREATE  registered ${publicKey} as a ${type} key for ${user}.`);
}

function keyOptions(options, requireType) {
  const user = options.get('--user');
  const publicKeyInput = options.get('--public-key');
  const title = options.get('--title');
  const type = options.get('--type');
  const allowed = new Set(['--user', '--public-key', '--title', '--type']);
  if ([...options.keys()].some((name) => !allowed.has(name)) ||
      !user || !publicKeyInput || !title ||
      (requireType && !['authentication', 'signing'].includes(type)) ||
      (!requireType && type !== undefined)) {
    throw new Error(usage());
  }
  const publicKey = expandHome(publicKeyInput);
  const stat = fs.statSync(publicKey);
  if (!stat.isFile()) throw new Error(`Public key is not a regular file: ${publicKey}`);
  return { user, publicKey, title, type };
}

function addKey(options) {
  const values = keyOptions(options, true);
  const { token, environment } = selectedToken(values.user);
  try {
    runGh(['config', 'set', 'git_protocol', 'ssh', '--host', 'github.com']);
    addOrVerifyKey({ ...values, environment });
  } catch (error) {
    throw new Error(error.message.split(token).join('[REDACTED]'));
  }
}

function ensureKeys(options) {
  const values = keyOptions(options, false);
  const { token, environment } = selectedToken(values.user);
  try {
    runGh(['config', 'set', 'git_protocol', 'ssh', '--host', 'github.com']);
    for (const type of ['authentication', 'signing']) {
      addOrVerifyKey({ ...values, type, environment });
    }
  } catch (error) {
    throw new Error(error.message.split(token).join('[REDACTED]'));
  }
}

function verifyKeys(options) {
  const user = options.get('--user');
  const publicKeyInput = options.get('--public-key');
  if (options.size !== 2 || !user || !publicKeyInput) throw new Error(usage());
  const publicKey = expandHome(publicKeyInput);
  if (!fs.statSync(publicKey).isFile()) throw new Error(`Public key is not a regular file: ${publicKey}`);
  const wanted = publicKeyIdentity(fs.readFileSync(publicKey, 'utf8'));
  const { token, environment } = selectedToken(user);
  try {
    let missing = false;
    for (const type of ['authentication', 'signing']) {
      const present = hasKey(githubKeys(user, type, environment), wanted);
      console.log(`${present ? 'VERIFIED' : 'MISSING '} ${type} key for ${user}.`);
      if (!present) missing = true;
    }
    if (missing) process.exitCode = 1;
  } catch (error) {
    throw new Error(error.message.split(token).join('[REDACTED]'));
  }
}

function discoverOrgs(options) {
  const user = options.get('--user');
  if (options.size !== 1 || !user) throw new Error(usage());
  const { token, environment } = selectedToken(user);
  try {
    const pages = JSON.parse(runGh([
      'api', '--hostname', 'github.com', 'user/orgs?per_page=100', '--paginate', '--slurp',
    ], environment));
    const orgs = pages.flat().map((org) => org.login);
    console.log(JSON.stringify({ user, orgs }, null, 2));
  } catch (error) {
    throw new Error(error.message.split(token).join('[REDACTED]'));
  }
}

function refreshScopes(options) {
  const user = options.get('--user');
  if (options.size !== 1 || !user) throw new Error(usage());
  const allAccounts = accounts();
  if (!allAccounts.some((account) => account.login?.toLowerCase() === user.toLowerCase())) {
    throw new Error(`${user} is not authenticated in GitHub CLI.`);
  }
  const previous = allAccounts.find((account) => account.active)?.login;
  try {
    runGh(['auth', 'switch', '--hostname', 'github.com', '--user', user]);
    runGhInteractive([
      'auth', 'refresh', '--hostname', 'github.com',
      '--scopes', 'admin:public_key,admin:ssh_signing_key',
    ]);
    runGh(['config', 'set', 'git_protocol', 'ssh', '--host', 'github.com']);
  } finally {
    if (previous && previous.toLowerCase() !== user.toLowerCase()) {
      runGh(['auth', 'switch', '--hostname', 'github.com', '--user', previous]);
    }
  }
}

function usage() {
  return [
    'Usage:',
    '  github-accounts.mjs inventory',
    '  github-accounts.mjs validate --users user-one,user-two',
    '  github-accounts.mjs login',
    '  github-accounts.mjs discover-orgs --user <user>',
    '  github-accounts.mjs refresh-scopes --user <user>',
    '  github-accounts.mjs ensure-keys --user <user> --public-key <path> --title <title>',
    '  github-accounts.mjs verify-keys --user <user> --public-key <path>',
    '  github-accounts.mjs add-key --user <user> --public-key <path> --title <title> --type <authentication|signing>',
    '',
    'login prints the GitHub username of the account that just authenticated —',
    'read it back instead of asking the user to type their username.',
    'inventory, validate, and discover-orgs are read-only. Other commands change',
    'GitHub or gh state. Stored tokens are never printed.',
  ].join('\n');
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === '-h' || command === '--help' || !command) {
    console.log(usage());
    return;
  }
  if (command === 'inventory') {
    if (args.length) throw new Error(usage());
    const safe = accounts().map(({ login, state }) => ({ login, state }));
    console.log(JSON.stringify({ accounts: safe }, null, 2));
    return;
  }

  if (command === 'validate') {
    const options = optionMap(args);
    const value = options.get('--users');
    if (options.size !== 1 || !value) throw new Error(usage());
    const users = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
    if (!users.length) throw new Error('At least one GitHub username is required.');
    const available = new Map(accounts().map((account) => [account.login.toLowerCase(), account]));
    let gitProtocol;
    try {
      gitProtocol = runGh(['config', 'get', 'git_protocol', '--host', 'github.com']);
    } catch {
      gitProtocol = null;
    }
    const results = users.map((user) => {
      const stored = available.get(user.toLowerCase());
      if (!stored || stored.state !== 'success') {
        return { user, valid: false, gitProtocol, reason: 'not authenticated or unhealthy' };
      }
      const actual = authenticatedUser(user);
      const identityMatches = actual.toLowerCase() === user.toLowerCase();
      const protocolMatches = gitProtocol === 'ssh';
      return {
        user,
        valid: identityMatches && protocolMatches,
        gitProtocol,
        reason: !identityMatches ? 'token identity mismatch' :
          protocolMatches ? 'verified' : 'GitHub CLI git protocol is not SSH',
      };
    });
    console.log(JSON.stringify({ results }, null, 2));
    if (results.some((result) => !result.valid)) process.exitCode = 1;
    return;
  }

  if (command === 'login') {
    if (args.length) throw new Error(usage());
    login();
    return;
  }

  if (command === 'discover-orgs') {
    discoverOrgs(optionMap(args));
    return;
  }

  if (command === 'add-key') {
    addKey(optionMap(args));
    return;
  }

  if (command === 'ensure-keys') {
    ensureKeys(optionMap(args));
    return;
  }

  if (command === 'verify-keys') {
    verifyKeys(optionMap(args));
    return;
  }

  if (command === 'refresh-scopes') {
    refreshScopes(optionMap(args));
    return;
  }

  throw new Error(usage());
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
