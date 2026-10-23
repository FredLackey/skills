import fs from 'node:fs';
import { registrationTitle, verifyKeyPair } from './key-policy.mjs';
import { loadConfig } from './wt-config.mjs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hostConfig, identityFor } from './wt-config.mjs';

export function hostOperation(identity, operation, params = {}) {
  try {
    return JSON.parse(
      execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
        input: JSON.stringify({ account: identity.id, operation, params }),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000,
        maxBuffer: 64 * 1024 * 1024,
      }),
    );
  } catch (error) {
    throw new Error(
      error.stderr?.toString().trim() || 'Host operation failed.',
    );
  }
}

export function createHostClient(identity, request, policy) {
  const kind = identity.provider;
  const enc = encodeURIComponent;
  const coordinate = (p) => `${enc(p.owner)}/${enc(p.repo)}`;
  const list = async (route) => {
    const items = [];
    const seen = new Set();
    for (let page = 1, next = route; next; page++) {
      if (page > 10000 || seen.has(next))
        throw new Error('Invalid host pagination.');
      seen.add(next);
      const response = await request(next, 'GET');
      if (Array.isArray(response)) {
        items.push(...response);
        next =
          response.length === 100
            ? `${route}${route.includes('?') ? '&' : '?'}${kind === 'github' ? 'per_page' : 'limit'}=100&page=${page + 1}`
            : null;
      } else {
        items.push(...(response.values ?? []));
        next = response.next ?? null;
      }
    }
    return items;
  };
  const endpoints = {
    github: {
      user: 'user',
      owners: 'user/orgs?per_page=100',
      repos: (o) => `orgs/${enc(o)}/repos?per_page=100`,
      repo: (p) => `repos/${coordinate(p)}`,
      keys: (type) =>
        `user/${type === 'signing' ? 'ssh_signing_keys' : 'keys'}?per_page=100`,
    },
    forgejo: {
      user: 'user',
      owners: 'user/orgs?limit=100',
      repos: (o) => `orgs/${enc(o)}/repos?limit=100`,
      repo: (p) => `repos/${coordinate(p)}`,
      keys: () => 'user/keys?limit=100',
    },
    bitbucket: {
      user: 'user',
      owners: 'workspaces?pagelen=100',
      repos: (o) => `repositories/${enc(o)}?pagelen=100`,
      repo: (p) => `repositories/${coordinate(p)}`,
      keys: () => `users/${enc(identity.login)}/ssh-keys?pagelen=100`,
    },
  }[kind];
  if (!endpoints) throw new Error('Unconfigured API implementation.');
  const user = async () => {
    const value = await request(endpoints.user, 'GET');
    const login = value.login ?? value.username ?? value.nickname ?? value.uuid;
    if (
      ![
        login,
        value.login,
        value.username,
        value.nickname,
        value.uuid,
        value.account_id,
      ]
        .filter(Boolean)
        .some((v) => v.toLowerCase() === identity.login.toLowerCase())
    )
      throw new Error(
        'Credential identity does not match the selected account.',
      );
    return value;
  };
  const repository = (value) => ({
    name: value.slug ?? value.full_name?.split('/')[1] ?? value.name,
    full_name: value.full_name,
    owner: {
      login:
        value.owner?.login ??
        value.workspace?.slug ??
        value.full_name?.split('/')[0],
    },
  });
  return async (operation, p = {}) => {
    await user();
    if (operation === 'validate')
      return {
        valid: true,
        account: identity.id,
        capabilities: {
          signingKeys: kind === 'github',
          draftPulls: kind !== 'forgejo',
        },
      };
    if (operation === 'owners')
      return (await list(endpoints.owners)).map((o) => ({
        login: o.login ?? o.slug,
      }));
    if (operation === 'repositories')
      return (await list(endpoints.repos(p.owner))).map(repository);
    if (operation === 'repository')
      return repository(await request(endpoints.repo(p), 'GET'));
    if (operation === 'authored') {
      let commits;
      try {
        commits =
          kind === 'github'
            ? await request(
                `${endpoints.repo(p)}/commits?author=${enc(identity.login)}&per_page=1`,
                'GET',
              )
            : await list(
                `${endpoints.repo(p)}/commits?${kind === 'bitbucket' ? 'pagelen=100' : 'limit=100&stat=false&files=false&verification=false'}`,
              );
      } catch (error) {
        if (/HTTP 409/.test(error.message)) return false;
        throw error;
      }
      return commits.some(
        (c) =>
          [
            c.author?.login,
            c.author?.user?.nickname,
            c.author?.user?.uuid,
            c.author?.user?.account_id,
          ]
            .filter(Boolean)
            .some((v) => v.toLowerCase() === identity.login.toLowerCase()) ||
          (
            c.commit?.author?.email ?? c.author?.raw?.match(/<([^>]+)>/)?.[1]
          )?.toLowerCase() === identity.gitUserEmail.toLowerCase(),
      );
    }
    if (operation === 'keys' || operation === 'addKey') {
      if (!['authentication', 'signing'].includes(p.type))
        throw new Error('Invalid key registration type.');
      if (p.type === 'signing' && kind !== 'github')
        return { supported: false };
      if (operation === 'keys')
        return { supported: true, keys: await list(endpoints.keys(p.type)) };
      if (
        !policy?.machineName ||
        p.title !== registrationTitle(policy.machineName)
      )
        throw new Error(
          'Registration title must use the proper machine name and actual addition date.',
        );
      if (p.key !== policy.expectedKey)
        throw new Error(
          'Registration key differs from the configured identity key.',
        );
      const route = endpoints.keys(p.type).split('?')[0];
      const body = {
        key: p.key,
        [kind === 'bitbucket' ? 'label' : 'title']: p.title,
      };
      return { supported: true, key: await request(route, 'POST', body) };
    }
    if (operation === 'pulls') {
      const values = await list(
        `${endpoints.repo(p)}/${kind === 'bitbucket' ? 'pullrequests?state=OPEN&pagelen=100' : 'pulls?state=open&' + (kind === 'github' ? 'per_page' : 'limit') + '=100'}`,
      );
      return values.map((v) => ({
        url: v.html_url ?? v.links?.html?.href,
        head: v.head?.ref ?? v.source?.branch?.name,
        base: v.base?.ref ?? v.destination?.branch?.name,
        repository: v.head?.repo?.full_name ?? v.source?.repository?.full_name,
      }));
    }
    if (operation === 'createPull') {
      const body =
        kind === 'bitbucket'
          ? {
              title: p.title,
              description: p.body,
              source: { branch: { name: p.head } },
              destination: { branch: { name: p.base } },
              draft: p.draft,
            }
          : {
              title:
                kind === 'forgejo' && p.draft ? `[WIP] ${p.title}` : p.title,
              body: p.body,
              head: p.head,
              base: p.base,
              ...(kind === 'github' ? { draft: p.draft } : {}),
            };
      const value = await request(
        `${endpoints.repo(p)}/${kind === 'bitbucket' ? 'pullrequests' : 'pulls'}`,
        'POST',
        body,
      );
      return { url: value.html_url ?? value.links?.html?.href };
    }
    throw new Error(`Unknown host operation: ${operation}`);
  };
}

async function worker() {
  const { account, operation, params } = JSON.parse(fs.readFileSync(0, 'utf8'));
  const identity = identityFor(account);
  const settings = hostConfig(identity.host);
  if (!identity.tokenFile)
    throw new Error(
      'Configure a private account credential file before API operations.',
    );
  const file = identity.tokenFile.startsWith('~/')
    ? path.join(os.homedir(), identity.tokenFile.slice(2))
    : identity.tokenFile;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.mode & 0o077)
    throw new Error('Credential file must be a regular file with mode 0600.');
  const credential = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    credential.host !== identity.host ||
    credential.login !== identity.login ||
    !credential.token
  )
    throw new Error('Credential host/account mismatch.');
  const base = new URL(settings.apiBase);
  const authorization = credential.authUsername
    ? `Basic ${Buffer.from(`${credential.authUsername}:${credential.token}`).toString('base64')}`
    : `${settings.provider === 'forgejo' ? 'token' : 'Bearer'} ${credential.token}`;
  const request = async (route, method, body) => {
    const url = new URL(route, base);
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(base.pathname) ||
      url.username ||
      url.password
    )
      throw new Error('API pagination escaped the configured endpoint.');
    const response = await fetch(url, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(`Host operation returned HTTP ${response.status}.`);
    return response.status === 204 ? null : response.json();
  };
  const policy = { ...loadConfig() };
  if (operation === 'addKey') {
    const privatePath = verifyKeyPair(identity.sshKeyPath);
    policy.expectedKey = fs
      .readFileSync(privatePath + '.pub', 'utf8')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(' ');
  }
  console.log(
    JSON.stringify(
      await createHostClient(identity, request, policy)(operation, params),
    ),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  try {
    await worker();
  } catch {
    console.error(
      'Host operation failed; check endpoint, account credential, permissions, and host capabilities.',
    );
    process.exitCode = 1;
  }
}
