import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function testConfig(root) {
  const account = (host, login) => ({
    host,
    login,
    label: login,
    gitName: 'Example Developer',
    gitEmail: `${login}@example.test`,
    sshHost: `${login}.${host}`,
    sshHostAliases: [],
    sshKeyPath: path.join(root, 'keys', `id_${login}`),
  });
  return {
    version: 2,
    sourceRoot: root,
    machineName: 'Engineering Test Station',
    settings: { commitAndPush: false },
    hosts: {
      'alpha.example': { provider: 'github' },
      'beta.example': { provider: 'forgejo', sshPort: 2222 },
      'gamma.example': { provider: 'bitbucket' },
    },
    accounts: {
      personal: account('alpha.example', 'personal'),
      work: account('alpha.example', 'work'),
      second: account('beta.example', 'second'),
      third: account('gamma.example', 'third'),
    },
    routes: {
      'alpha.example': { personalorg: 'personal', team: 'work' },
      'beta.example': { team: 'second' },
      'gamma.example': { thirdteam: 'third' },
    },
    repositories: {},
  };
}

export function installTestConfig(root, config = testConfig(root)) {
  fs.mkdirSync(root, { recursive: true });
  for (const account of Object.values(config.accounts)) {
    fs.mkdirSync(path.dirname(account.sshKeyPath), { recursive: true });
    if (!fs.existsSync(account.sshKeyPath))
      execFileSync('ssh-keygen', [
        '-q',
        '-t',
        'ed25519',
        '-N',
        '',
        '-f',
        account.sshKeyPath,
      ]);
  }
  const file = path.join(root, '.config/source-workspace/config.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  const global = path.join(root, '.gitconfig');
  fs.writeFileSync(global, '');
  const env = {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    XDG_CONFIG_HOME: path.join(root, '.config'),
    SOURCE_WORKSPACE_CONFIG: file,
    GIT_CONFIG_GLOBAL: global,
    GIT_CONFIG_NOSYSTEM: '1',
    SSH_AUTH_SOCK: '',
  };
  for (const key of Object.keys(env))
    if (/^GIT_(AUTHOR|COMMITTER|CONFIG_(COUNT|KEY_|VALUE_))/.test(key))
      delete env[key];
  return { file, env };
}
