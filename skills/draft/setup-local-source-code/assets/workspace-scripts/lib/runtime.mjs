import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function nodeExecutable(configured) {
  if (configured) {
    const candidate = configured.startsWith('~/')
      ? path.join(os.homedir(), configured.slice(2))
      : configured;
    if (!path.isAbsolute(candidate))
      throw new Error('settings.nodePath must be an absolute executable path.');
    fs.accessSync(candidate, fs.constants.X_OK);
    return candidate;
  }
  const actual = fs.realpathSync(process.execPath);
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    for (const name of new Set([
      path.basename(process.execPath),
      'node',
      'node.exe',
    ])) {
      const candidate = path.resolve(directory, name);
      try {
        if (fs.realpathSync(candidate) === actual) {
          fs.accessSync(candidate, fs.constants.X_OK);
          return candidate;
        }
      } catch {}
    }
  }
  return process.execPath;
}
