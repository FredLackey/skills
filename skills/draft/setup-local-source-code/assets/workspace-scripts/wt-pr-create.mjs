#!/usr/bin/env node
// Create pull requests for every repo worktree in one ticket folder.
// No fetch is performed: after a full local preflight, only the ticket branch
// in each repo is pushed. PR bodies always come from explicit files.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveIdentity } from './lib/wt-config.mjs';
import { hostOperation } from './lib/host-api.mjs';
import { parseRemote } from './lib/repository-policy.mjs';
import {
  assertSafeSegment,
  assertNoCaseCollisions,
  getPrimaryRepoDirFromWorktree,
  git,
  listTicketFolders,
  originMatches,
  REPOS_ROOT,
  resolvePrimaryPath,
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
clean, and origin must use the SSH host (or a configured alias) of the account
routed to its owner. Every host uses the same account and repository policy.
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
  if (!value || value.startsWith('--'))
    throw new Error(`${option} requires a non-empty value.`);
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
      if (options.bodyFile)
        throw new Error('--body-file may only be supplied once.');
      options.bodyFile = value;
      i += consumed;
    } else if (
      arg === '--body-file-for' ||
      arg.startsWith('--body-file-for=')
    ) {
      const { value, consumed } = takeValue(argv, i, '--body-file-for');
      const separator = value.indexOf('=');
      if (separator < 1 || separator === value.length - 1) {
        throw new Error('--body-file-for must be in the form {repo}={path}.');
      }
      const repo = value.slice(0, separator);
      const file = value.slice(separator + 1);
      assertSafeSegment(repo, 'repo in --body-file-for');
      if (options.bodyFilesFor.some((entry) => entry.repo === repo)) {
        throw new Error(
          `--body-file-for was supplied more than once for ${repo}.`,
        );
      }
      options.bodyFilesFor.push({ repo, file });
      i += consumed;
    } else if (arg.startsWith('-'))
      throw new Error(`Unexpected option: ${arg}`);
    else positionals.push(arg);
  }

  if (options.help) return options;
  if (positionals.length !== 3)
    throw new Error('Supply {client}, {ticket}, and {base-branch}.');
  [options.client, options.ticket, options.base] = positionals;
  assertSafeSegment(options.client, 'client');
  assertSafeSegment(options.ticket, 'ticket');
  if (
    !options.base ||
    options.base.startsWith('-') ||
    /[\s~^:?*[\\]/.test(options.base)
  ) {
    throw new Error(`Invalid base branch: ${JSON.stringify(options.base)}.`);
  }
  if (!options.bodyFile && options.bodyFilesFor.length === 0) {
    throw new Error(
      'Supply --body-file or one or more --body-file-for mappings.',
    );
  }
  return options;
}

export function parseRepositoryRemote(value) {
  const remote = parseRemote(value);
  if (remote.protocol !== 'ssh:') throw new Error('Origin must use SSH.');
  return { ...remote, transport: 'ssh' };
}

export function resolveBodyFiles(repos, options, cwd = process.cwd()) {
  const repoNames = new Set(repos.map((repo) => repo.repo));
  for (const { repo } of options.bodyFilesFor) {
    if (!repoNames.has(repo))
      throw new Error(
        `Body mapping names repo "${repo}", which is not in this ticket.`,
      );
  }

  const overrides = new Map(
    options.bodyFilesFor.map(({ repo, file }) => [repo, file]),
  );
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
    try {
      stat = fs.statSync(absolute);
    } catch {
      throw new Error(`PR body file does not exist: ${absolute}`);
    }
    if (!stat.isFile())
      throw new Error(`PR body path is not a file: ${absolute}`);
    if (!fs.readFileSync(absolute, 'utf8').trim())
      throw new Error(`PR body file is empty: ${absolute}`);
    resolved.set(repo.repo, absolute);
  }
  if (missing.length)
    throw new Error(`No PR body file supplied for: ${missing.join(', ')}.`);
  return resolved;
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
    throw new Error(
      `${repoEntry.repo} is on branch "${branch}", expected ticket branch "${ticket}".`,
    );
  }
  const status = gitFn(['status', '--porcelain'], { cwd });
  if (status)
    throw new Error(
      `${repoEntry.repo} has uncommitted changes; commit them before creating PRs.`,
    );

  const remoteUrl = gitFn(['remote', 'get-url', 'origin'], { cwd });
  const remote = parseRepositoryRemote(remoteUrl);
  if (!same(remote.repo, repoEntry.repo)) {
    throw new Error(
      `${repoEntry.repo} has an origin for a different repo: ${remote.org}/${remote.repo}.`,
    );
  }
  const primaryDir = (
    deps.getPrimaryRepoDirFromWorktree ?? getPrimaryRepoDirFromWorktree
  )(cwd);
  if (!primaryDir)
    throw new Error(
      `Could not resolve the primary clone for ${repoEntry.repo}.`,
    );
  const reposRoot = path.resolve(deps.reposRoot ?? REPOS_ROOT);
  const relativePrimary = path.relative(reposRoot, path.resolve(primaryDir));
  const primaryParts = relativePrimary.split(path.sep);
  if (
    path.isAbsolute(relativePrimary) ||
    primaryParts.length !== 2 ||
    primaryParts.includes('..') ||
    fs.realpathSync(
      resolvePrimaryPath(remote.org, remote.repo, remote.host),
    ) !== fs.realpathSync(primaryDir)
  )
    throw new Error('Origin does not match the primary clone path.');
  const identity = resolveIdentity(remote.org, remote.host, remote.repo);
  if (!originMatches(remoteUrl, remote.org, remote.repo, identity)) {
    throw new Error(
      `${remote.org}/${remote.repo} origin uses host "${remote.host}"; expected the ${identity.id} account's SSH host ` +
        `"${identity.sshHost}"${identity.sshHostAliases?.length ? ` or an alias (${identity.sshHostAliases.join(', ')})` : ''}.`,
    );
  }
  return { ...repoEntry, ...remote, branch, bodyFile, identity };
}

export function publishRepo(repo, options, auth, deps = {}) {
  const gitFn = deps.git ?? git;
  const api = deps.api ?? hostOperation;
  const coordinate = { owner: repo.org, repo: repo.repo };
  const first = gitFn(
    ['rev-list', '--reverse', `origin/${options.base}..HEAD`],
    { cwd: repo.path },
  ).split('\n')[0];
  if (!first) throw new Error('No commits ahead of the base branch.');
  const title = gitFn(['show', '-s', '--format=%s', first], { cwd: repo.path });
  const existing = api(repo.identity, 'pulls', coordinate).find(
    (p) =>
      p.head === repo.branch &&
      p.base === options.base &&
      same(p.repository, `${repo.org}/${repo.repo}`),
  );
  gitFn(['push', '--set-upstream', 'origin', `${repo.branch}:${repo.branch}`], {
    cwd: repo.path,
  });
  if (existing) return { url: existing.url, created: false };
  const result = api(repo.identity, 'createPull', {
    ...coordinate,
    title,
    body: fs.readFileSync(repo.bodyFile, 'utf8'),
    head: repo.branch,
    base: options.base,
    draft: options.draft,
  });
  const url = new URL(result.url);
  if (url.protocol !== 'https:' || url.hostname !== repo.host)
    throw new Error('Host did not return an expected pull request URL.');
  return { url: url.href, created: true };
}

export function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  const log = deps.log ?? console.log;
  const warn = deps.warn ?? console.error;
  if (options.help) {
    log(usage());
    return 0;
  }

  try {
    (deps.git ?? git)(['check-ref-format', '--branch', options.base], {});
  } catch {
    throw new Error(`Invalid base branch: ${JSON.stringify(options.base)}.`);
  }

  assertNoCaseCollisions();
  const tickets = (deps.listTicketFolders ?? listTicketFolders)();
  const matches = tickets.filter(
    (entry) =>
      same(entry.client, options.client) && same(entry.ticket, options.ticket),
  );
  if (matches.length > 1)
    throw new Error(
      `Ambiguous ticket: ${matches.map((entry) => entry.path).join(', ')}`,
    );
  const ticket = matches[0];
  if (ticket && ticket.ticket !== options.ticket)
    throw new Error(`Use exact ticket/branch case: ${ticket.ticket}`);
  if (!ticket)
    throw new Error(
      `No ticket folder found at ${ticketPath(options.client, options.ticket)}.`,
    );
  if (!ticket.repos.length)
    throw new Error(`No repo worktrees found under ${ticket.path}.`);

  const bodies = resolveBodyFiles(
    ticket.repos,
    options,
    deps.cwd ?? process.cwd(),
  );
  // Complete every local check before performing authentication or any remote mutation.
  const repos = ticket.repos.map((repo) =>
    preflightRepo(repo, options.ticket, bodies.get(repo.repo), deps),
  );

  const keys = repos.map((repo) =>
    `${repo.host}/${repo.org}/${repo.repo}`.toLowerCase(),
  );
  if (new Set(keys).size !== keys.length)
    throw new Error('Duplicate repository identity in ticket.');

  if (options.dryRun) {
    log(
      `Validated ${repos.length} repo worktree(s); no fetch, push, or PR creation performed.`,
    );
    for (const repo of repos) {
      log(
        `- ${repo.org}/${repo.repo}: ${repo.branch} -> ${options.base} (body: ${repo.bodyFile})${options.draft ? ' [draft]' : ''}`,
      );
    }
    return 0;
  }

  const authByUser = new Map();
  const authKey = (identity) => identity.id;
  for (const repo of repos)
    if (!authByUser.has(repo.identity.id))
      authByUser.set(
        repo.identity.id,
        (deps.api ?? hostOperation)(repo.identity, 'validate'),
      );

  const links = [];
  let failed = 0;
  for (const repo of repos) {
    try {
      const result = (deps.publishRepo ?? publishRepo)(
        repo,
        options,
        authByUser.get(authKey(repo.identity)),
        deps,
      );
      links.push({ repo: `${repo.org}/${repo.repo}`, ...result });
      log(
        `${result.created ? 'CREATED' : 'EXISTS '} ${repo.org}/${repo.repo}: ${result.url}`,
      );
    } catch (error) {
      failed++;
      warn(`FAILED  ${repo.org}/${repo.repo}: ${error.message}`);
    }
  }

  if (links.length) {
    log('Pull requests:');
    for (const link of links) log(`- ${link.repo}: ${link.url}`);
  }
  log(
    `Done: ${links.filter((link) => link.created).length} created, ${links.filter((link) => !link.created).length} existing, ${failed} failed.`,
  );
  return failed ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`Error: ${error.message}\n\n${usage()}`);
    process.exitCode = 1;
  }
}
