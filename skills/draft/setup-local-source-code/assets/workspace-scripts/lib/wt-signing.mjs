// Native account includes, repository routing, SSH signing policy and local trust.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateIdentityKeys } from './key-policy.mjs';
import { preserveBeforeWrite } from './preserve.mjs';
import { fileURLToPath } from 'node:url';
import { gitIncludeDir, identityFor, loadConfig } from './wt-config.mjs';
import { git, gitOrNull } from './wt-lib.mjs';

export const SIGNING_KEYS = [
  'user.name',
  'user.email',
  'user.signingkey',
  'gpg.format',
  'commit.gpgsign',
  'tag.gpgsign',
  'user.useconfigonly',
  'gpg.ssh.program',
  'gpg.ssh.allowedsignersfile',
  'core.sshcommand',
  'ssh.variant',
];

function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function quote(value) {
  if (/["\\\n]/.test(value))
    throw new Error(
      `Unsupported character in Git configuration value: ${value}`,
    );
  return `"${value}"`;
}

/** Expected effective Git settings for an identity. */
export function expectedSettings(identity) {
  return {
    'user.name': identity.gitUserName,
    'user.email': identity.gitUserEmail,
    'user.signingkey': expandHome(identity.sshKeyPath),
    'gpg.format': 'ssh',
    'commit.gpgsign': 'true',
    'tag.gpgsign': 'true',
    'user.useconfigonly': 'true',
    'gpg.ssh.program': path.join(gitIncludeDir(), 'ssh-sign'),
    'gpg.ssh.allowedsignersfile': path.join(gitIncludeDir(), 'allowed_signers'),
    'core.sshcommand': `${shellQuote(loadConfig().settings.nodePath)} ${shellQuote(fileURLToPath(new URL('../wt-ssh.mjs', import.meta.url)))}`,
    'ssh.variant': 'ssh',
  };
}

export function routesIncludePath() {
  return path.join(gitIncludeDir(), 'routes.gitconfig');
}

/** Generated files, as { path: content }. */
function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
const casePattern = (value) =>
  value.replace(/[a-zA-Z]/g, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);

export function renderWorkstationFiles() {
  const config = loadConfig();
  validateIdentityKeys(config.accounts, { requireFiles: true });
  const dir = gitIncludeDir();
  const files = {};
  const header = '# Managed workstation configuration.\n';
  for (const accountId of Object.keys(config.accounts)) {
    const settings = expectedSettings(identityFor(accountId));
    files[path.join(dir, `${accountId}.gitconfig`)] =
      header +
      `[user]\n\tname = ${quote(settings['user.name'])}\n\temail = ${quote(settings['user.email'])}\n\tsigningkey = ${quote(settings['user.signingkey'])}\n`;
  }
  const scripts = path.dirname(
    fileURLToPath(new URL('../wt-sign.mjs', import.meta.url)),
  );
  const signer = path.join(dir, 'ssh-sign');
  files[signer] =
    `#!/bin/sh\nexec ${shellQuote(config.settings.nodePath)} ${shellQuote(path.join(scripts, 'wt-sign.mjs'))} "$@"\n`;
  const transport = `${shellQuote(loadConfig().settings.nodePath)} ${shellQuote(path.join(scripts, 'wt-ssh.mjs'))}`;
  const trust = path.join(dir, 'allowed_signers');
  const previousTrust = gitOrNull([
    'config',
    '--global',
    '--includes',
    '--get',
    'gpg.ssh.allowedSignersFile',
  ]);
  const trustLines = [];
  for (const file of new Set(
    [trust, previousTrust && expandHome(previousTrust)].filter(Boolean),
  )) {
    if (fs.existsSync(file))
      trustLines.push(
        ...fs.readFileSync(file, 'utf8').split('\n').filter(Boolean),
      );
  }
  for (const a of Object.values(config.accounts)) {
    const key = fs
      .readFileSync(expandHome(`${a.sshKeyPath}.pub`), 'utf8')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(' ');
    if (!/^(ssh-|ecdsa-|sk-)/.test(key))
      throw new Error('Invalid public signing key.');
    trustLines.push(`${a.gitEmail} ${key}`);
  }
  files[trust] = [...new Set(trustLines)].join('\n') + '\n';
  const lines = [
    header,
    `[user]\n\tuseConfigOnly = true\n\tname = ""\n\temail = ""\n\tsigningkey = ""\n[gpg]\n\tformat = ssh\n[gpg "ssh"]\n\tprogram = ${quote(signer)}\n\tallowedSignersFile = ${quote(trust)}\n[commit]\n\tgpgsign = true\n[tag]\n\tgpgsign = true\n[core]\n\tsshCommand = ${quote(transport)}\n[ssh]\n\tvariant = ssh\n`,
  ];
  const entries = [];
  for (const [host, table] of Object.entries(config.routes))
    for (const [owner, account] of Object.entries(table))
      entries.push({ host, owner, account });
  for (const [coordinate, account] of Object.entries(config.repositories)) {
    const [host, owner, repo] = coordinate.split('/');
    entries.push({ host, owner, repo, account });
  }
  for (const { host, owner, repo, account } of entries) {
    const identity = identityFor(account);
    const suffix = repo ? `${owner}/${repo}` : `${owner}/`;
    for (const endpoint of new Set([
      host,
      identity.sshHost,
      ...identity.sshHostAliases,
    ])) {
      for (const prefix of [
        `${identity.sshUser}@${endpoint}:`,
        `ssh://${identity.sshUser}@${endpoint}/`,
        `ssh://${identity.sshUser}@${endpoint}:${identity.sshPort}/`,
        `https://${endpoint}/`,
      ]) {
        for (const end of repo ? ['', '.git'] : ['**']) {
          const pattern = casePattern(prefix + suffix) + end;
          lines.push(
            `[includeIf ${quote(`hasconfig:remote.*.url:${pattern}`)}]\n\tpath = ${quote(path.join(dir, `${account}.gitconfig`))}\n`,
          );
        }
      }
    }
    const target = `${identity.sshUser}@${identity.sshHost}:${suffix}`;
    for (const prefix of [
      `${identity.sshUser}@${host}:`,
      `ssh://${identity.sshUser}@${host}/`,
      `ssh://${identity.sshUser}@${host}:${identity.sshPort}/`,
      `https://${host}/`,
    ]) {
      if (
        !repo &&
        !Object.keys(config.repositories).some((key) =>
          key.startsWith(`${host}/${owner}/`),
        )
      )
        lines.push(
          `[url ${quote(target)}]\n\tinsteadOf = ${quote(prefix + suffix)}\n`,
        );
    }
  }
  files[routesIncludePath()] = lines.join('');
  return files;
}

function globalIncludes() {
  return (gitOrNull(['config', '--global', '--get-all', 'include.path']) ?? '')
    .split('\n')
    .filter(Boolean)
    .map((entry) => path.resolve(expandHome(entry)));
}

/** Differences between generated files and disk, plus global registration. */
export function workstationStatus() {
  const files = Object.entries(renderWorkstationFiles()).map(
    ([file, content]) => {
      let current = null;
      try {
        current = fs.readFileSync(file, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      return {
        file,
        content,
        state:
          current === null
            ? 'create'
            : current === content &&
                (file !== path.join(gitIncludeDir(), 'ssh-sign') ||
                  fs.statSync(file).mode & 0o100)
              ? 'keep'
              : 'replace',
      };
    },
  );
  const registered = globalIncludes().includes(routesIncludePath());
  const reference = expectedSettings(
    identityFor(Object.keys(loadConfig().accounts)[0]),
  );
  const policy = {
    ...reference,
    'user.name': '',
    'user.email': '',
    'user.signingkey': '',
  };
  const policyDrift = Object.entries(policy)
    .filter(
      ([key, value]) =>
        gitOrNull(['config', '--global', '--includes', '--get', key]) !== value,
    )
    .map(([key]) => key);
  return {
    files,
    registered,
    policyDrift,
    ready:
      registered &&
      !policyDrift.length &&
      files.every((entry) => entry.state === 'keep'),
  };
}

/** Writes generated files; registers the global include only when `register` is true. */
export function writeWorkstationFiles({ register = false } = {}) {
  const status = workstationStatus();
  const globalFile =
    process.env.GIT_CONFIG_GLOBAL ?? path.join(os.homedir(), '.gitconfig');
  preserveBeforeWrite(
    [
      ...status.files.filter((f) => f.state === 'replace').map((f) => f.file),
      ...(!status.registered && register ? [globalFile] : []),
    ],
    'Installing repository-selected SSH signing policy.',
  );
  fs.mkdirSync(gitIncludeDir(), { recursive: true, mode: 0o700 });
  for (const entry of status.files) {
    if (entry.state === 'keep') continue;
    const mode =
      entry.file === path.join(gitIncludeDir(), 'ssh-sign') ? 0o700 : 0o600;
    fs.writeFileSync(entry.file, entry.content, { mode });
    fs.chmodSync(entry.file, mode);
  }
  if (register && !status.registered) {
    fs.mkdirSync(path.dirname(globalFile), { recursive: true, mode: 0o700 });
    fs.appendFileSync(
      globalFile,
      `\n[include]\n\tpath = ${quote(routesIncludePath())}\n`,
      { mode: 0o600 },
    );
  }
  return status;
}

/** Throws unless the workstation signing configuration is installed and current. */
export function assertWorkstationReady() {
  if (!workstationStatus().ready) {
    throw new Error(
      'Workstation signing configuration is missing or out of date. Run wt-enforce-signing.mjs, then retry.',
    );
  }
}

/**
 * Effective identity/signing values in a repository, compared with the routed
 * identity. Returns drift entries: { key, expected, actual, origin, local }.
 */
export function effectiveDrift(repoDir, identity) {
  const expected = expectedSettings(identity);
  const output =
    gitOrNull(
      [
        'config',
        '--show-origin',
        '--get-regexp',
        '^(user\\.(name|email|signingkey|useconfigonly)|gpg\\.(format|ssh\\.(program|allowedsignersfile))|commit\\.gpgsign|tag\\.gpgsign|core\\.sshcommand|ssh\\.variant)$',
      ],
      { cwd: repoDir },
    ) ?? '';
  const actual = {};
  for (const line of output.split('\n').filter(Boolean)) {
    const match = line.match(/^([^\t]+)\t(\S+) ?(.*)$/);
    if (!match) continue;
    const [, origin, key, value] = match;
    actual[key.toLowerCase()] = { value, origin };
  }
  return SIGNING_KEYS.flatMap((key) => {
    const found = actual[key];
    const normalize = (value) =>
      key === 'user.signingkey' ? path.resolve(expandHome(value)) : value;
    if (found && normalize(found.value) === normalize(expected[key])) return [];
    return [
      {
        key,
        expected: expected[key],
        actual: found?.value ?? null,
        origin: found?.origin ?? null,
        local: Boolean(
          found?.origin &&
          /^file:(\.git\/config|.*\/\.git\/config)$/.test(found.origin),
        ),
      },
    ];
  });
}

/** Keys set in a repository's own configuration (these override the workstation). */
export function localOverrides(repoDir) {
  return SIGNING_KEYS.filter(
    (key) =>
      gitOrNull(['config', '--local', '--get-all', key], { cwd: repoDir }) !==
      null,
  );
}

/** Removes identity/signing keys from a repository's own configuration. */
export function removeLocalOverrides(repoDir) {
  const removed = localOverrides(repoDir);
  if (removed.length)
    preserveBeforeWrite(
      [
        path.resolve(
          repoDir,
          git(['rev-parse', '--git-path', 'config'], { cwd: repoDir }),
        ),
      ],
      'Removing reviewed direct repository identity overrides.',
    );
  for (const key of removed)
    git(['config', '--local', '--unset-all', key], { cwd: repoDir });
  return removed;
}

export function describeDrift(drift) {
  return drift
    .map(
      (entry) =>
        `${entry.key}=${entry.actual ?? '(unset)'}${entry.origin ? ` from ${entry.origin}` : ''}`,
    )
    .join(', ');
}
