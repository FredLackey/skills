#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.dirname(SCRIPT_DIR);
const ASSET_DIR = path.join(SKILL_DIR, 'assets', 'workspace-scripts');
const MANAGED_FILES = [
  ['clone-all.mjs', 0o755],
  ['clone-mine.mjs', 0o755],
  ['wt-create.mjs', 0o755],
  ['wt-enforce-signing.mjs', 0o755],
  ['wt-list.mjs', 0o755],
  ['wt-open.mjs', 0o755],
  ['wt-prune.mjs', 0o755],
  ['wt-remove.mjs', 0o755],
  ['wt-status.mjs', 0o755],
  ['wt-sync.mjs', 0o755],
  [path.join('lib', 'wt-lib.mjs'), 0o644],
  [path.join('tests', 'clone-all.test.mjs'), 0o644],
  [path.join('tests', 'clone-mine.test.mjs'), 0o644],
  [path.join('tests', 'README.md'), 0o644],
];

function usage() {
  return [
    'Usage:',
    '  setup-local-source-code.mjs --config-base64 <base64url-json> [--dry-run] [--replace]',
    '',
    '--dry-run  Report changes without writing anything.',
    '--replace  Replace conflicting files managed by this setup.',
  ].join('\n');
}

function parseArgs(argv) {
  const result = { dryRun: false, replace: false, configBase64: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--replace') result.replace = true;
    else if (arg === '--config-base64') result.configBase64 = argv[++index];
    else if (arg === '--help' || arg === '-h') result.help = true;
    else throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }
  if (!result.help && !result.configBase64) throw new Error(usage());
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
    throw new Error('The --config-base64 value must be Base64URL-encoded JSON.');
  }
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  const result = value.trim();
  if (/[\u0000-\u001f\u007f]/.test(result)) {
    throw new Error(`${label} must not contain control characters.`);
  }
  return result;
}

function requireSafeId(value, label) {
  const result = requireString(value, label);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) {
    throw new Error(`${label} must use lowercase letters, digits, and single hyphens.`);
  }
  return result;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function normalizeConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Configuration must be a JSON object.');
  }

  const sourceRoot = requireString(input.sourceRoot ?? '~/Source', 'sourceRoot');
  const resolvedRoot = expandHome(sourceRoot);
  if (resolvedRoot === path.parse(resolvedRoot).root) {
    throw new Error('sourceRoot must not be a filesystem root.');
  }

  const identities = requireArray(input.identities, 'identities').map((item, index) => {
    const label = `identities[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${label} must be an object.`);
    }
    const gitEmail = requireString(item.gitEmail, `${label}.gitEmail`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gitEmail)) {
      throw new Error(`${label}.gitEmail must look like an email address.`);
    }
    const githubUser = requireString(item.githubUser, `${label}.githubUser`);
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(githubUser)) {
      throw new Error(`${label}.githubUser is not a valid GitHub username.`);
    }
    const orgs = requireArray(item.orgs ?? [], `${label}.orgs`).map((org, orgIndex) =>
      requireString(org, `${label}.orgs[${orgIndex}]`).toLowerCase());
    for (const route of orgs) {
      if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(route)) {
        throw new Error(`${label}.orgs contains an invalid organization: ${route}`);
      }
    }
    const sshHost = requireString(item.sshHost, `${label}.sshHost`);
    if (!/^[A-Za-z0-9.-]+$/.test(sshHost)) {
      throw new Error(`${label}.sshHost contains unsupported characters.`);
    }
    const sshKeyPath = requireString(item.sshKeyPath, `${label}.sshKeyPath`);
    if (expandHome(sshKeyPath) === path.parse(expandHome(sshKeyPath)).root) {
      throw new Error(`${label}.sshKeyPath is unsafe.`);
    }
    return {
      id: requireSafeId(item.id, `${label}.id`),
      clientName: requireString(item.clientName, `${label}.clientName`),
      gitName: requireString(item.gitName, `${label}.gitName`),
      gitEmail,
      githubUser,
      sshHost,
      sshKeyPath,
      orgs: [...new Set(orgs)],
    };
  });
  if (!identities.length) throw new Error('At least one identity is required.');

  const ids = new Set();
  const sshHosts = new Set();
  const sshKeys = new Set();
  const exactRoutes = new Map();
  for (const identity of identities) {
    if (ids.has(identity.id)) throw new Error(`Duplicate identity id: ${identity.id}`);
    ids.add(identity.id);
    const hostKey = identity.sshHost.toLowerCase();
    const keyPath = expandHome(identity.sshKeyPath);
    if (sshHosts.has(hostKey)) throw new Error(`SSH host alias is shared by multiple identities: ${identity.sshHost}`);
    if (sshKeys.has(keyPath)) throw new Error(`SSH private key is shared by multiple identities: ${identity.sshKeyPath}`);
    sshHosts.add(hostKey);
    sshKeys.add(keyPath);
    for (const org of identity.orgs) {
      if (exactRoutes.has(org)) throw new Error(`Organization ${org} is routed more than once.`);
      exactRoutes.set(org, identity.id);
    }
  }
  const defaultIdentity = requireSafeId(input.defaultIdentity, 'defaultIdentity');
  if (!ids.has(defaultIdentity)) throw new Error('defaultIdentity must match an identity id.');

  return { sourceRoot, resolvedRoot, defaultIdentity, identities };
}

function generatedConfig(config) {
  const identityEntries = Object.fromEntries(config.identities.map((identity) => [identity.id, {
    clientName: identity.clientName,
    sshHost: identity.sshHost,
    sshKeyPath: identity.sshKeyPath,
    gitUserName: identity.gitName,
    gitUserEmail: identity.gitEmail,
    ghUser: identity.githubUser,
  }]));
  const exactEntries = Object.fromEntries(config.identities.flatMap((identity) =>
    identity.orgs.map((org) => [org, identity.id])));

  return `// Generated by the setup-local-source-code skill.\n` +
    `// Re-run the setup script with confirmed interview and discovery data to change it.\n\n` +
    `export const sourceRoot = ${JSON.stringify(config.sourceRoot)};\n` +
    `export const defaultIdentity = ${JSON.stringify(config.defaultIdentity)};\n` +
    `export const identities = ${JSON.stringify(identityEntries, null, 2)};\n` +
    `export const orgIdentity = ${JSON.stringify(exactEntries, null, 2)};\n\n` +
    `export function resolveIdentity(org) {\n` +
    `  const normalized = org.toLowerCase();\n` +
    `  const exact = orgIdentity[normalized];\n` +
    `  return identities[exact ?? defaultIdentity];\n` +
    `}\n`;
}

function generatedGuide(config) {
  const routes = config.identities.map((identity) => {
    const exact = identity.orgs.length ? identity.orgs.map((item) => `\`${item}\``).join(', ') : 'none';
    const fallback = identity.id === config.defaultIdentity ? ' This is the default identity.' : '';
    return `### ${identity.clientName} (\`${identity.id}\`)\n\n` +
      `GitHub user: \`${identity.githubUser}\`; author email: \`${identity.gitEmail}\`; ` +
      `SSH host: \`${identity.sshHost}\`; organizations discovered at setup: ${exact}.${fallback}`;
  }).join('\n\n');

  return `# Local Source Workspace\n\n` +
    `This workspace keeps primary clones separate from day-to-day work. Its root is ` +
    `\`${config.sourceRoot}\`.\n\n` +
    `## Layout\n\n` +
    `- \`repos/{org}/{repo}\`: primary clones; never edit these directly.\n` +
    `- \`trees/{client-or-project}/{ticket-or-slug}/{repo}\`: task worktrees.\n` +
    `- \`local/{slug}\`: local-only projects that are not Git repositories.\n` +
    `- \`scripts\`: executable, dependency-free Node.js workspace tools.\n` +
    `- \`research\`: dated, durable research notes indexed by \`TOPICS.md\`.\n\n` +
    `A ticket folder is a plain grouping directory. Every repository worktree inside ` +
    `one ticket folder uses the ticket ID or slug as its branch name.\n\n` +
    `## Commands\n\n` +
    `- \`wt-create.mjs {org}/{repo} {client} {ticket}\`: create or reuse a worktree.\n` +
    `- \`wt-enforce-signing.mjs\`: audit or repair identity and SSH signing in every primary clone.\n` +
    `- \`wt-sync.mjs {org}/{repo}\`: fast-forward a clean primary clone.\n` +
    `- \`wt-list.mjs\` and \`wt-status.mjs\`: inspect task worktrees.\n` +
    `- \`wt-remove.mjs\` and \`wt-prune.mjs\`: safely clean up worktrees.\n` +
    `- \`wt-open.mjs {client} {ticket}\`: open a ticket folder in VS Code.\n` +
    `- \`clone-all.mjs [--profile {name}]\`: clone every repository in organizations routed to configured GitHub profiles.\n` +
    `- \`clone-mine.mjs\`: discover and clone repositories associated with configured accounts.\n\n` +
    `## GitHub identities\n\n${routes}\n\n` +
    `Routes are case-insensitive and exact-match only, discovered from each identity's own ` +
    `GitHub CLI login; unmatched organizations use the default identity. An organization created ` +
    `later for an existing client is picked up by re-running discovery, not a prefix rule. ` +
    `Never cross identities between clients. Clones use SSH and commits are configured for SSH signing.\n\n` +
    `## Research\n\n` +
    `Store each topic under \`research/{YYYY}/{MM}/{DD}/{topic-slug}\` with a detailed ` +
    `\`README.md\`, separate \`findings-{subtopic}.md\` files, and a final \`SUMMARY.md\`. ` +
    `Add every topic to \`research/TOPICS.md\`.\n`;
}

function topicsIndex() {
  return '# Research Topics\n\nAdd each research topic here with its relative path and a concise description.\n';
}

function sameFile(target, content) {
  try {
    return fs.readFileSync(target).equals(Buffer.isBuffer(content) ? content : Buffer.from(content));
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
    throw new Error(`Conflict: ${target} differs. Review it and rerun with --replace only if approved.`);
  }
  console.log(`${exists ? 'REPLACE' : 'CREATE '} ${target}`);
  if (options.dryRun) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
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
    throw new Error(`Conflict: ${target} differs. Review it and rerun with --replace only if approved.`);
  }
  console.log(`${exists ? 'REPLACE' : 'CREATE '} ${target} as an alias of CLAUDE.md`);
  if (options.dryRun) return;
  if (exists) {
    const stat = fs.lstatSync(target);
    if (stat.isDirectory()) throw new Error(`Cannot replace directory: ${target}`);
    fs.unlinkSync(target);
  }
  try {
    fs.symlinkSync('CLAUDE.md', target, 'file');
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'UNKNOWN'].includes(error.code)) throw error;
    fs.writeFileSync(target, guide, { mode: 0o644 });
    console.log(`FALLBACK ${target} created as a copy because file symlinks are unavailable.`);
  }
}

function install(config, options) {
  const root = config.resolvedRoot;
  for (const directory of ['repos', 'trees', 'local', 'scripts', path.join('scripts', 'lib'), 'research']) {
    const target = path.join(root, directory);
    if (!fs.existsSync(target)) {
      console.log(`MKDIR   ${target}`);
      if (!options.dryRun) fs.mkdirSync(target, { recursive: true });
    }
  }

  for (const [relative, mode] of MANAGED_FILES) {
    const source = path.join(ASSET_DIR, relative);
    applyFile(path.join(root, 'scripts', relative), fs.readFileSync(source), options, mode);
  }
  applyFile(path.join(root, 'scripts', 'lib', 'wt-config.mjs'), generatedConfig(config), options, 0o644);
  const guide = generatedGuide(config);
  applyFile(path.join(root, 'CLAUDE.md'), guide, options, 0o644);
  applyGuideAlias(root, guide, options);

  const topics = path.join(root, 'research', 'TOPICS.md');
  if (fs.existsSync(topics)) console.log(`PRESERVE ${topics}`);
  else applyFile(topics, topicsIndex(), options, 0o644);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
  } else {
    const config = normalizeConfig(decodeConfig(options.configBase64));
    install(config, options);
    console.log(options.dryRun ? 'Dry run complete; no files were changed.' : 'Workspace setup complete.');
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
