import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';

export function validateKeyPath(value, { publicKey = false } = {}) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f"\\]/.test(value))
    throw new Error('Invalid SSH key path.');
  const name = path.basename(value);
  const pattern = publicKey
    ? /^id_[a-z0-9][a-z0-9_-]*\.pub$/
    : /^id_[a-z0-9][a-z0-9_-]*$/;
  if (!pattern.test(name))
    throw new Error(
      'SSH key filenames must use id_{persona-or-company}' +
        (publicKey ? '.pub' : '') +
        '. Preserve existing keys before migration.',
    );
  return value;
}

export function machineName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (
    !name ||
    name.length > 120 ||
    /[\x00-\x1f\x7f()]/.test(name) ||
    /^(macos|darwin|windows|linux|ubuntu|localhost|computer|hostname|unknown)(\.local)?$/i.test(
      name,
    ) ||
    /\.local$/i.test(name)
  ) {
    throw new Error(
      'Supply the proper human-readable machine name; OS names and hostname fallbacks are not accepted.',
    );
  }
  return name;
}

export function registrationTitle(name, date = new Date()) {
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('');
  return `${machineName(name)} (${day})`;
}

export function verifyKeyPair(value) {
  validateKeyPath(value);
  const privatePath = value.startsWith('~/')
    ? path.join(os.homedir(), value.slice(2))
    : path.resolve(value);
  const stat = fs.statSync(privatePath);
  if (
    !stat.isFile() ||
    stat.size > 1048576 ||
    (process.platform !== 'win32' && stat.mode & 0o077)
  )
    throw new Error('Private key must be a regular owner-only file.');
  const armor = fs
    .readFileSync(privatePath, 'utf8')
    .match(
      /^-----BEGIN OPENSSH PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+)-----END OPENSSH PRIVATE KEY-----\s*$/,
    );
  if (!armor)
    throw new Error(
      'Key-pair verification requires OpenSSH key format; review and preserve legacy keys before migration.',
    );
  const data = Buffer.from(armor[1].replace(/\s/g, ''), 'base64');
  const magic = Buffer.from('openssh-key-v1\0');
  if (!data.subarray(0, magic.length).equals(magic))
    throw new Error('Invalid OpenSSH key.');
  let offset = magic.length;
  const uint = () => {
    if (offset + 4 > data.length) throw new Error('Truncated key header.');
    const n = data.readUInt32BE(offset);
    offset += 4;
    return n;
  };
  const field = () => {
    const length = uint();
    if (length > data.length - offset) throw new Error('Truncated key header.');
    const result = data.subarray(offset, offset + length);
    offset += length;
    return result;
  };
  field();
  field();
  field();
  if (uint() !== 1)
    throw new Error('Expected a single public identity in the OpenSSH key.');
  const embedded = field();
  const publicParts = fs
    .readFileSync(privatePath + '.pub', 'utf8')
    .trim()
    .split(/\s+/);
  const publicBlob = Buffer.from(publicParts[1] ?? '', 'base64');
  if (
    embedded.length !== publicBlob.length ||
    !crypto.timingSafeEqual(embedded, publicBlob)
  )
    throw new Error('SSH public and private keys do not match.');
  if (
    publicBlob.length < 4 ||
    publicBlob.readUInt32BE(0) > publicBlob.length - 4 ||
    publicBlob.subarray(4, 4 + publicBlob.readUInt32BE(0)).toString() !==
      publicParts[0]
  )
    throw new Error('Public SSH key type does not match its encoded data.');
  return privatePath;
}

export function validateIdentityKeys(accounts, { requireFiles = false } = {}) {
  const material = new Map();
  for (const account of Object.values(accounts)) {
    const privatePath = account.sshKeyPath.startsWith('~/')
      ? path.join(os.homedir(), account.sshKeyPath.slice(2))
      : path.resolve(account.sshKeyPath);
    if (requireFiles) verifyKeyPair(privatePath);
    if (!fs.existsSync(privatePath + '.pub')) continue;
    const parts = fs
      .readFileSync(privatePath + '.pub', 'utf8')
      .trim()
      .split(/\s+/);
    const fingerprint = crypto
      .createHash('sha256')
      .update(Buffer.from(parts[1] ?? '', 'base64'))
      .digest('hex');
    const persona = `${account.gitName} <${account.gitEmail}>`;
    if (material.has(fingerprint) && material.get(fingerprint) !== persona)
      throw new Error(
        'Distinct personas must use different SSH key material, not merely different filenames.',
      );
    material.set(fingerprint, persona);
  }
}
