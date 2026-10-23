// wt-config.mjs
//
// Loads the workspace configuration: a JSON data file outside the workspace
// that holds every machine- and person-specific value (accounts, emails, SSH
// keys, Git hosts, and owner routes). This module itself contains no personal
// data and is identical on every installation.
//
// Location: $SOURCE_WORKSPACE_CONFIG, or ~/.config/source-workspace/config.json.
//
// Routing is explicit and fails closed. Every repository owner (organization
// or user) must be routed to exactly one account on its host. An unrouted
// owner is an error that names the command to add a route; nothing is guessed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateKeyPath,
  machineName,
  validateIdentityKeys,
} from './key-policy.mjs';

const PROVIDERS = new Set(['github', 'forgejo', 'bitbucket']);
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const SAFE_HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\'))
    return path.join(os.homedir(), value.slice(2));
  return value;
}

/** Absolute path of the configuration file. */
export function configPath() {
  return path.resolve(
    expandHome(
      process.env.SOURCE_WORKSPACE_CONFIG ||
        '~/.config/source-workspace/config.json',
    ),
  );
}

/** Directory for generated Git include files, next to the configuration file. */
export function gitIncludeDir() {
  return path.join(path.dirname(configPath()), 'git');
}

function fail(message) {
  throw new Error(
    `Invalid workspace configuration (${configPath()}): ${message}`,
  );
}

function text(value, label) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    fail(`${label} must be a non-empty single-line string.`);
  }
  return value.trim();
}

/** Validates raw configuration data and returns a normalized copy. */
export function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    fail('expected a JSON object.');
  if (raw.version !== 2)
    fail(
      'version must be 2; prepare a preserved configuration migration before installing updated helpers.',
    );
  if ('defaultIdentity' in raw || 'defaultAccount' in raw) {
    fail('default accounts are not supported; route every owner explicitly.');
  }
  const sourceRoot = text(raw.sourceRoot ?? '~/Source', 'sourceRoot');
  if (/["\\]/.test(sourceRoot))
    fail('sourceRoot must not contain quotes or backslashes.');

  const settings = { commitAndPush: false, ...(raw.settings ?? {}) };
  if (typeof settings.commitAndPush !== 'boolean')
    fail('settings.commitAndPush must be true or false.');

  const hosts = {};
  for (const [name, value] of Object.entries(raw.hosts ?? {})) {
    const host = name.toLowerCase();
    if (!SAFE_HOST.test(host)) fail(`host name is invalid: ${name}`);
    if (!value || typeof value !== 'object')
      fail(`hosts.${name} must be an object.`);
    if (!PROVIDERS.has(value.provider))
      fail(
        `hosts.${name}.provider must be one of: ${[...PROVIDERS].join(', ')}.`,
      );
    const sshPort = value.sshPort ?? 22;
    if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535)
      fail(`hosts.${name}.sshPort must be a TCP port.`);
    const sshUser = text(value.sshUser ?? 'git', `hosts.${name}.sshUser`);
    const sshHostname = text(
      value.sshHostname ?? host,
      `hosts.${name}.sshHostname`,
    );
    if (!SAFE_HOST.test(sshHostname) || !/^[a-zA-Z0-9_-]+$/.test(sshUser))
      fail('Invalid SSH endpoint.');
    const defaults = {
      github:
        host === 'github.com'
          ? 'https://api.github.com/'
          : `https://${host}/api/v3/`,
      forgejo: `https://${host}/api/v1/`,
      bitbucket: 'https://api.bitbucket.org/2.0/',
    };
    const apiBase = new URL(value.apiBase ?? defaults[value.provider]);
    if (
      apiBase.protocol !== 'https:' ||
      apiBase.username ||
      apiBase.password ||
      apiBase.search ||
      apiBase.hash
    )
      fail(
        'apiBase must be an HTTPS URL without credentials, query, or fragment.',
      );
    const entry = {
      provider: value.provider,
      sshPort,
      sshUser,
      sshHostname,
      apiBase: apiBase.href.endsWith('/') ? apiBase.href : `${apiBase.href}/`,
    };
    hosts[host] = entry;
  }

  const accounts = {};
  const sshHosts = new Map();
  for (const [id, value] of Object.entries(raw.accounts ?? {})) {
    if (!SAFE_ID.test(id))
      fail(
        `account id must use lowercase letters, digits, and single hyphens: ${id}`,
      );
    if (!value || typeof value !== 'object')
      fail(`accounts.${id} must be an object.`);
    const host = text(value.host, `accounts.${id}.host`).toLowerCase();
    if (!hosts[host])
      fail(`accounts.${id}.host is not a configured host: ${host}`);
    const gitEmail = text(value.gitEmail, `accounts.${id}.gitEmail`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gitEmail))
      fail(`accounts.${id}.gitEmail must look like an email address.`);
    const sshHost = text(value.sshHost ?? host, `accounts.${id}.sshHost`);
    const aliases = value.sshHostAliases ?? [];
    if (!Array.isArray(aliases))
      fail(`accounts.${id}.sshHostAliases must be an array.`);
    for (const alias of [sshHost, ...aliases]) {
      if (!SAFE_HOST.test(alias))
        fail(`accounts.${id} has an invalid SSH host alias: ${alias}`);
      const key = alias.toLowerCase();
      if (sshHosts.has(key))
        fail(
          `SSH host alias ${alias} is used by both ${sshHosts.get(key)} and ${id}.`,
        );
      sshHosts.set(key, id);
    }
    accounts[id] = {
      label: text(value.label ?? id, `accounts.${id}.label`),
      host,
      login: text(value.login, `accounts.${id}.login`),
      gitName: text(value.gitName, `accounts.${id}.gitName`),
      gitEmail,
      sshHost,
      sshHostAliases: aliases.map((alias) =>
        text(alias, `accounts.${id}.sshHostAliases`),
      ),
      sshKeyPath: validateKeyPath(
        text(value.sshKeyPath, `accounts.${id}.sshKeyPath`),
      ),
      tokenFile: value.tokenFile
        ? text(value.tokenFile, `accounts.${id}.tokenFile`)
        : null,
    };
  }
  if (!Object.keys(accounts).length) fail('at least one account is required.');

  const routes = {};
  for (const host of Object.keys(hosts)) routes[host] = {};
  for (const [name, table] of Object.entries(raw.routes ?? {})) {
    const host = name.toLowerCase();
    if (!hosts[host]) fail(`routes.${name} is not a configured host.`);
    if (!table || typeof table !== 'object' || Array.isArray(table))
      fail(`routes.${name} must be an object.`);
    for (const [owner, accountId] of Object.entries(table)) {
      if (!SAFE_OWNER.test(owner))
        fail(`routes.${name} has an invalid owner: ${owner}`);
      const key = owner.toLowerCase();
      if (Object.hasOwn(routes[host], key))
        fail(
          `routes.${name} lists ${owner} more than once (owners are case-insensitive).`,
        );
      const account = accounts[accountId];
      if (!account)
        fail(`routes.${name}.${owner} names an unknown account: ${accountId}`);
      if (account.host !== host)
        fail(
          `routes.${name}.${owner} names ${accountId}, which belongs to ${account.host}.`,
        );
      routes[host][key] = accountId;
    }
  }
  const keys = new Map();
  for (const a of Object.values(accounts)) {
    const key = path.resolve(expandHome(a.sshKeyPath));
    const persona = `${a.gitName} <${a.gitEmail}>`;
    if (keys.has(key) && keys.get(key) !== persona)
      fail('Different identities must have distinct SSH keys.');
    keys.set(key, persona);
  }
  validateIdentityKeys(accounts);
  const repositories = {};
  for (const [coordinate, accountId] of Object.entries(
    raw.repositories ?? {},
  )) {
    const parts = coordinate.split('/');
    if (
      parts.length !== 3 ||
      !hosts[parts[0].toLowerCase()] ||
      !SAFE_OWNER.test(parts[1]) ||
      !/^[A-Za-z0-9._-]+$/.test(parts[2]) ||
      parts[2] === '.' ||
      parts[2].includes('..')
    )
      fail(`Invalid repository coordinate: ${coordinate}`);
    if (
      !accounts[accountId] ||
      accounts[accountId].host !== parts[0].toLowerCase()
    )
      fail(`Invalid repository account: ${coordinate}`);
    const key = coordinate.toLowerCase();
    if (repositories[key]) fail(`Duplicate repository: ${coordinate}`);
    repositories[key] = accountId;
  }
  const ownerDirectories = {};
  for (const [coordinate, directory] of Object.entries(
    raw.ownerDirectories ?? {},
  )) {
    const parts = coordinate.toLowerCase().split('/');
    if (
      parts.length !== 2 ||
      !hosts[parts[0]] ||
      !SAFE_OWNER.test(parts[1]) ||
      !SAFE_OWNER.test(directory) ||
      directory.includes('..')
    )
      fail('Invalid owner directory mapping.');
    if (ownerDirectories[coordinate.toLowerCase()])
      fail('Duplicate owner directory mapping.');
    ownerDirectories[coordinate.toLowerCase()] = directory;
  }
  return {
    version: 2,
    sourceRoot,
    settings,
    machineName: machineName(raw.machineName),
    hosts,
    accounts,
    routes,
    repositories,
    ownerDirectories,
  };
}

let cached = null;

/** Reads and validates the configuration file; cached for the process. */
export function loadConfig({ reload = false } = {}) {
  if (cached && !reload) return cached;
  const file = configPath();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Workspace configuration not found at ${file}. Run the setup-local-source-code skill to create it.`,
      );
    }
    throw new Error(
      `Cannot read workspace configuration at ${file}: ${error.message}`,
    );
  }
  cached = normalizeConfig(raw);
  return cached;
}

/** Workspace root from the configuration, or ~/Source when no configuration exists yet. */
export function configuredSourceRoot() {
  try {
    return (
      JSON.parse(fs.readFileSync(configPath(), 'utf8')).sourceRoot ?? '~/Source'
    );
  } catch (error) {
    if (error.code === 'ENOENT') return '~/Source';
    throw error;
  }
}

/** True when `host` is a configured Git host. */
export function isConfiguredHost(host) {
  return Object.hasOwn(loadConfig().hosts, String(host).toLowerCase());
}

/** Settings for one configured host; throws for an unconfigured host. */
export function hostConfig(host) {
  const names = Object.keys(loadConfig().hosts);
  if (!host && names.length !== 1)
    throw new Error('Supply --host when the host is ambiguous.');
  const key = String(host ?? names[0]).toLowerCase();
  const entry = loadConfig().hosts[key];
  if (!entry)
    throw new Error(
      `Unconfigured Git host: ${host}. Add it to ${configPath()} through the setup-local-source-code skill.`,
    );
  return { host: key, ...entry };
}

/** Converts an account into the identity shape used by the helpers. */
export function identityFor(accountId) {
  const config = loadConfig();
  const account = config.accounts[accountId];
  if (!account)
    throw new Error(
      `Unknown account: ${accountId}. Configured accounts: ${Object.keys(config.accounts).join(', ')}.`,
    );
  const host = hostConfig(account.host);
  return {
    id: accountId,
    label: account.label,
    provider: host.provider,
    host: host.host,
    sshPort: host.sshPort,
    login: account.login,
    sshUser: host.sshUser,
    sshHostname: host.sshHostname,
    tokenFile: account.tokenFile,
    gitUserName: account.gitName,
    gitUserEmail: account.gitEmail,
    sshHost: account.sshHost,
    sshHostAliases: account.sshHostAliases,
    sshKeyPath: account.sshKeyPath,
  };
}

/** Every configured account as an identity, optionally limited to one host. */
export function listIdentities(host) {
  const config = loadConfig();
  return Object.keys(config.accounts)
    .map(identityFor)
    .filter(
      (identity) => !host || identity.host === String(host).toLowerCase(),
    );
}

/** The routed identity for an owner, or null when the owner has no route. */
export function findIdentity(owner, host, repository) {
  const config = loadConfig();
  const candidates = Object.keys(config.hosts)
    .filter((h) => !host || h === String(host).toLowerCase())
    .flatMap((h) => {
      const account =
        (repository &&
          config.repositories[`${h}/${owner}/${repository}`.toLowerCase()]) ??
        config.routes[h]?.[String(owner).toLowerCase()];
      return account ? [identityFor(account)] : [];
    });
  if (candidates.length > 1)
    throw new Error(`Ambiguous host for ${owner}; supply --host.`);
  return candidates[0] ?? null;
}

export function resolveIdentity(owner, host, repository) {
  const identity = findIdentity(owner, host, repository);
  if (identity) return identity;
  throw new Error(
    `No route for owner "${owner}"${host ? ` on ${host}` : ''}; add one with wt-route.mjs add ${owner} {account} --host {host}.`,
  );
}

/** Writes the configuration file atomically with owner-only permissions. */
export function saveConfig(raw) {
  const normalized = normalizeConfig(raw);
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
  cached = normalized;
  return normalized;
}

/** Reads the raw (unnormalized) configuration so edits preserve its layout. */
export function readRawConfig() {
  loadConfig({ reload: true });
  return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
}
