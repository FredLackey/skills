#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { preserveBeforeWrite } from '../assets/workspace-scripts/lib/preserve.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.dirname(SCRIPT_DIR);
const ASSET_DIR = path.join(SKILL_DIR, 'assets', 'workspace-scripts');
const GUIDE_FILE = path.join(
  SKILL_DIR,
  'assets',
  'workspace-guide',
  'CLAUDE.md',
);
const { configPath, normalizeConfig: validateWorkspaceConfig } = await import(
  pathToFileURL(path.join(ASSET_DIR, 'lib', 'wt-config.mjs')).href
);

/** Every helper asset, as [relative path, mode]; top-level .mjs files are executable. */
function managedFiles(dir = ASSET_DIR, prefix = '') {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory())
        return managedFiles(path.join(dir, entry.name), relative);
      return [
        [relative, !prefix && entry.name.endsWith('.mjs') ? 0o755 : 0o644],
      ];
    });
}

function usage() {
  return [
    'Usage:',
    '  setup-local-source-code.mjs --config-base64 <base64url-json> [--dry-run] [--replace]',
    '  setup-local-source-code.mjs --update [--dry-run] [--replace]',
    '',
    '--config-base64  Full setup: write the workspace configuration, helpers, and guide.',
    "--update         Pull the skill's helpers and guide into an existing workspace.",
    '                 Reads the existing configuration and never changes it.',
    '--dry-run        Report changes without writing anything.',
    '--replace        Replace conflicting files managed by this setup.',
    '',
    `Configuration file: ${configPath()} (override with SOURCE_WORKSPACE_CONFIG).`,
  ].join('\n');
}

function parseArgs(argv) {
  const result = {
    dryRun: false,
    replace: false,
    update: false,
    configBase64: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--replace') result.replace = true;
    else if (arg === '--update') result.update = true;
    else if (arg === '--config-base64') result.configBase64 = argv[++index];
    else if (arg === '--help' || arg === '-h') result.help = true;
    else throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }
  if (!result.help && Boolean(result.configBase64) === result.update)
    throw new Error(usage());
  return result;
}

function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}

function decodeConfig(encoded) {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new Error(
      'The --config-base64 value must be Base64URL-encoded JSON.',
    );
  }
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

/**
 * Converts the interview result into the workspace configuration file:
 * one account per identity, and one explicit route per discovered
 * organization plus the account's own login. There is no default account.
 */
function buildWorkspaceConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Configuration must be a JSON object.');
  }
  if ('defaultIdentity' in input) {
    throw new Error(
      'defaultIdentity is no longer supported: every owner is routed explicitly.',
    );
  }
  if (typeof input.settings?.commitAndPush !== 'boolean') {
    throw new Error(
      'settings.commitAndPush must be true or false (ask during the interview).',
    );
  }
  const accounts = {};
  const routes = {};
  requireArray(input.identities, 'identities').forEach((item, index) => {
    const label = `identities[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error(`${label} must be an object.`);
    const host = String(item.host ?? '').toLowerCase();
    const login = item.login;
    if (Object.hasOwn(accounts, item.id))
      throw new Error(`Duplicate identity id: ${item.id}`);
    accounts[item.id] = {
      label: item.clientName,
      host,
      login,
      gitName: item.gitName,
      gitEmail: item.gitEmail,
      tokenFile: item.tokenFile,
      sshHost: item.sshHost,
      sshHostAliases: item.sshHostAliases ?? [],
      sshKeyPath: item.sshKeyPath,
    };
    routes[host] ??= {};
    for (const owner of [
      ...requireArray(item.orgs ?? [], `${label}.orgs`),
      login,
    ]) {
      const key = String(owner).toLowerCase();
      if (routes[host][key] && routes[host][key] !== item.id) {
        throw new Error(
          `${owner} on ${host} is claimed by both ${routes[host][key]} and ${item.id}.`,
        );
      }
      routes[host][key] = item.id;
    }
  });
  const config = {
    version: 2,
    machineName: input.machineName,
    repositories: input.repositories ?? {},
    ownerDirectories: input.ownerDirectories ?? {},
    sourceRoot: input.sourceRoot ?? '~/Source',
    settings: {
      commitAndPush: input.settings.commitAndPush,
      agentCaching: input.settings.agentCaching === true,
      useKeychain: input.settings.useKeychain === true,
    },
    hosts: input.hosts ?? {},
    accounts,
    routes,
  };
  const normalized = validateWorkspaceConfig(config);
  const sshKeys = new Map();
  for (const [id, account] of Object.entries(normalized.accounts)) {
    const keyPath = expandHome(account.sshKeyPath);
    if (keyPath === path.parse(keyPath).root)
      throw new Error(`${id}.sshKeyPath is unsafe.`);
    const persona = `${account.gitName} <${account.gitEmail}>`;
    if (sshKeys.has(keyPath) && sshKeys.get(keyPath) !== persona)
      throw new Error('Different identities must have different SSH keys.');
    sshKeys.set(keyPath, persona);
  }
  const resolvedRoot = expandHome(normalized.sourceRoot);
  if (resolvedRoot === path.parse(resolvedRoot).root)
    throw new Error('sourceRoot must not be a filesystem root.');
  return { config, resolvedRoot };
}

function existingWorkspaceRoot() {
  const file = configPath();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error(
        `No workspace configuration at ${file}; run full setup first.`,
      );
    throw error;
  }
  return expandHome(validateWorkspaceConfig(raw).sourceRoot);
}

function topicsIndex() {
  return '# Research Topics\n\nAdd each research topic here with its relative path and a concise description.\n';
}

function sameFile(target, content) {
  try {
    return fs
      .readFileSync(target)
      .equals(Buffer.isBuffer(content) ? content : Buffer.from(content));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
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

function applyFile(target, content, options, mode) {
  const exists = pathExists(target);
  if (sameFile(target, content)) {
    console.log(`KEEP    ${target}`);
    return;
  }
  if (exists && !options.replace) {
    throw new Error(
      `Conflict: ${target} differs. Review it and rerun with --replace only if approved.`,
    );
  }
  console.log(`${exists ? 'REPLACE' : 'CREATE '} ${target}`);
  if (options.dryRun) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (exists)
    preserveBeforeWrite(
      [target],
      'Replacing a managed setup artifact.',
      options.sourceRoot,
    );
  fs.writeFileSync(target, content, { mode });
  if (mode) fs.chmodSync(target, mode);
}

function applyGuideAlias(root, guide, options) {
  const target = path.join(root, 'AGENTS.md');
  if (sameFile(target, guide)) {
    console.log(`KEEP    ${target}`);
    return;
  }
  const exists = pathExists(target);
  if (exists && !options.replace) {
    throw new Error(
      `Conflict: ${target} differs. Review it and rerun with --replace only if approved.`,
    );
  }
  console.log(
    `${exists ? 'REPLACE' : 'CREATE '} ${target} as an alias of CLAUDE.md`,
  );
  if (options.dryRun) return;
  if (exists) {
    const stat = fs.lstatSync(target);
    if (stat.isDirectory())
      throw new Error(`Cannot replace directory: ${target}`);
    preserveBeforeWrite(
      [target],
      'Replacing a reviewed workspace guide alias.',
      options.sourceRoot,
    );
    fs.unlinkSync(target);
  }
  try {
    fs.symlinkSync('CLAUDE.md', target, 'file');
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'UNKNOWN'].includes(error.code))
      throw error;
    fs.writeFileSync(target, guide, { mode: 0o644 });
    console.log(
      `FALLBACK ${target} created as a copy because file symlinks are unavailable.`,
    );
  }
}

function installHelpers(root, options) {
  for (const directory of ['repos', 'trees', 'local', 'scripts', 'research']) {
    const target = path.join(root, directory);
    if (!fs.existsSync(target)) {
      console.log(`MKDIR   ${target}`);
      if (!options.dryRun) fs.mkdirSync(target, { recursive: true });
    }
  }

  const files = managedFiles();
  for (const [relative, mode] of files) {
    applyFile(
      path.join(root, 'scripts', relative),
      fs.readFileSync(path.join(ASSET_DIR, relative)),
      options,
      mode,
    );
  }
  const guide = fs.readFileSync(GUIDE_FILE);
  applyFile(path.join(root, 'CLAUDE.md'), guide, options, 0o644);
  applyGuideAlias(root, guide, options);

  const topics = path.join(root, 'research', 'TOPICS.md');
  if (fs.existsSync(topics)) console.log(`PRESERVE ${topics}`);
  else applyFile(topics, topicsIndex(), options, 0o644);

  // scripts/ holds only the skill's helpers; report anything else for the user to move.
  const managed = new Set(files.map(([relative]) => relative));
  const scriptsDir = path.join(root, 'scripts');
  const walk = (dir, prefix = '') =>
    (fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true })
      : []
    ).flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(dir, entry.name), path.join(prefix, entry.name))
        : [path.join(prefix, entry.name)],
    );
  for (const relative of walk(scriptsDir).filter(
    (name) => !managed.has(name),
  )) {
    console.log(
      `UNMANAGED ${path.join(scriptsDir, relative)} (not part of the skill; move personal tools elsewhere, e.g. ~/.local/bin)`,
    );
  }
}

function install(input, options) {
  const { config, resolvedRoot } = buildWorkspaceConfig(input);
  options = { ...options, sourceRoot: resolvedRoot };
  installHelpers(resolvedRoot, { ...options, dryRun: true });
  applyFile(
    configPath(),
    `${JSON.stringify(config, null, 2)}\n`,
    options,
    0o600,
  );
  installHelpers(resolvedRoot, options);
  console.log(
    'Next: run scripts/wt-enforce-signing.mjs --dry-run, then without --dry-run.',
  );
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
  } else {
    if (options.update) installHelpers(existingWorkspaceRoot(), options);
    else install(decodeConfig(options.configBase64), options);
    console.log(
      options.dryRun
        ? 'Dry run complete; no files were changed.'
        : 'Workspace setup complete.',
    );
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
