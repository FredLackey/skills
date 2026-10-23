import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function preserveBeforeWrite(files, reason, sourceRoot) {
  const existing = [...new Set(files)].filter((file) => fs.existsSync(file));
  if (!existing.length) return;
  const expand = (value) =>
    value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
  if (!sourceRoot) {
    const config = expand(
      process.env.SOURCE_WORKSPACE_CONFIG ??
        '~/.config/source-workspace/config.json',
    );
    sourceRoot = JSON.parse(fs.readFileSync(config, 'utf8')).sourceRoot;
  }
  const stamp = new Date().toISOString();
  const directory = path.join(
    expand(sourceRoot),
    'quarantine',
    `${stamp.slice(0, 10)}-workstation-config`,
    stamp.replaceAll(':', '-') +
      '-' +
      process.pid +
      '-' +
      Math.random().toString(16).slice(2),
  );
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const entries = existing.map((file, i) => {
    const name = `${i}-${path.basename(file)}`;
    fs.copyFileSync(file, path.join(directory, name));
    fs.chmodSync(path.join(directory, name), 0o600);
    return `- ${name}: preserved from ${file}`;
  });
  fs.writeFileSync(
    path.join(directory, 'README.md'),
    `# Preserved workstation configuration\n\n${reason}\n\n${entries.join('\n')}\n`,
    { mode: 0o600 },
  );
  return directory;
}
