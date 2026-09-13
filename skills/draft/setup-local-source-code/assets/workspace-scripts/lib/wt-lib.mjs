// wt-lib.mjs
//
// Shared helpers for the wt-*.mjs family of worktree-management scripts.
// Node built-ins only — no npm dependencies, no package.json. Keep this file
// generically useful: wt-create.mjs and wt-sync.mjs are the first consumers,
// but wt-list.mjs, wt-status.mjs, wt-remove.mjs, wt-prune.mjs and
// wt-open.mjs are expected to be built against it too.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceRoot } from './wt-config.mjs';

// ---------------------------------------------------------------------------
// Directory layout
// ---------------------------------------------------------------------------

/** Expands a leading "~" to the current user's home directory. */
export function expandHome(inputPath) {
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

export const SOURCE_ROOT = expandHome(sourceRoot);
export const REPOS_ROOT = path.join(SOURCE_ROOT, 'repos');
export const TREES_ROOT = path.join(SOURCE_ROOT, 'trees');
export const SCRIPTS_ROOT = path.join(SOURCE_ROOT, 'scripts');

/** Returns the repository-local Git settings required for a routed identity. */
export function repositoryIdentitySettings(identity) {
  return [
    ['user.name', identity.gitUserName],
    ['user.email', identity.gitUserEmail],
    ['gpg.format', 'ssh'],
    ['user.signingkey', expandHome(identity.sshKeyPath)],
    ['commit.gpgsign', 'true'],
    ['tag.gpgsign', 'true'],
  ];
}

/** Enforces author identity and SSH signing in a primary clone's shared config. */
export function configureRepositoryIdentity(repoDir, identity) {
  for (const [key, value] of repositoryIdentitySettings(identity)) {
    git(['config', '--local', '--replace-all', key, value], { cwd: repoDir });
  }
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

/**
 * Validates that `value` is safe to use as a single literal path segment
 * (a directory name built directly from user-supplied input: org, repo,
 * client-or-project, ticket-id-or-slug). Throws a clear, actionable Error
 * if it isn't.
 *
 * Rejects: empty/non-string values, ".", "..", and anything containing a
 * path separator or "..", since those could otherwise escape the intended
 * directory (path traversal) once interpolated into a path.
 *
 * @param {unknown} value
 * @param {string} label Human-readable name of the field, used in error messages.
 * @returns {string} the validated value, unchanged
 */
export function assertSafeSegment(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  if (value.includes('/') || value.includes('\\')) {
    throw new Error(
      `${label} must not contain path separators ("/" or "\\"). Got: ${JSON.stringify(value)}`
    );
  }
  if (value.includes('..')) {
    throw new Error(`${label} must not contain "..". Got: ${JSON.stringify(value)}`);
  }
  if (value === '.') {
    throw new Error(`${label} must not be ".". Got: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Splits an "{org}/{repo}" spec into its two parts, validating each as a
 * safe path segment.
 * @param {string} spec
 * @param {string} [label]
 * @returns {{ org: string, repo: string }}
 */
export function parseOrgRepo(spec, label = 'org/repo argument') {
  if (typeof spec !== 'string' || spec.length === 0) {
    throw new Error(`${label} must be in the form "org/repo".`);
  }
  const parts = spec.split('/');
  if (parts.length !== 2) {
    throw new Error(`${label} must be in the form "org/repo" (exactly one "/"). Got: ${JSON.stringify(spec)}`);
  }
  const [org, repo] = parts;
  assertSafeSegment(org, 'org');
  assertSafeSegment(repo, 'repo');
  return { org, repo };
}

/** Builds the primary-clone path for an org/repo, validating both segments. */
export function repoPath(org, repo) {
  assertSafeSegment(org, 'org');
  assertSafeSegment(repo, 'repo');
  return path.join(REPOS_ROOT, org, repo);
}

/** Builds a ticket folder's path, validating both segments. */
export function ticketPath(clientOrProject, ticketIdOrSlug) {
  assertSafeSegment(clientOrProject, 'client-or-project');
  assertSafeSegment(ticketIdOrSlug, 'ticket-id-or-slug');
  return path.join(TREES_ROOT, clientOrProject, ticketIdOrSlug);
}

/** Builds a single repo worktree's path, validating all three segments. */
export function worktreePath(clientOrProject, ticketIdOrSlug, repo) {
  assertSafeSegment(repo, 'repo');
  return path.join(ticketPath(clientOrProject, ticketIdOrSlug), repo);
}

// ---------------------------------------------------------------------------
// Running commands
// ---------------------------------------------------------------------------

/**
 * Runs a command synchronously via execFileSync (never a shell, so
 * user-supplied slugs/branch names can never be interpreted as shell
 * syntax). Returns trimmed stdout on success; throws an Error containing
 * stderr (or stdout, or the raw error) on failure.
 *
 * @param {string} file
 * @param {string[]} args
 * @param {import('node:child_process').ExecFileSyncOptions} [options]
 * @returns {string}
 */
export function runCmd(file, args, options = {}) {
  try {
    const result = execFileSync(file, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    return result.trim();
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr).trim() : '';
    const stdout = err.stdout ? String(err.stdout).trim() : '';
    const cmdStr = [file, ...args].join(' ');
    const detail = stderr || stdout || err.message;
    throw new Error(`Command failed: ${cmdStr}\n${detail}`);
  }
}

/**
 * Like runCmd, but returns null instead of throwing on failure. Useful for
 * "does this exist / is this true" checks where a non-zero exit is an
 * expected, non-exceptional outcome (e.g. checking whether a branch exists).
 */
export function runCmdOrNull(file, args, options = {}) {
  try {
    return runCmd(file, args, options);
  } catch {
    return null;
  }
}

/** Convenience wrapper: runCmd('git', args, options). */
export function git(args, options = {}) {
  return runCmd('git', args, options);
}

/** Convenience wrapper: runCmdOrNull('git', args, options). */
export function gitOrNull(args, options = {}) {
  return runCmdOrNull('git', args, options);
}

// ---------------------------------------------------------------------------
// Git repo/worktree introspection
// ---------------------------------------------------------------------------

export function pathExists(p) {
  return fs.existsSync(p);
}

export function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** True if `repoDir` has a clean working tree (no changes, staged or not). */
export function isWorkingTreeClean(repoDir) {
  const status = git(['status', '--porcelain'], { cwd: repoDir });
  return status.length === 0;
}

/** Current branch name, or null if in detached-HEAD state. */
export function getCurrentBranch(repoDir) {
  const branch = gitOrNull(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: repoDir });
  if (!branch) return null;
  return branch === 'HEAD' ? null : branch;
}

/** True if a local branch with this name exists in `repoDir`. */
export function localBranchExists(repoDir, branch) {
  return gitOrNull(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repoDir }) !== null;
}

/** Number of files with uncommitted changes (staged, unstaged, or untracked) in `repoDir`. */
export function getChangedFileCount(repoDir) {
  const status = git(['status', '--porcelain'], { cwd: repoDir });
  return status.length === 0 ? 0 : status.split('\n').length;
}

/**
 * Ahead/behind counts of HEAD vs its upstream in `repoDir`, if it has one.
 * @returns {{ upstream: string|null, ahead: number, behind: number }}
 */
export function getUpstreamAheadBehind(repoDir) {
  const upstream = gitOrNull(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: repoDir });
  if (!upstream) return { upstream: null, ahead: 0, behind: 0 };

  const counts = gitOrNull(['rev-list', '--left-right', '--count', `${upstream}...HEAD`], { cwd: repoDir });
  if (!counts) return { upstream, ahead: 0, behind: 0 };

  const [behind, ahead] = counts.split(/\s+/).map(Number);
  return { upstream, ahead, behind };
}

/**
 * Resolves the primary clone directory (the `~/Source/repos/{org}/{repo}`
 * directory) that a given worktree belongs to, by asking git directly from
 * inside the worktree — avoids having to guess/search for the owning org by
 * repo name. Returns null if `worktreeDir` isn't a git worktree at all.
 */
export function getPrimaryRepoDirFromWorktree(worktreeDir) {
  const commonDir = gitOrNull(['rev-parse', '--git-common-dir'], { cwd: worktreeDir });
  if (!commonDir) return null;
  const absCommonDir = path.isAbsolute(commonDir) ? commonDir : path.resolve(worktreeDir, commonDir);
  // absCommonDir is the primary repo's ".git" directory even when resolved
  // from inside one of its linked worktrees.
  return path.dirname(absCommonDir);
}

/**
 * The set of worktree paths git currently has registered for the repo at
 * `repoDir` (i.e. `git worktree list`), as absolute, normalized paths.
 * Returns an empty set if `repoDir` isn't a git repo.
 */
export function getRegisteredWorktreePaths(repoDir) {
  const output = gitOrNull(['worktree', 'list', '--porcelain'], { cwd: repoDir });
  if (!output) return new Set();

  const paths = new Set();
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      paths.add(path.resolve(line.slice('worktree '.length).trim()));
    }
  }
  return paths;
}

/**
 * Determines the remote's default branch name (e.g. "main") for the repo at
 * `repoDir`. Prefers the local `refs/remotes/origin/HEAD` symref (accurate
 * right after a `git fetch`); falls back to asking origin directly via
 * `git ls-remote --symref` if that ref hasn't been set up locally.
 */
export function getDefaultBranch(repoDir) {
  const symref = gitOrNull(['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: repoDir });
  if (symref) {
    return symref.replace(/^refs\/remotes\/origin\//, '');
  }

  const lsRemote = gitOrNull(['ls-remote', '--symref', 'origin', 'HEAD'], { cwd: repoDir });
  if (lsRemote) {
    const match = lsRemote.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m);
    if (match) return match[1];
  }

  throw new Error(
    `Could not determine the default branch for the repo at ${repoDir}. ` +
      `Try running "git fetch origin" in that directory first.`
  );
}

// ---------------------------------------------------------------------------
// Tree/ticket listing (shared by wt-list, wt-status, wt-prune, wt-remove)
// ---------------------------------------------------------------------------

function listSubdirNames(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * @typedef {Object} RepoWorktreeEntry
 * @property {string} repo Repo name (matches the folder name and the
 *   {org}/{repo} repo segment).
 * @property {string} path Absolute path to this repo's worktree.
 *
 * @typedef {Object} TicketFolderEntry
 * @property {string} client The client-or-project segment.
 * @property {string} ticket The ticket-id-or-slug segment.
 * @property {string} path Absolute path to the ticket folder.
 * @property {RepoWorktreeEntry[]} repos Repo worktrees found inside it.
 */

/**
 * Walks `~/Source/trees/{client}/{ticket}/{repo}` and returns every ticket
 * folder found, along with the repo worktree subfolders inside each one.
 * Returns `[]` if TREES_ROOT doesn't exist yet. Purely a directory listing —
 * does not inspect git state (callers needing that, e.g. wt-status, should
 * run further git commands against each entry's `path`).
 *
 * @returns {TicketFolderEntry[]}
 */
export function listTicketFolders() {
  if (!pathExists(TREES_ROOT)) return [];

  const entries = [];
  for (const client of listSubdirNames(TREES_ROOT)) {
    const clientDir = path.join(TREES_ROOT, client);
    for (const ticket of listSubdirNames(clientDir)) {
      const ticketDir = path.join(clientDir, ticket);
      const repos = listSubdirNames(ticketDir).map((repo) => ({
        repo,
        path: path.join(ticketDir, repo),
      }));
      entries.push({ client, ticket, path: ticketDir, repos });
    }
  }
  return entries;
}

/**
 * @typedef {Object} PrimaryRepoEntry
 * @property {string} org
 * @property {string} repo
 * @property {string} path Absolute path to the primary clone.
 */

/**
 * Walks `~/Source/repos/{org}/{repo}` and returns every primary clone found.
 * Returns `[]` if REPOS_ROOT doesn't exist yet.
 * @returns {PrimaryRepoEntry[]}
 */
export function listPrimaryRepos() {
  if (!pathExists(REPOS_ROOT)) return [];

  const entries = [];
  for (const org of listSubdirNames(REPOS_ROOT)) {
    const orgDir = path.join(REPOS_ROOT, org);
    for (const repo of listSubdirNames(orgDir)) {
      entries.push({ org, repo, path: path.join(orgDir, repo) });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Prints `message` to stderr and exits with `exitCode` (default 1). */
export function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

export function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** True if `dir` exists and has no entries. */
export function isEmptyDir(dir) {
  return fs.readdirSync(dir).length === 0;
}

/**
 * True if `cmd` resolves to something executable on PATH (via `which`).
 * Never throws — a missing command is just `false`.
 */
export function commandExists(cmd) {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  return runCmdOrNull(locator, [cmd]) !== null;
}
