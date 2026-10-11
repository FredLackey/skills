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

export const DEFAULT_HOST = 'github.com';
const PROVIDERS = new Set(['github', 'forgejo']);
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const SAFE_HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2));
  return value;
}

/** Absolute path of the configuration file. */
export function configPath() {
  return path.resolve(expandHome(process.env.SOURCE_WORKSPACE_CONFIG || '~/.config/source-workspace/config.json'));
}

/** Directory for generated Git include files, next to the configuration file. */
export function gitIncludeDir() {
  return path.join(path.dirname(configPath()), 'git');
}

function fail(message) {
  throw new Error(`Invalid workspace configuration (${configPath()}): ${message}`);
}

function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(`${label} must be a non-empty single-line string.`);
  }
  return value.trim();
}

/** Validates raw configuration data and returns a normalized copy. */
export function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('expected a JSON object.');
  if (raw.version !== 1) fail('version must be 1.');
  if ('defaultIdentity' in raw || 'defaultAccount' in raw) {
    fail('default accounts are not supported; route every owner explicitly.');
  }
  const sourceRoot = text(raw.sourceRoot ?? '~/Source', 'sourceRoot');
  if (/["\\]/.test(sourceRoot)) fail('sourceRoot must not contain quotes or backslashes.');

  const settings = { commitAndPush: false, ...(raw.settings ?? {}) };
  if (typeof settings.commitAndPush !== 'boolean') fail('settings.commitAndPush must be true or false.');

  const hosts = { [DEFAULT_HOST]: { provider: 'github' } };
  for (const [name, value] of Object.entries(raw.hosts ?? {})) {
    const host = name.toLowerCase();
    if (!SAFE_HOST.test(host)) fail(`host name is invalid: ${name}`);
    if (!value || typeof value !== 'object') fail(`hosts.${name} must be an object.`);
    if (!PROVIDERS.has(value.provider)) fail(`hosts.${name}.provider must be one of: ${[...PROVIDERS].join(', ')}.`);
    if (host === DEFAULT_HOST && value.provider !== 'github') fail(`${DEFAULT_HOST} must use the github provider.`);
    if (value.provider === 'github' && host !== DEFAULT_HOST) fail(`only ${DEFAULT_HOST} may use the github provider.`);
    const sshPort = value.sshPort ?? 22;
    if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) fail(`hosts.${name}.sshPort must be a TCP port.`);
    const entry = { provider: value.provider, sshPort };
    if (value.provider === 'forgejo') {
      entry.tokenFile = text(value.tokenFile ?? `~/.config/forgejo/${host}.json`, `hosts.${name}.tokenFile`);
    }
    hosts[host] = entry;
  }

  const accounts = {};
  const sshHosts = new Map();
  for (const [id, value] of Object.entries(raw.accounts ?? {})) {
    if (!SAFE_ID.test(id)) fail(`account id must use lowercase letters, digits, and single hyphens: ${id}`);
    if (!value || typeof value !== 'object') fail(`accounts.${id} must be an object.`);
    const host = text(value.host ?? DEFAULT_HOST, `accounts.${id}.host`).toLowerCase();
    if (!hosts[host]) fail(`accounts.${id}.host is not a configured host: ${host}`);
    const gitEmail = text(value.gitEmail, `accounts.${id}.gitEmail`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gitEmail)) fail(`accounts.${id}.gitEmail must look like an email address.`);
    const sshHost = text(value.sshHost ?? host, `accounts.${id}.sshHost`);
    const aliases = value.sshHostAliases ?? [];
    if (!Array.isArray(aliases)) fail(`accounts.${id}.sshHostAliases must be an array.`);
    for (const alias of [sshHost, ...aliases]) {
      if (!SAFE_HOST.test(alias)) fail(`accounts.${id} has an invalid SSH host alias: ${alias}`);
      const key = alias.toLowerCase();
      if (sshHosts.has(key)) fail(`SSH host alias ${alias} is used by both ${sshHosts.get(key)} and ${id}.`);
      sshHosts.set(key, id);
    }
    accounts[id] = {
      label: text(value.label ?? id, `accounts.${id}.label`),
      host,
      login: text(value.login, `accounts.${id}.login`),
      gitName: text(value.gitName, `accounts.${id}.gitName`),
      gitEmail,
      sshHost,
      sshHostAliases: aliases.map(alias => text(alias, `accounts.${id}.sshHostAliases`)),
      sshKeyPath: text(value.sshKeyPath, `accounts.${id}.sshKeyPath`),
    };
  }
  if (!Object.keys(accounts).length) fail('at least one account is required.');

  const routes = {};
  for (const host of Object.keys(hosts)) routes[host] = {};
  for (const [name, table] of Object.entries(raw.routes ?? {})) {
    const host = name.toLowerCase();
    if (!hosts[host]) fail(`routes.${name} is not a configured host.`);
    if (!table || typeof table !== 'object' || Array.isArray(table)) fail(`routes.${name} must be an object.`);
    for (const [owner, accountId] of Object.entries(table)) {
      if (!SAFE_OWNER.test(owner)) fail(`routes.${name} has an invalid owner: ${owner}`);
      const key = owner.toLowerCase();
      if (Object.hasOwn(routes[host], key)) fail(`routes.${name} lists ${owner} more than once (owners are case-insensitive).`);
      const account = accounts[accountId];
      if (!account) fail(`routes.${name}.${owner} names an unknown account: ${accountId}`);
      if (account.host !== host) fail(`routes.${name}.${owner} names ${accountId}, which belongs to ${account.host}.`);
      routes[host][key] = accountId;
    }
  }
  return { version: 1, sourceRoot, settings, hosts, accounts, routes };
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
      throw new Error(`Workspace configuration not found at ${file}. Run the setup-local-source-code skill to create it.`);
    }
    throw new Error(`Cannot read workspace configuration at ${file}: ${error.message}`);
  }
  cached = normalizeConfig(raw);
  return cached;
}

/** Workspace root from the configuration, or ~/Source when no configuration exists yet. */
export function configuredSourceRoot() {
  try { return loadConfig().sourceRoot; }
  catch (error) {
    if (/not found/.test(error.message)) return '~/Source';
    throw error;
  }
}

/** True when `host` is a configured Git host. */
export function isConfiguredHost(host) {
  return Object.hasOwn(loadConfig().hosts, String(host).toLowerCase());
}

/** Settings for one configured host; throws for an unconfigured host. */
export function hostConfig(host) {
  const key = String(host).toLowerCase();
  const entry = loadConfig().hosts[key];
  if (!entry) throw new Error(`Unconfigured Git host: ${host}. Add it to ${configPath()} through the setup-local-source-code skill.`);
  return { host: key, ...entry };
}

/** Converts an account into the identity shape used by the helpers. */
export function identityFor(accountId) {
  const config = loadConfig();
  const account = config.accounts[accountId];
  if (!account) throw new Error(`Unknown account: ${accountId}. Configured accounts: ${Object.keys(config.accounts).join(', ')}.`);
  const host = hostConfig(account.host);
  return {
    id: accountId,
    label: account.label,
    provider: host.provider,
    host: host.host,
    sshPort: host.sshPort,
    login: account.login,
    ghUser: host.provider === 'github' ? account.login : undefined,
    forgejoUser: host.provider === 'forgejo' ? account.login : undefined,
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
    .filter(identity => !host || identity.host === String(host).toLowerCase());
}

/** The routed identity for an owner, or null when the owner has no route. */
export function findIdentity(owner, host = DEFAULT_HOST) {
  const { host: key } = hostConfig(host);
  const accountId = loadConfig().routes[key][String(owner).toLowerCase()];
  return accountId ? identityFor(accountId) : null;
}

/** The routed identity for an owner; throws with the fix when the owner has no route. */
export function resolveIdentity(owner, host = DEFAULT_HOST) {
  const identity = findIdentity(owner, host);
  if (identity) return identity;
  const key = String(host).toLowerCase();
  const candidates = listIdentities(key).map(entry => entry.id);
  const hostFlag = key === DEFAULT_HOST ? '' : ` --host ${key}`;
  throw new Error(
    `No route for owner "${owner}" on ${key}; routing never guesses an account.\n` +
      `Add one with: wt-route.mjs add ${owner} {account}${hostFlag}\n` +
      `Accounts on ${key}: ${candidates.join(', ') || 'none configured'}.`
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
