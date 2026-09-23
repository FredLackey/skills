import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Each block owns only one approved hostname. Other blocks and user text survive.
export function reconcileSshIdentity(configFile, host, identityFile) {
  if (!/^[A-Za-z0-9_:.-]+$/.test(host) || host.startsWith('-')) throw new Error('unsafe SSH host');
  if (!path.isAbsolute(identityFile) || /[\r\n"\\%]/.test(identityFile)) throw new Error('unsafe SSH identity path');
  const id = crypto.createHash('sha256').update(host.toLowerCase()).digest('hex').slice(0, 24);
  const begin = `# BEGIN setup-multi-herdr ${id}`;
  const end = `# END setup-multi-herdr ${id}`;
  let original = '';
  try {
    const stat = fs.lstatSync(configFile);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('SSH config must be a regular file');
    original = fs.readFileSync(configFile, 'utf8');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const block = `${begin}\nHost ${host}\n    IdentityFile "${identityFile}"\n    IdentitiesOnly yes\n    BatchMode yes\nHost *\n${end}\n`;
  const start = original.indexOf(`${begin}\n`);
  let updated;
  if (start >= 0) {
    const finish = original.indexOf(`${end}\n`, start);
    if (finish < 0 || original.indexOf(begin, start + begin.length) >= 0) throw new Error('malformed managed SSH block');
    updated = original.slice(0, start) + block + original.slice(finish + end.length + 1);
  } else updated = block + original;
  if (updated === original) return false;
  fs.mkdirSync(path.dirname(configFile), { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(`${configFile}.before-setup-multi-herdr`, original, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const staging = fs.mkdtempSync(path.join(path.dirname(configFile), '.herdr-config-'));
  try {
    const file = path.join(staging, 'config');
    fs.writeFileSync(file, updated, { flag: 'wx', mode: 0o600 });
    fs.renameSync(file, configFile);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  return true;
}
