#!/usr/bin/env node
// Discover locally authenticated github.com accounts, their organizations,
// and repositories with commits authored by each profile. SSH/signing routing is
// centralized in wt-config.mjs. Existing primary clones are left untouched.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { identities, resolveIdentity } from './lib/wt-config.mjs';
import {
  assertSafeSegment, configureRepositoryIdentity, ensureDirSync, git, isDirectory,
  repoPath, runCmd, SOURCE_ROOT,
} from './lib/wt-lib.mjs';

export function usage() {
  return `Usage: clone-mine.mjs [--org {name}] [--user {login}] [--dry-run]

Discover all locally logged-in github.com profiles and their organizations.
Clone matching repos into ${SOURCE_ROOT}/repos/{org}/{repo} using routed SSH keys
and signed-commit settings. Existing clones are skipped without fetching.

Matches: at least one commit authored by the profile, using one filtered
commits request per repository (GitHub's default history). No branch scans.
Dry-run stdout is a bulleted org/repo list; progress goes to stderr.

Options:
  --org {name}    Restrict discovery to one organization (optional).
  --user {login}  Restrict discovery to one local account (optional).
  --dry-run      Show matches without cloning or writing Git configuration.
  -h, --help     Show this help.

New profiles need SSH/signing settings and org routing in lib/wt-config.mjs.
Organization discovery requires a classic/OAuth token with read:org or user
scope; fine-grained tokens cannot enumerate memberships through user/orgs.
Enterprise hosts are outside this github.com directory/routing scheme.`;
}

export function parseArgs(argv) {
  const options = { org: null, user: null, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '-h' || arg === '--help') options.help = true;
    else if (/^--(org|user)(=|$)/.test(arg)) {
      const key = arg.slice(2).split('=')[0];
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[++i];
      if (!value || value.startsWith('-') || options[key]) {
        throw new Error(`Supply --${key} once with a non-empty value.`);
      }
      assertSafeSegment(value, key);
      if (!/^[a-z\d-]+$/i.test(value)) throw new Error(`Invalid ${key}: ${value}`);
      options[key] = value;
    } else throw new Error(`Unexpected argument: ${arg}`);
  }
  return options;
}

// Environment credentials must not override the selected stored profile.
export function cleanAuthEnv() {
  const env = { ...process.env };
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN',
    'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_DEBUG']) delete env[name];
  env.GH_PROMPT_DISABLED = '1';
  return env;
}
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

export function discoverAccounts(run = runCmd) {
  const result = JSON.parse(run('gh', ['auth', 'status', '--hostname', 'github.com',
    '--json', 'hosts'], { env: cleanAuthEnv() }));
  const accounts = result.hosts?.['github.com'] ?? [];
  return accounts.filter((a, i) => a.login &&
    accounts.findIndex(b => same(a.login, b.login)) === i);
}

export function apiForAccount(login, run = runCmd) {
  const env = cleanAuthEnv();
  let token;
  try {
    token = run('gh', ['auth', 'token', '--hostname', 'github.com', '--user', login], { env });
  } catch {
    // Never forward output of token commands to logs.
    throw new Error(`Cannot obtain stored token for ${login}; check gh auth status.`);
  }
  if (!token) throw new Error(`No stored token for ${login}.`);
  if (token.startsWith('github_pat_')) {
    throw new Error(`${login}: organization discovery requires a classic/OAuth token; fine-grained tokens return no memberships.`);
  }
  const api = (endpoint, { paginate = false } = {}) => {
    const args = ['api', '--hostname', 'github.com', endpoint];
    if (paginate) args.push('--paginate', '--slurp');
    try {
      const value = JSON.parse(run('gh', args, { env: { ...env, GH_TOKEN: token }, maxBuffer: 64 * 1024 * 1024 }));
      return paginate ? value.flat() : value;
    } catch (error) {
      throw new Error(error.message.split(token).join('[REDACTED]'));
    }
  };
  const actual = api('user').login;
  if (!same(actual, login)) throw new Error(`Token identity mismatch: expected ${login}, received ${actual}.`);
  return api;
}

export function canScanOrg(org, login) {
  // Defense in depth: refuse before any organization/repository API call
  // unless the configured route assigns this organization to the account.
  return same(resolveIdentity(org).ghUser, login);
}

export function contributionReason(org, repo, login, api) {
  const endpoint = `repos/${org}/${repo.name}/commits?author=${encodeURIComponent(login)}&per_page=1`;
  try {
    return api(endpoint).length ? 'authored commit' : null;
  } catch (error) {
    // GitHub returns 409 for an empty repository, not an authorship failure.
    if (/HTTP 409/.test(error.message) && /Git Repository is empty/i.test(error.message)) return null;
    throw error;
  }
}

/** Clones + configures one repo exactly like wt-create.mjs does. Returns a status string. */
function cloneRepo(org, repo, identity) {
  const repoDir = repoPath(org, repo);

  if (isDirectory(repoDir)) {
    return `SKIP (exists) ${repo}`;
  }

  const cloneUrl = `git@${identity.sshHost}:${org}/${repo}.git`;
  ensureDirSync(path.dirname(repoDir));

  try {
    git(['clone', cloneUrl, repoDir]);
  } catch (err) {
    return `FAIL  ${repo}\n       ${err.message.split('\n').join('\n       ')}`;
  }

  // Local config only — applies to every worktree of this repo (worktrees
  // share the primary clone's .git config). Mirrors wt-create.mjs.
  try {
    configureRepositoryIdentity(repoDir, identity);
  } catch (err) {
    return `WARN  ${repo} (cloned but failed to configure git identity)\n       ${err.message}`;
  }

  return `OK    ${repo}`;
}

export function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  const log = deps.log ?? (options.dryRun ? console.error : console.log);
  const output = deps.output ?? console.log;
  const warn = deps.warn ?? console.warn;
  const run = deps.run ?? runCmd;
  if (options.help) { log(usage()); return 0; }
  let accounts = discoverAccounts(run);
  if (options.user) accounts = accounts.filter(a => same(a.login, options.user));
  if (!accounts.length) throw new Error('No matching locally authenticated github.com profiles. Check gh auth status.');
  log(`Discovered ${accounts.length} local GitHub profile(s): ${accounts.map(a => a.login).join(', ')}`);
  const totals = { matched: 0, cloned: 0, skipped: 0, planned: 0, failed: 0 };
  let orgFound = false;
  for (const account of accounts) {
    const login = account.login;
    try {
      if (account.state !== 'success') throw new Error(`Authentication is unhealthy for ${login}. Check gh auth status.`);
      const identity = Object.values(identities).find(i => same(i.ghUser, login));
      if (!identity || ['sshHost', 'sshKeyPath', 'gitUserName', 'gitUserEmail'].some(key => !identity[key])) {
        throw new Error(`Configure SSH/signing identity for ${login} in lib/wt-config.mjs.`);
      }
      const api = apiForAccount(login, run);
      const orgs = api('user/orgs?per_page=100', { paginate: true });
      log(`${login}: ${orgs.length} organization(s).`);
      for (const { login: org } of orgs) {
        if (options.org && !same(org, options.org)) continue;
        if (!canScanOrg(org, login)) {
          log(`SKIP  ${org} as ${login} (routed to ${resolveIdentity(org).ghUser}).`);
          continue;
        }
        orgFound = true;
        try {
          assertSafeSegment(org, 'org');
          log(`Scanning ${org} as ${login} ...`);
          const repos = api(`orgs/${org}/repos?per_page=100&type=all`, { paginate: true });
          if (!repos.length) continue;
          for (const repo of repos) {
            try {
              assertSafeSegment(repo.name, 'repo');
              if (!same(repo.owner?.login, org)) throw new Error(`Unexpected owner for ${repo.name}.`);
              const reason = contributionReason(org, repo, login, api);
              if (!reason) continue;
              totals.matched++;
              if (!options.dryRun) log(`MATCH ${org}/${repo.name} (${reason})`);
              if (options.dryRun) {
                const exists = (deps.isDirectory ?? isDirectory)(repoPath(org, repo.name));
                totals[exists ? 'skipped' : 'planned']++;
                output(`- ${org}/${repo.name}`);
              } else {
                const status = (deps.cloneRepo ?? cloneRepo)(org, repo.name, resolveIdentity(org));
                log(`  ${status}`);
                totals[status.startsWith('OK') ? 'cloned' : status.startsWith('SKIP') ? 'skipped' : 'failed']++;
              }
            } catch (error) {
              totals.failed++;
              warn(`FAIL  ${org}/${repo.name}: ${error.message}`);
            }
          }
        } catch (error) { totals.failed++; warn(`FAIL  ${org}: ${error.message}`); }
      }
    } catch (error) { totals.failed++; warn(`FAIL  ${login}: ${error.message}`); }
  }
  if (options.org && !orgFound) {
    totals.failed++;
    warn(`No eligible membership found for ${options.org} under its routed account.`);
  }
  log(`Done: ${totals.matched} matched, ${totals.cloned} cloned, ${totals.planned} would clone, ${totals.skipped} already present, ${totals.failed} failed.`);
  return totals.failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`Error: ${error.message}`); process.exitCode = 1; }
}
