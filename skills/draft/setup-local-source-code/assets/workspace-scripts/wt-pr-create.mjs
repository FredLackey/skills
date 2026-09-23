#!/usr/bin/env node
// Create GitHub pull requests for every repo worktree in one ticket folder.
// No fetch is performed: after a full local preflight, only the ticket branch
// in each repo is pushed. PR bodies always come from explicit files.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveIdentity } from './lib/wt-config.mjs';
import {
  assertSafeSegment,
  assertNoCaseCollisions,
  getPrimaryRepoDirFromWorktree,
  git,
  listTicketFolders,
  REPOS_ROOT,
  runCmd,
  ticketPath,
} from './lib/wt-lib.mjs';

export function usage() {
  return `Usage:
  wt-pr-create.mjs {client} {ticket} {base-branch} --body-file {path} [options]
  wt-pr-create.mjs {client} {ticket} {base-branch} \\
    --body-file-for {repo}={path} [--body-file-for {repo}={path} ...] [options]

Pushes the ticket branch and creates a pull request for every repo worktree
under the configured trees/{client}/{ticket} directory. The PR title is taken
from the first commit and each PR body is read from a file.

Body options:
  --body-file {path}             Body used for every repo.
  --body-file-for {repo}={path}  Body override for one repo; repeat as needed.
                                  A shared body and overrides may be combined.

Other options:
  --draft     Create new pull requests as drafts.
  --dry-run   Validate and show the plan without authentication, pushes, or PRs.
  -h, --help  Show this help.

The current branch in every repo must equal {ticket}, every worktree must be
clean, and origin must use the SSH host routed for its GitHub organization.
Existing open PRs for the same head/base pair are reported rather than duplicated.
This command never fetches or merges pull requests.`;
}

function takeValue(argv, index, option) {
  const arg = argv[index];
  if (arg.startsWith(`${option}=`)) {
    const value = arg.slice(option.length + 1);
    if (!value) throw new Error(`${option} requires a non-empty value.`);
    return { value, consumed: 0 };
  }
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a non-empty value.`);
  return { value, consumed: 1 };
}

export function parseArgs(argv) {
  const options = {
    client: null,
    ticket: null,
    base: null,
    bodyFile: null,
    bodyFilesFor: [],
    draft: false,
    dryRun: false,
    help: false,
  };
  const positionals = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg === '--draft') options.draft = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--body-file' || arg.startsWith('--body-file=')) {
      const { value, consumed } = takeValue(argv, i, '--body-file');
      if (options.bodyFile) throw new Error('--body-file may only be supplied once.');
      options.bodyFile = value;
      i += consumed;
    } else if (arg === '--body-file-for' || arg.startsWith('--body-file-for=')) {
      const { value, consumed } = takeValue(argv, i, '--body-file-for');
      const separator = value.indexOf('=');
      if (separator < 1 || separator === value.length - 1) {
        throw new Error('--body-file-for must be in the form {repo}={path}.');
      }
      const repo = value.slice(0, separator);
      const file = value.slice(separator + 1);
      assertSafeSegment(repo, 'repo in --body-file-for');
      if (options.bodyFilesFor.some((entry) => entry.repo === repo)) {
        throw new Error(`--body-file-for was supplied more than once for ${repo}.`);
      }
      options.bodyFilesFor.push({ repo, file });
      i += consumed;
    } else if (arg.startsWith('-')) throw new Error(`Unexpected option: ${arg}`);
    else positionals.push(arg);
  }

  if (options.help) return options;
  if (positionals.length !== 3) throw new Error('Supply {client}, {ticket}, and {base-branch}.');
  [options.client, options.ticket, options.base] = positionals;
  assertSafeSegment(options.client, 'client');
  assertSafeSegment(options.ticket, 'ticket');
  if (!options.base || options.base.startsWith('-') || /[\s~^:?*[\\]/.test(options.base)) {
    throw new Error(`Invalid base branch: ${JSON.stringify(options.base)}.`);
  }
  if (!options.bodyFile && options.bodyFilesFor.length === 0) {
    throw new Error('Supply --body-file or one or more --body-file-for mappings.');
  }
  return options;
}

export function parseGitHubRemote(remoteUrl) {
  let host;
  let pathname;
  let transport;
  const scp = remoteUrl.match(/^[^@\s]+@([^:\s]+):(.+)$/);
  if (scp) {
    [, host, pathname] = scp;
    transport = 'ssh';
  } else {
    let parsed;
    try { parsed = new URL(remoteUrl); }
    catch { throw new Error(`Unsupported origin URL: ${remoteUrl}`); }
    if (parsed.protocol !== 'ssh:') throw new Error(`Origin must use SSH, not ${parsed.protocol || 'an unknown protocol'}: ${remoteUrl}`);
    host = parsed.hostname;
    pathname = parsed.pathname.replace(/^\//, '');
    transport = 'ssh';
  }

  const parts = pathname.replace(/\/$/, '').replace(/\.git$/, '').split('/');
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error(`Origin must identify one GitHub org/repo: ${remoteUrl}`);
  }
  return { transport, host, org: parts[0], repo: parts[1] };
}

export function resolveBodyFiles(repos, options, cwd = process.cwd()) {
  const repoNames = new Set(repos.map((repo) => repo.repo));
  for (const { repo } of options.bodyFilesFor) {
    if (!repoNames.has(repo)) throw new Error(`Body mapping names repo "${repo}", which is not in this ticket.`);
  }

  const overrides = new Map(options.bodyFilesFor.map(({ repo, file }) => [repo, file]));
  const resolved = new Map();
  const missing = [];
  for (const repo of repos) {
    const supplied = overrides.get(repo.repo) ?? options.bodyFile;
    if (!supplied) {
      missing.push(repo.repo);
      continue;
    }
    const absolute = path.resolve(cwd, supplied);
    let stat;
    try { stat = fs.statSync(absolute); }
    catch { throw new Error(`PR body file does not exist: ${absolute}`); }
    if (!stat.isFile()) throw new Error(`PR body path is not a file: ${absolute}`);
    if (!fs.readFileSync(absolute, 'utf8').trim()) throw new Error(`PR body file is empty: ${absolute}`);
    resolved.set(repo.repo, absolute);
  }
  if (missing.length) throw new Error(`No PR body file supplied for: ${missing.join(', ')}.`);
  return resolved;
}

export function cleanAuthEnv() {
  const env = { ...process.env };
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN',
    'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_DEBUG']) delete env[name];
  env.GH_PROMPT_DISABLED = '1';
  return env;
}

function same(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function preflightRepo(repoEntry, ticket, bodyFile, deps = {}) {
  const gitFn = deps.git ?? git;
  const cwd = repoEntry.path;
  if (gitFn(['rev-parse', '--is-inside-work-tree'], { cwd }) !== 'true') {
    throw new Error(`${cwd} is not a git worktree.`);
  }
  const branch = gitFn(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  if (branch !== ticket) {
    throw new Error(`${repoEntry.repo} is on branch "${branch}", expected ticket branch "${ticket}".`);
  }
  const status = gitFn(['status', '--porcelain'], { cwd });
  if (status) throw new Error(`${repoEntry.repo} has uncommitted changes; commit them before creating PRs.`);

  const remoteUrl = gitFn(['remote', 'get-url', 'origin'], { cwd });
  const remote = parseGitHubRemote(remoteUrl);
  if (!same(remote.repo, repoEntry.repo)) {
    throw new Error(`${repoEntry.repo} has an origin for a different repo: ${remote.org}/${remote.repo}.`);
  }
  const primaryDir = (deps.getPrimaryRepoDirFromWorktree ?? getPrimaryRepoDirFromWorktree)(cwd);
  if (!primaryDir) throw new Error(`Could not resolve the primary clone for ${repoEntry.repo}.`);
  const reposRoot = path.resolve(deps.reposRoot ?? REPOS_ROOT);
  const relativePrimary = path.relative(reposRoot, path.resolve(primaryDir));
  const primaryParts = relativePrimary.split(path.sep);
  if (path.isAbsolute(relativePrimary) || primaryParts.length !== 2 || primaryParts.includes('..') ||
      !same(primaryParts[0], remote.org) || !same(primaryParts[1], remote.repo)) {
    throw new Error(
      `${repoEntry.repo} origin ${remote.org}/${remote.repo} does not match its primary clone under ${reposRoot}.`
    );
  }
  const identity = resolveIdentity(remote.org);
  if (!same(remote.host, identity.sshHost)) {
    throw new Error(
      `${remote.org}/${remote.repo} origin uses host "${remote.host}"; expected routed SSH host "${identity.sshHost}".`
    );
  }
  return { ...repoEntry, ...remote, branch, bodyFile, identity };
}

function verifiedAuth(identity, run = runCmd) {
  const baseEnv = cleanAuthEnv();
  let token;
  try {
    token = run('gh', ['auth', 'token', '--hostname', 'github.com', '--user', identity.ghUser], { env: baseEnv });
  } catch {
    throw new Error(`Cannot obtain the stored GitHub token for ${identity.ghUser}; check gh auth status.`);
  }
  if (!token) throw new Error(`No stored GitHub token found for ${identity.ghUser}.`);
  const env = { ...baseEnv, GH_TOKEN: token };
  let actual;
  try { actual = run('gh', ['api', 'user', '--jq', '.login'], { env }); }
  catch (error) { throw new Error(error.message.split(token).join('[REDACTED]')); }
  if (!same(actual, identity.ghUser)) {
    throw new Error(`GitHub token identity mismatch: expected ${identity.ghUser}, received ${actual}.`);
  }
  return { env, token };
}

function runGh(args, repo, auth, run = runCmd) {
  try { return run('gh', args, { cwd: repo.path, env: auth.env }); }
  catch (error) { throw new Error(error.message.split(auth.token).join('[REDACTED]')); }
}

export function publishRepo(repo, options, auth, deps = {}) {
  const gitFn = deps.git ?? git;
  const run = deps.run ?? runCmd;
  gitFn(['push', '--set-upstream', 'origin', `${repo.branch}:${repo.branch}`], { cwd: repo.path });

  const selector = `${repo.org}/${repo.repo}`;
  const existingJson = runGh([
    'api', '--method', 'GET', `repos/${selector}/pulls`,
    '-f', 'state=open', '-f', `head=${repo.org}:${repo.branch}`, '-f', `base=${options.base}`,
  ], repo, auth, run);
  const existing = JSON.parse(existingJson).find((pull) =>
    same(pull.head?.repo?.full_name, selector) && pull.head?.ref === repo.branch && pull.base?.ref === options.base);
  if (existing) return { url: existing.html_url, created: false };

  const args = [
    'pr', 'create', '--repo', selector, '--base', options.base, '--head', repo.branch,
    '--fill-first', '--body-file', repo.bodyFile,
  ];
  if (options.draft) args.push('--draft');
  const output = runGh(args, repo, auth, run);
  const url = output.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)?.[0];
  if (!url) throw new Error(`GitHub created a PR but did not return a recognizable URL. Output: ${output}`);
  return { url, created: true };
}

export function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  const log = deps.log ?? console.log;
  const warn = deps.warn ?? console.error;
  if (options.help) { log(usage()); return 0; }

  try { (deps.git ?? git)(['check-ref-format', '--branch', options.base], {}); }
  catch { throw new Error(`Invalid base branch: ${JSON.stringify(options.base)}.`); }

  assertNoCaseCollisions();
  const tickets = (deps.listTicketFolders ?? listTicketFolders)();
  const matches = tickets.filter(entry => same(entry.client, options.client) && same(entry.ticket, options.ticket));
  if (matches.length > 1) throw new Error(`Ambiguous ticket: ${matches.map(entry => entry.path).join(', ')}`);
  const ticket = matches[0];
  if (ticket && ticket.ticket !== options.ticket) throw new Error(`Use exact ticket/branch case: ${ticket.ticket}`);
  if (!ticket) throw new Error(`No ticket folder found at ${ticketPath(options.client, options.ticket)}.`);
  if (!ticket.repos.length) throw new Error(`No repo worktrees found under ${ticket.path}.`);

  const bodies = resolveBodyFiles(ticket.repos, options, deps.cwd ?? process.cwd());
  // Complete every local check before performing authentication or any remote mutation.
  const repos = ticket.repos.map((repo) =>
    preflightRepo(repo, options.ticket, bodies.get(repo.repo), deps));

  const keys = repos.map(repo => `${repo.org}/${repo.repo}`.toLowerCase());
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate repository identity in ticket.');

  if (options.dryRun) {
    log(`Validated ${repos.length} repo worktree(s); no fetch, push, or PR creation performed.`);
    for (const repo of repos) {
      log(`- ${repo.org}/${repo.repo}: ${repo.branch} -> ${options.base} (body: ${repo.bodyFile})${options.draft ? ' [draft]' : ''}`);
    }
    return 0;
  }

  const authByUser = new Map();
  for (const repo of repos) {
    if (!authByUser.has(repo.identity.ghUser)) {
      authByUser.set(repo.identity.ghUser, (deps.verifiedAuth ?? verifiedAuth)(repo.identity, deps.run ?? runCmd));
    }
  }

  const links = [];
  let failed = 0;
  for (const repo of repos) {
    try {
      const result = (deps.publishRepo ?? publishRepo)(
        repo, options, authByUser.get(repo.identity.ghUser), deps);
      links.push({ repo: `${repo.org}/${repo.repo}`, ...result });
      log(`${result.created ? 'CREATED' : 'EXISTS '} ${repo.org}/${repo.repo}: ${result.url}`);
    } catch (error) {
      failed++;
      warn(`FAILED  ${repo.org}/${repo.repo}: ${error.message}`);
    }
  }

  if (links.length) {
    log('Pull requests:');
    for (const link of links) log(`- ${link.repo}: ${link.url}`);
  }
  log(`Done: ${links.filter((link) => link.created).length} created, ${links.filter((link) => !link.created).length} existing, ${failed} failed.`);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`Error: ${error.message}\n\n${usage()}`); process.exitCode = 1; }
}
