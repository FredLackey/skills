// Isolated workspace configuration for tests. Import this before any helper
// module: it points SOURCE_WORKSPACE_CONFIG and the global Git configuration
// at temporary files, so tests never read or change the developer's settings.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FORGE_HOST = 'git.example.test';

/** A complete configuration with personal, employer, and forge accounts. */
export function testConfig(sourceRoot) {
  return {
    version: 1,
    sourceRoot,
    settings: { commitAndPush: false },
    hosts: {
      [FORGE_HOST]: { provider: 'forgejo', sshPort: 2222, tokenFile: path.join(sourceRoot, 'forge-token.json') },
    },
    accounts: {
      personal: {
        label: 'Personal', login: 'TestUser', gitName: 'Test User', gitEmail: 'test@example.invalid',
        sshHost: 'github.com', sshKeyPath: '~/.ssh/test-personal',
      },
      employer: {
        label: 'Employer', login: 'EmployerUser', gitName: 'Test User', gitEmail: 'work@example.invalid',
        sshHost: 'github.com-employer', sshHostAliases: ['github-employer-legacy'], sshKeyPath: '~/.ssh/test-employer',
      },
      forge: {
        label: 'Forge', host: FORGE_HOST, login: 'forgeuser', gitName: 'Test User', gitEmail: 'forge@example.invalid',
        sshKeyPath: '~/.ssh/test-forge',
      },
    },
    routes: {
      'github.com': {
        exampleorg: 'personal', otherorg: 'personal', seed: 'personal', neworg: 'personal',
        old: 'personal', org: 'personal', 'org-a': 'personal', 'org-b': 'personal', testuser: 'personal',
        'employer-team': 'employer', 'employer-example': 'employer',
      },
      [FORGE_HOST]: { exampleorg: 'forge', x: 'forge' },
    },
  };
}

/** Writes a configuration under `root` and points this process at it; returns the environment. */
export function installTestConfig(root, config = testConfig(root)) {
  const file = path.join(root, '.config', 'source-workspace', 'config.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  const globalConfig = path.join(root, '.gitconfig-global');
  if (!fs.existsSync(globalConfig)) fs.writeFileSync(globalConfig, '');
  const env = { SOURCE_WORKSPACE_CONFIG: file, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' };
  Object.assign(process.env, env);
  return { file, env: { ...process.env, ...env } };
}

export const TEST_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-test-config-')));
export const TEST = installTestConfig(TEST_ROOT);
process.on('exit', () => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));
