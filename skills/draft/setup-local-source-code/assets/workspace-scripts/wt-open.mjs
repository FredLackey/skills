#!/usr/bin/env node
// wt-open.mjs {client-or-project} {ticket-id-or-slug}
//
// Opens the whole ticket folder ~/Source/trees/{client-or-project}/{ticket}
// as one VS Code window via the `code` CLI — however many (or few,
// including zero) repo worktrees it contains. Never picks a "best" repo
// subfolder and never prompts/offers a picker of any kind.
//
// See the workspace AGENTS.md generated during setup for the full design.

import { spawn } from 'node:child_process';
import {
  assertSafeSegment, commandExists, isDirectory, ticketPath, TREES_ROOT,
} from './lib/wt-lib.mjs';

function usage() {
  return [
    'Usage: wt-open.mjs {client-or-project} {ticket-id-or-slug}',
    '',
    `Opens ${TREES_ROOT}/{client-or-project}/{ticket-id-or-slug} as one`,
    'VS Code window (via the "code" CLI).',
  ].join('\n');
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) {
    console.log(usage());
    process.exit(0);
  }

  if (args.length !== 2) {
    console.error(usage());
    process.exit(1);
  }

  const [clientOrProject, ticketIdOrSlug] = args;

  try {
    assertSafeSegment(clientOrProject, 'client-or-project');
    assertSafeSegment(ticketIdOrSlug, 'ticket-id-or-slug');
  } catch (err) {
    console.error(`Error: ${err.message}\n`);
    console.error(usage());
    process.exit(1);
  }

  const ticketDir = ticketPath(clientOrProject, ticketIdOrSlug);

  if (!isDirectory(ticketDir)) {
    console.error(
      `Error: no ticket folder found at ${ticketDir}.\n` +
        `Run "wt-create.mjs {org}/{repo} ${clientOrProject} ${ticketIdOrSlug}" first to create a worktree under it.`
    );
    process.exit(1);
  }

  if (!commandExists('code')) {
    console.error("VS Code ('code' CLI) is not installed. Install VS Code and add it to PATH before using wt-open.");
    process.exit(1);
  }

  const child = spawn('code', [ticketDir], { detached: true, stdio: 'ignore' });
  child.unref();

  console.log(`Opened in VS Code: ${ticketDir}`);
  process.exit(0);
}

main();
