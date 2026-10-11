#!/usr/bin/env node
// Clone every repository in every organization routed to a configured GitHub
// profile. Repository selection uses organization membership and repository
// listings only; it does not inspect commits, branches, or repository contents.
//
// This deliberately ignores authorship. Run it only when the user explicitly
// asks to include repositories they never committed to; otherwise use
// clone-mine.mjs.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_HOST, findIdentity, listIdentities } from './lib/wt-config.mjs';
import { assertWorkstationReady, describeDrift, effectiveDrift } from './lib/wt-signing.mjs';
import {
  assertSafeSegment, cloneUrl, ensureDirSync, git, isDirectory,
  repoPath, runCmd, SOURCE_ROOT, withWorkspaceLock,
} from './lib/wt-lib.mjs';

export function usage() {
  return `Usage: clone-all.mjs [--profile {name}] [--dry-run]

Clone every repository in every organization routed to a configured GitHub
account into ${SOURCE_ROOT}/repos/{org}/{repo}, whether or not you ever
committed to it. Use only when explicitly asked to include such repositories;
clone-mine.mjs is the normal, authorship-filtered command. Organizations without
a route are skipped. Existing clones are skipped without fetching.

Options:
  --profile {name}  Restrict discovery to one configured GitHub account id
                    from the workspace configuration (optional).
  --dry-run         List repositories without cloning or writing Git config.
  -h, --help        Show this help.

Repository discovery uses organization membership and repository-listing API
requests only. It does not inspect commit history, branches, languages, forks,
archive status, or repository contents.`;
}

export function parseArgs(argv) {
  const options = { profile: null, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      if (options.dryRun) throw new Error('Supply --dry-run at most once.');
      options.dryRun = true;
    } else if (arg === '-h' || arg === '--help') {
      if (options.help) throw new Error('Supply --help at most once.');
      options.help = true;
    } else if (/^--profile(=|$)/.test(arg)) {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[++i];
      if (!value || value.startsWith('-') || options.profile) {
        throw new Error('Supply --profile once with a non-empty value.');
      }
      assertSafeSegment(value, 'profile');
      if (!/^[a-z\d-]+$/i.test(value)) throw new Error(`Invalid profile: ${value}`);
      options.profile = value;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
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
  return accounts.filter((account, index) => account.login &&
    accounts.findIndex(candidate => same(account.login, candidate.login)) === index);
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
      const value = JSON.parse(run('gh', args, {
        env: { ...env, GH_TOKEN: token },
        maxBuffer: 64 * 1024 * 1024,
      }));
      return paginate ? value.flat() : value;
    } catch (error) {
      throw new Error(error.message.split(token).join('[REDACTED]'));
    }
  };
  const actual = api('user').login;
  if (!same(actual, login)) {
    throw new Error(`Token identity mismatch: expected ${login}, received ${actual}.`);
  }
  return api;
}

function githubProfiles() {
  return listIdentities(DEFAULT_HOST).map(identity => [identity.id, identity]);
}

function configuredProfile(name) {
  const entry = githubProfiles().find(([profile]) => same(profile, name));
  if (!entry) {
    throw new Error(`Unknown profile ${name}. Configured GitHub accounts: ${githubProfiles().map(([id]) => id).join(', ')}.`);
  }
  return entry;
}

/** Clones and configures one primary repository. Returns a status string. */
export function cloneRepo(org, repo, identity) {
  return withWorkspaceLock(() => cloneRepoUnlocked(org, repo, identity));
}

function cloneRepoUnlocked(org, repo, identity) {
  const repoDir = repoPath(org, repo);
  if (isDirectory(repoDir)) return `SKIP (exists) ${repo}`;

  ensureDirSync(path.dirname(repoDir));
  try {
    git(['clone', cloneUrl(org, repo, identity), repoDir]);
  } catch (error) {
    return `FAIL  ${repo}\n       ${error.message.split('\n').join('\n       ')}`;
  }

  // Identity and signing come from the workstation configuration.
  const drift = effectiveDrift(repoDir, identity);
  if (drift.length) return `WARN  ${repo} (cloned, but identity does not match ${identity.id}: ${describeDrift(drift)})`;
  return `OK    ${repo}`;
}

export function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  const log = deps.log ?? (options.dryRun ? console.error : console.log);
  const output = deps.output ?? console.log;
  const warn = deps.warn ?? console.warn;
  const run = deps.run ?? runCmd;
  if (options.help) {
    log(usage());
    return 0;
  }

  const selectedProfiles = options.profile
    ? [configuredProfile(options.profile)]
    : githubProfiles();
  if (!options.dryRun && !deps.cloneRepo) assertWorkstationReady();
  const accounts = discoverAccounts(run);
  const profiles = selectedProfiles.map(([name, identity]) => ({
    name,
    identity,
    account: accounts.find(account => same(account.login, identity.ghUser)),
  })).filter(({ account }) => account);

  if (!profiles.length) {
    const qualifier = options.profile ? ` for profile ${options.profile}` : '';
    throw new Error(`No matching locally authenticated github.com account${qualifier}. Check gh auth status.`);
  }

  log(`Using ${profiles.length} configured GitHub profile(s): ${profiles.map(({ name }) => name).join(', ')}`);
  const totals = { found: 0, cloned: 0, skipped: 0, planned: 0, failed: 0 };

  for (const { name, identity, account } of profiles) {
    const login = account.login;
    try {
      if (account.state !== 'success') {
        throw new Error(`Authentication is unhealthy for ${login}. Check gh auth status.`);
      }
      const api = apiForAccount(login, run);
      const orgs = api('user/orgs?per_page=100', { paginate: true });
      const routedOrgs = orgs.filter(({ login: org }) => {
        const routed = findIdentity(org, DEFAULT_HOST);
        if (!routed) log(`SKIP  ${org} (not routed; add with: wt-route.mjs add ${org} ${name}).`);
        return routed && same(routed.ghUser, login);
      });
      log(`${name} (${login}): ${routedOrgs.length} routed organization(s).`);

      for (const { login: org } of routedOrgs) {
        try {
          assertSafeSegment(org, 'org');
          log(`Listing ${org} as ${login} ...`);
          const repos = api(`orgs/${org}/repos?per_page=100&type=all`, { paginate: true });
          for (const repo of repos) {
            try {
              assertSafeSegment(repo.name, 'repo');
              if (!same(repo.owner?.login, org)) throw new Error(`Unexpected owner for ${repo.name}.`);
              totals.found++;
              if (options.dryRun) {
                const exists = (deps.isDirectory ?? isDirectory)(repoPath(org, repo.name));
                totals[exists ? 'skipped' : 'planned']++;
                output(`- ${org}/${repo.name}`);
              } else {
                const status = (deps.cloneRepo ?? cloneRepo)(org, repo.name, identity);
                log(`  ${status}`);
                totals[status.startsWith('OK') ? 'cloned' : status.startsWith('SKIP') ? 'skipped' : 'failed']++;
              }
            } catch (error) {
              totals.failed++;
              warn(`FAIL  ${org}/${repo.name}: ${error.message}`);
            }
          }
        } catch (error) {
          totals.failed++;
          warn(`FAIL  ${org}: ${error.message}`);
        }
      }
    } catch (error) {
      totals.failed++;
      warn(`FAIL  ${name} (${login}): ${error.message}`);
    }
  }

  log(`Done: ${totals.found} found, ${totals.cloned} cloned, ${totals.planned} would clone, ${totals.skipped} already present, ${totals.failed} failed.`);
  return totals.failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
