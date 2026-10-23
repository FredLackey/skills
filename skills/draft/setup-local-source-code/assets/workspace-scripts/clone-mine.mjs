#!/usr/bin/env node
import { cloneMain } from './lib/clone-repositories.mjs';
try {
  process.exitCode = cloneMain(process.argv.slice(2), { authoredOnly: true });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
