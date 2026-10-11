#!/usr/bin/env node
// wt-route.mjs list [--host {host}]
// wt-route.mjs add {owner} {account} [--host {host}]
//
// Routes are the explicit owner -> account table in the workspace
// configuration. Every repository owner (organization or user) needs one
// before the helpers will clone, sync, or publish its repositories; nothing
// falls back to a default account.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { configPath, hostConfig, listIdentities, loadConfig, readRawConfig, saveConfig } from './lib/wt-config.mjs';
import { workstationStatus, writeWorkstationFiles } from './lib/wt-signing.mjs';
import { assertSafeSegment, takeHostOption } from './lib/wt-lib.mjs';

export function usage() {
  return [
    'Usage:',
    '  wt-route.mjs list [--host {host}]',
    '  wt-route.mjs add {owner} {account} [--host {host}]',
    '',
    `Routes live in ${configPath()}.`,
    'Owners are matched case-insensitively. GitHub is the default host.',
    'add refuses to change an existing route to a different account; edit the',
    'configuration deliberately if an owner really moves between accounts.',
    'After add, the generated workstation Git includes are refreshed.',
  ].join('\n');
}

export function main(argv = process.argv.slice(2), log = console.log) {
  const { args, host } = takeHostOption(argv);
  if (!args.length || args.includes('-h') || args.includes('--help')) { log(usage()); return 0; }
  const [command, ...rest] = args;

  if (command === 'list') {
    if (rest.length) throw new Error(usage());
    const config = loadConfig();
    const hosts = argv.some(arg => arg.startsWith('--host')) ? [hostConfig(host).host] : Object.keys(config.routes);
    for (const name of hosts) {
      log(`${name}:`);
      const entries = Object.entries(config.routes[name]).sort(([a], [b]) => a.localeCompare(b));
      if (!entries.length) log('  (no routes)');
      for (const [owner, account] of entries) log(`  ${owner} -> ${account}`);
    }
    return 0;
  }

  if (command === 'add') {
    if (rest.length !== 2) throw new Error(usage());
    const [owner, accountId] = rest;
    assertSafeSegment(owner, 'owner');
    const key = hostConfig(host).host;
    const accounts = listIdentities(key);
    const account = accounts.find(entry => entry.id === accountId);
    if (!account) {
      throw new Error(`Unknown account "${accountId}" on ${key}. Accounts on ${key}: ${accounts.map(entry => entry.id).join(', ') || 'none'}.`);
    }
    const current = loadConfig().routes[key][owner.toLowerCase()];
    if (current === accountId) { log(`KEEP    ${key}: ${owner} -> ${accountId}`); return 0; }
    if (current) {
      throw new Error(`${owner} on ${key} is already routed to ${current}. Change it by editing ${configPath()} deliberately.`);
    }
    const raw = readRawConfig();
    raw.routes ??= {};
    const table = Object.entries(raw.routes).find(([name]) => name.toLowerCase() === key)?.[1] ?? (raw.routes[key] = {});
    table[owner.toLowerCase()] = accountId;
    saveConfig(raw);
    log(`ADD     ${key}: ${owner} -> ${accountId}`);
    if (workstationStatus().registered) {
      writeWorkstationFiles();
      log('Refreshed the workstation Git includes.');
    } else {
      log('Workstation signing is not installed yet; run wt-enforce-signing.mjs.');
    }
    return 0;
  }

  throw new Error(usage());
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`Error: ${error.message}`); process.exitCode = 1; }
}
