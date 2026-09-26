#!/usr/bin/env node

import {
  lstatSync, mkdirSync, readFileSync, realpathSync, statSync, symlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

const help = `Usage: link-skill.mjs --source <skill-folder> --destination <skills-root>/<skill-name>
                      [--apply | --check] [--kind symlink|junction]

Requires Node.js 20 or newer. Preview is the default and writes nothing.
--apply creates an absent connection and its parent directories.
--check verifies an existing connection; it never creates one.
--kind defaults to symlink. Junctions are an explicit Windows-only option.

The destination entry must have the supplied source skill folder's name.
Source aliases resolve to their current real directory; redirecting an alias
later requires checking and deliberately repairing the connection. Existing
matching links are reused; files, copies, other targets, and broken links
are never overwritten. This checks filesystem access, not harness discovery.
Exit codes: 0 = planned/linked/verified, 1 = conflict/missing, 2 = error.
`;

function inspect(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function absolutePath(value) {
  if (value === '~') return homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

function contains(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

function physicalParent(path) {
  // Resolve existing ancestors, including symlinks, even before mkdir runs.
  const missing = [];
  let current = path;
  while (!inspect(current)) {
    missing.unshift(basename(current));
    const parent = dirname(current);
    if (parent === current) throw new Error('No accessible destination ancestor.');
    current = parent;
  }
  if (!statSync(current).isDirectory()) throw new Error('Destination parent is not a directory.');
  return resolve(realpathSync(current), ...missing);
}

function report(status, source, destination, message, exitCode = 0) {
  console.log(JSON.stringify({ status, source, destination, message }, null, 2));
  process.exitCode = exitCode;
}

function main() {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' }, destination: { type: 'string' },
      apply: { type: 'boolean' }, check: { type: 'boolean' },
      kind: { type: 'string', default: 'symlink' }, help: { type: 'boolean' },
    },
  });
  if (values.help) return console.log(help);
  if (!values.source || !values.destination || (values.apply && values.check)) throw new Error(help);
  if (!['symlink', 'junction'].includes(values.kind)) throw new Error('Unknown --kind.');
  if (values.kind === 'junction' && process.platform !== 'win32') {
    throw new Error('--kind junction is supported only on Windows.');
  }

  const suppliedSource = absolutePath(values.source);
  const source = realpathSync(suppliedSource);
  if (!statSync(source).isDirectory()) throw new Error('Source must be a skill directory.');
  const manifest = join(source, 'SKILL.md');
  if (!statSync(manifest).isFile() || !readFileSync(manifest, 'utf8').trim()) {
    throw new Error('Source must have a readable, nonempty SKILL.md file.');
  }
  const destination = absolutePath(values.destination);
  if (basename(destination) !== basename(suppliedSource)) {
    throw new Error('Destination must be an individual entry with the source skill folder name.');
  }
  const physicalDestination = join(physicalParent(dirname(destination)), basename(destination));
  if (contains(source, physicalDestination) || contains(physicalDestination, source)) {
    throw new Error('Source and destination must be separate, non-nested locations.');
  }

  const existing = inspect(destination);
  if (existing) {
    if (existing.isSymbolicLink()) {
      let target;
      try {
        target = realpathSync(destination);
      } catch (error) {
        if (!['ENOENT', 'ELOOP'].includes(error.code)) throw error;
      }
      if (target === source) {
        return report('verified', source, destination, 'Existing connection already points to this skill.');
      }
    }
    return report('conflict', source, destination, 'Existing entry preserved; resolve migration before retrying.', 1);
  }
  if (values.check) return report('missing', source, destination, 'No connection exists.', 1);
  if (!values.apply) return report('planned', source, destination, `Would create a directory ${values.kind}.`);

  mkdirSync(dirname(destination), { recursive: true });
  // Creation fails if a destination appeared after inspection; never overwrite it.
  symlinkSync(source, destination, values.kind === 'junction' ? 'junction' : 'dir');
  if (realpathSync(destination) !== source) throw new Error('Created connection did not resolve to the source.');
  report('linked', source, destination, 'Connection created; verify discovery in the harness next.');
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ status: 'error', message: error.message }, null, 2));
  process.exitCode = 2;
}
