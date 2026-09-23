#!/usr/bin/env node
// Read-only inventory of case-colliding source paths.
import { caseCollisions } from './lib/wt-lib.mjs';
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: wt-audit-paths.mjs\nReports case-colliding owner, repository, client, ticket, and worktree paths without changing them.');
} else if (process.argv.length > 2) {
  console.error('Usage: wt-audit-paths.mjs');
  process.exitCode = 1;
} else {
  const groups = caseCollisions();
  for (const group of groups) console.log(`Case collision:\n${group.join('\n')}`);
  console.log(`${groups.length} case collision group(s).`);
  process.exitCode = groups.length ? 1 : 0;
}
