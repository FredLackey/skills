import { execFileSync } from 'node:child_process';
import { loadConfig, identityFor, resolveIdentity } from './wt-config.mjs';

export function readGit(args, cwd = process.cwd()) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

export function parseRemote(value) {
  let endpoint, pathname, user, port, protocol;
  const scp = value.match(/^([^@:/\s]+)@([^:/\s]+):(.+)$/);
  if (scp) {
    [, user, endpoint, pathname] = scp;
    protocol = 'ssh:';
  } else {
    const url = new URL(value);
    if (
      !['ssh:', 'https:'].includes(url.protocol) ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Unsupported repository URL.');
    endpoint = url.hostname;
    pathname = url.pathname.slice(1);
    user = url.username;
    port = url.port;
    protocol = url.protocol;
  }
  const config = loadConfig();
  const aliases = Object.values(config.accounts).filter((a) =>
    [a.sshHost, ...a.sshHostAliases].some(
      (h) => h.toLowerCase() === endpoint.toLowerCase(),
    ),
  );
  const host = config.hosts[endpoint.toLowerCase()]
    ? endpoint.toLowerCase()
    : aliases[0]?.host;
  if (!host) throw new Error(`Unconfigured repository host: ${endpoint}`);
  const parts = pathname
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
    .split('/');
  if (
    parts.length !== 2 ||
    !parts.every(
      (p) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(p) && !p.includes('..'),
    )
  )
    throw new Error('Remote must identify one owner/repository.');
  const [org, repo] = parts;
  const identity = resolveIdentity(org, host, repo);
  const settings = config.hosts[host];
  if (
    protocol === 'ssh:' &&
    ((user && user !== settings.sshUser) ||
      (port && Number(port) !== settings.sshPort))
  )
    throw new Error(
      'Remote SSH user or port differs from the configured endpoint.',
    );
  if (
    aliases.length &&
    !aliases.some(
      (a) =>
        a.sshHost.toLowerCase() === endpoint.toLowerCase() ||
        a.sshHostAliases.some(
          (h) => h.toLowerCase() === endpoint.toLowerCase(),
        ),
    )
  )
    throw new Error('Unknown account alias.');
  if (
    !config.hosts[endpoint.toLowerCase()] &&
    aliases.length &&
    !aliases.some(
      (a) => a.host === identity.host && a.sshHost === identity.sshHost,
    )
  )
    throw new Error('Remote alias belongs to a different repository identity.');
  return { host, org, repo, identity, protocol, endpoint };
}

export function repositoryIdentity(cwd = process.cwd()) {
  const bound = readGit(
    ['config', '--local', '--get', 'source-workspace.identity'],
    cwd,
  );
  if (bound) return identityFor(bound);
  const values = readGit(
    ['config', '--get-regexp', '^remote\\..*\\.url$'],
    cwd,
  );
  if (!values)
    throw new Error(
      'No repository identity: bind an account with wt-identity.mjs bind {account}.',
    );
  const identities = values
    .split('\n')
    .map((line) => parseRemote(line.slice(line.indexOf(' ') + 1)).identity);
  const ids = [
    ...new Set(
      identities.map(
        (i) => `${i.sshKeyPath}:${i.gitUserName}:${i.gitUserEmail}`,
      ),
    ),
  ];
  if (ids.length !== 1)
    throw new Error(
      'Remotes select different identities; bind the repository explicitly with wt-identity.mjs bind {account}.',
    );
  return identities[0];
}
