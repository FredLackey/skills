// A synchronous adapter keeps the existing workspace CLI contract. The worker
// reads credentials itself: tokens never appear in command arguments or logs.
//
// Each Forgejo host's credential file (hosts.{host}.tokenFile in the workspace
// configuration, default ~/.config/forgejo/{host}.json, mode 0600) contains
// { "host": "...", "username": "...", "token": "..." } for one account.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hostConfig, listIdentities } from './wt-config.mjs';

export function forgejoApi(host, route, method = 'GET', body, login) {
  try {
    return JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
      input: JSON.stringify({ host, route, method, body, login }), encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 45000, maxBuffer: 16 * 1024 * 1024,
    }));
  } catch (error) {
    throw new Error(error.stderr?.toString().trim() || 'Forgejo API request failed.');
  }
}

export function verifyForgejoIdentity(identity, api = forgejoApi) {
  const user = api(identity.host, 'user', 'GET', undefined, identity.login);
  if (user.login?.toLowerCase() !== identity.login.toLowerCase()) {
    throw new Error(`Forgejo credential identity mismatch for ${identity.host}.`);
  }
  return { provider: 'forgejo', host: identity.host };
}

function expandHome(value) {
  return value === '~' ? os.homedir() : value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

async function worker() {
  const { host, route, method, body, login } = JSON.parse(fs.readFileSync(0, 'utf8'));
  const settings = hostConfig(host);
  if (settings.provider !== 'forgejo') throw new Error(`Not a configured Forgejo host: ${host}.`);
  if (typeof route !== 'string' || route.startsWith('/') || route.includes('..') || route.includes('://')) {
    throw new Error('Invalid Forgejo API route.');
  }
  if (!listIdentities(settings.host).some(identity => identity.login.toLowerCase() === String(login).toLowerCase())) {
    throw new Error(`No configured account ${login} on ${settings.host}.`);
  }
  const file = path.resolve(expandHome(settings.tokenFile));
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || (stat.mode & 0o077)) throw new Error(`Credential file must be a regular file with mode 0600: ${file}`);
  const credential = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (credential.host !== settings.host || credential.username?.toLowerCase() !== String(login).toLowerCase() || !credential.token) {
    throw new Error('Forgejo credential host/account mismatch.');
  }
  const response = await fetch(`https://${settings.host}/api/v1/${route}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `token ${credential.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Forgejo ${method} ${route}: HTTP ${response.status}`);
  console.log(JSON.stringify(response.status === 204 ? null : await response.json()));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await worker(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
