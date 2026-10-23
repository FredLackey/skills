import fs from 'node:fs';
import path from 'node:path';
import { listIdentities, findIdentity, loadConfig } from './wt-config.mjs';
import { hostOperation } from './host-api.mjs';
import { assertWorkstationReady, effectiveDrift } from './wt-signing.mjs';
import { cloneUrl, repoPath, git, withWorkspaceLock } from './wt-lib.mjs';

export function cloneMain(
  argv,
  {
    authoredOnly,
    api = hostOperation,
    log = console.log,
    output = console.log,
    clone,
  } = {},
) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['--help', '-h'].includes(arg)) {
      log(
        'Usage: clone-' +
          (authoredOnly ? 'mine' : 'all') +
          '.mjs [--host {host}] [--profile {account}] [--org {owner}] [--user {login}] [--dry-run]',
      );
      return 0;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (
      !['--host', '--profile', '--org', '--user'].includes(arg) ||
      options[arg] ||
      !argv[i + 1] ||
      argv[i + 1].startsWith('-')
    )
      throw new Error('Invalid discovery option.');
    options[arg] = argv[++i];
  }
  const identities = listIdentities(options['--host']).filter(
    (i) =>
      (!options['--profile'] || i.id === options['--profile']) &&
      (!options['--user'] || i.login === options['--user']),
  );
  if (!identities.length) throw new Error('No matching configured account.');
  if (!options.dryRun && !clone) assertWorkstationReady();
  let failed = 0,
    matched = 0,
    ownerFound = false;
  for (const identity of identities) {
    try {
      const owners = api(identity, 'owners');
      for (const { login: owner } of owners) {
        if (
          options['--org'] &&
          owner.toLowerCase() !== options['--org'].toLowerCase()
        )
          continue;
        const route = findIdentity(owner, identity.host);
        const exact = Object.entries(loadConfig().repositories).some(
          ([coordinate, account]) =>
            coordinate.startsWith(`${identity.host}/${owner.toLowerCase()}/`) &&
            account === identity.id,
        );
        if ((!route || route.id !== identity.id) && !exact) {
          log(`SKIP ${identity.host}/${owner} (not routed to this account)`);
          continue;
        }
        ownerFound = true;
        for (const repository of api(identity, 'repositories', { owner })) {
          try {
            const actualOwner = repository.owner?.login;
            if (actualOwner?.toLowerCase() !== owner.toLowerCase())
              throw new Error(
                'Repository owner differs from the requested owner.',
              );
            const selected = findIdentity(
              owner,
              identity.host,
              repository.name,
            );
            if (selected?.id !== identity.id) continue;
            if (
              authoredOnly &&
              !api(identity, 'authored', { owner, repo: repository.name })
            )
              continue;
            matched++;
            if (options.dryRun) {
              output(`- ${identity.host}/${owner}/${repository.name}`);
              continue;
            }
            if (clone) {
              clone(owner, repository.name, identity);
              continue;
            }
            withWorkspaceLock(() => {
              const dir = repoPath(owner, repository.name, identity.host);
              if (fs.existsSync(dir)) {
                log(`SKIP ${dir} (exists)`);
                return;
              }
              fs.mkdirSync(path.dirname(dir), { recursive: true });
              git(['clone', cloneUrl(owner, repository.name, identity), dir]);
              if (effectiveDrift(dir, identity).length)
                throw new Error(
                  'Cloned repository has conflicting identity settings.',
                );
              log(`OK ${dir}`);
            });
          } catch (error) {
            failed++;
            log(`FAIL ${identity.host}/${owner}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      failed++;
      log(`FAIL ${identity.id}: ${error.message}`);
    }
  }
  if (options['--org'] && !ownerFound) {
    failed++;
    log('No routed owner matched the requested scope.');
  }
  log(`Done: ${matched} matched; ${failed} failed.`);
  return failed ? 1 : 0;
}
