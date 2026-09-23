// Hostnames, usernames, addresses, and machine identifiers below are synthetic fixtures.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  bondManifestDigest,
  canonicalHerdrTarget,
  canonicalJson,
  catalogMatchesApprovedProgress,
  catalogFingerprint,
  classifySshFailure,
  linuxPackageAction,
  listSshIdentities,
  normalizeName,
  parseArgs,
  parseCidr,
  parseRemoteLogin,
  proposalDigest,
  remediationDigest,
  reportReviewFingerprint,
  tailscaleCapabilities,
  validateAction,
  validateBondManifest,
  validateRemediation,
} from './setup-multi-herdr.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'setup-multi-herdr.mjs');

test('discovery arguments accept repeatable bounded scope', () => {
  const parsed = parseArgs([
    'discover', '--json', '--cidr', '192.168.50.0/24', '--cidr', '10.20.30.0/28',
    '--interface', 'en0', '--target', 'workbox', '--ssh-port', '2222',
    '--timeout-ms', '900', '--max-hosts', '700',
  ]);
  assert.equal(parsed.command, 'discover');
  assert.deepEqual(parsed.cidrs, ['192.168.50.0/24', '10.20.30.0/28']);
  assert.deepEqual(parsed.targets, ['workbox']);
  assert.equal(parsed.sshPort, 2222);
  assert.equal(parsed.maxHosts, 700);
});

test('preflight, doctor, and resolve arguments keep their scopes separate', () => {
  assert.deepEqual(parseArgs(['preflight', '--json']), {
    command: 'preflight', json: true, cidrs: [], interfaces: [], targets: [], sshPort: 22,
    timeoutMs: 700, maxHosts: 512, proposal: null, report: null, remediation: null,
    approve: null, dryRun: false, host: false, manifest: null,
  });
  assert.equal(parseArgs(['doctor', '--host', '--json']).host, true);
  assert.equal(parseArgs(['doctor', '--target', 'operator@workbox']).targets[0], 'operator@workbox');
  assert.equal(parseArgs([
    'resolve', '--report', 'private.json', '--remediation', 'remediation:ssh:abc',
    '--approve', `sha256:${'a'.repeat(64)}`,
  ]).command, 'resolve');
  for (const argv of [
    ['doctor'], ['doctor', '--host', '--target', 'workbox'], ['doctor', '--target', 'a', '--target', 'b'],
    ['resolve', '--report', 'private.json'], ['preflight', '--target', 'workbox'],
  ]) assert.throws(() => parseArgs(argv));
});

test('bond manifests normalize defaults and bind the confirmed machine list', () => {
  const input = {
    schema: 'setup-multi-herdr/manifest-v3',
    machines: [
      { target: 'user@host-a.example', label: 'host-a', identity: 'identity-a', identityFingerprint: 'SHA256:key-a' },
      { target: 'user@host-b.example', label: 'host-b', session: 'agents', identity: 'identity-b', identityFingerprint: 'SHA256:key-b' },
    ],
  };
  const normalized = validateBondManifest(input);
  assert.equal(normalized.hostKeyPolicy, 'accept-new');
  assert.equal(normalized.remoteSetup, 'install-or-update');
  assert.equal(normalized.machines[0].transport, 'ssh');
  assert.deepEqual(normalized.machines[0].bootstrap, { method: 'already-authorized' });
  assert.deepEqual(normalized.machines.map((item) => item.target), ['user@host-a.example', 'user@host-b.example']);
  assert.match(bondManifestDigest(input), /^sha256:[a-f0-9]{64}$/);
  assert.equal(bondManifestDigest(input), bondManifestDigest({ ...input, machines: [...input.machines].reverse() }));
  assert.throws(() => validateBondManifest({ ...input, machines: [...input.machines, input.machines[0]] }));
  assert.throws(() => validateBondManifest({ ...input, hostKeyPolicy: 'off' }));
  assert.throws(() => validateBondManifest({ ...input, approveEverything: true }));
  assert.throws(() => validateBondManifest({ ...input, remoteSetup: 'existing-only' }));
  assert.throws(() => validateBondManifest({
    ...input,
    machines: [{ target: 'user@host.example', label: 'host' }],
  }));
});

test('bond manifests bind management bootstrap and Tailscale transport', () => {
  const input = {
    schema: 'setup-multi-herdr/manifest-v3',
    remoteSetup: 'install-or-update',
    machines: [{
      target: 'root@server.tailnet.example', label: 'server', session: 'agents', identity: 'id-herdr',
      identityFingerprint: 'SHA256:herdr', transport: 'tailscale', allowServerStop: true,
      tailscale: { expectedIp: '100.64.0.10', ensureSsh: true },
      bootstrap: {
        method: 'management-identity', target: 'root@203.0.113.10',
        identityFile: '/private/iac/server_ed25519', identityFingerprint: 'SHA256:approved',
      },
    }],
  };
  const normalized = validateBondManifest(input);
  assert.equal(normalized.machines[0].transport, 'tailscale');
  assert.equal(normalized.machines[0].bootstrap.target, 'root@203.0.113.10');
  assert.notEqual(bondManifestDigest(input), bondManifestDigest({
    ...input,
    machines: [{ ...input.machines[0], bootstrap: { ...input.machines[0].bootstrap, target: 'root@203.0.113.11' } }],
  }));
  assert.throws(() => validateBondManifest({
    ...input,
    machines: [{ ...input.machines[0], bootstrap: { ...input.machines[0].bootstrap, identityFile: 'relative-key' } }],
  }));
  assert.throws(() => validateBondManifest({
    ...input,
    machines: [{ ...input.machines[0], bootstrap: { ...input.machines[0].bootstrap, identityFingerprint: null } }],
  }));
});

test('SSH identity discovery reports reusable pairs without private material', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-multi-herdr-identities-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const identity = path.join(directory, 'id-test');
  const generated = spawnSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', identity], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const found = listSshIdentities(directory);
  assert.deepEqual(found.map((item) => item.name), ['id-test']);
  assert.match(found[0].fingerprint, /^SHA256:/);
  assert.equal(Object.hasOwn(found[0], 'privateFile'), false);
});

test('arguments reject unsafe targets, bounds, and missing approval', () => {
  for (const argv of [
    ['discover', '--target', '-oProxyCommand=bad'],
    ['discover', '--target', 'user:password@host'],
    ['discover', '--max-hosts', '1025'],
    ['discover', '--timeout-ms', '20'],
    ['apply', '--proposal', 'report.json'],
    ['apply', '--proposal', 'report.json', '--approve', 'sha256:nope'],
    ['discover', '--unknown'],
  ]) assert.throws(() => parseArgs(argv));
});

test('private CIDR parsing is strict and deterministic', () => {
  assert.deepEqual(parseCidr('192.168.4.0/30'), {
    input: '192.168.4.0/30', prefix: 30, network: 3232236544,
    size: 4, first: 3232236545, last: 3232236546,
  });
  for (const cidr of ['8.8.8.0/24', '169.254.0.0/24', '192.168.1.0/31', '../bad']) {
    assert.throws(() => parseCidr(cidr));
  }
});

test('names are portable and do not pretend Local is configurable', () => {
  assert.equal(normalizeName('Build Box.example.test'), 'build-box');
  assert.equal(normalizeName('Developer’s Workstation'), 'developer-s-workstation');
  assert.equal(normalizeName('Local'), 'machine');
  assert.equal(normalizeName('***'), 'machine');
});

test('nonstandard SSH ports are retained in Herdr targets', () => {
  assert.equal(canonicalHerdrTarget('builder@workbox', 22), 'builder@workbox');
  assert.equal(canonicalHerdrTarget('builder@workbox', 2222), 'ssh://builder@workbox:2222');
  assert.equal(canonicalHerdrTarget('2001:db8::10', 2222), 'ssh://[2001:db8::10]:2222');
  assert.equal(canonicalHerdrTarget('ssh://builder@workbox:2200', 2200), 'ssh://builder@workbox:2200');
  assert.throws(() => canonicalHerdrTarget('ssh://workbox/remote-command', 22));
});

test('canonical proposal and catalog hashes ignore map and catalog order only', () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
  const a = { id: 'b', label: 'B', target: 'b', session: 'default', enabled: true, selected: false };
  const b = { id: 'a', label: 'A', target: 'a', session: 'default', enabled: true, selected: false };
  assert.equal(catalogFingerprint([a, b]), catalogFingerprint([b, a]));
  assert.notEqual(catalogFingerprint([a, b]), catalogFingerprint([a, { ...b, enabled: false }]));
  assert.equal(proposalDigest({ b: 2, a: 1 }), proposalDigest({ a: 1, b: 2 }));
});

test('opaque profile IDs and stable identities are validated without assuming an ID format', () => {
  assert.doesNotThrow(() => validateAction({ type: 'rename', profileId: 'profile_ulid-01J.test', label: 'Build box' }));
  assert.doesNotThrow(() => validateAction({
    type: 'add', target: 'ssh://builder@workbox:2222', port: 2222, label: 'Build box',
    session: 'default', identityToken: `sha256:${'a'.repeat(64)}`,
  }));
  assert.throws(() => validateAction({
    type: 'add', target: 'workbox', port: 22, label: 'Build box', session: 'default', identityToken: null,
  }));
  assert.throws(() => validateAction({ type: 'enable', profileId: '-unsafe', target: 'workbox', port: 22 }));
});

test('catalog drift accepts only progress described by approved actions', () => {
  const baseline = [
    { id: 'opaque-A', label: 'Old', target: 'oldbox', session: 'default', enabled: false, selected: false },
  ];
  const actions = [
    { type: 'rename', profileId: 'opaque-A', label: 'Renamed' },
    { type: 'enable', profileId: 'opaque-A', target: 'oldbox', port: 22 },
    { type: 'add', target: 'newbox', label: 'New', session: 'default' },
  ];
  const partial = [
    { ...baseline[0], label: 'Renamed', enabled: true },
    { id: 'server-generated-id', label: 'New', target: 'newbox', session: 'default', enabled: true, selected: false },
  ];
  assert.equal(catalogMatchesApprovedProgress(baseline, partial, actions), true);
  assert.equal(catalogMatchesApprovedProgress(baseline, [...partial, {
    id: 'unrelated', label: 'Other', target: 'other', session: 'default', enabled: true, selected: false,
  }], actions), false);
  assert.equal(catalogMatchesApprovedProgress(baseline, [...partial, {
    id: 'duplicate-add', label: 'New', target: 'newbox', session: 'default', enabled: true, selected: false,
  }], actions), false);
  assert.equal(catalogMatchesApprovedProgress(baseline, [{ ...baseline[0], target: 'changed' }], actions), false);
});

test('review fingerprint binds displayed evidence independently of generated time', () => {
  const report = {
    schema: 'setup-multi-herdr/v2', generatedAt: 'first', local: { proposedName: 'local-a' },
    scope: {}, existingProfiles: [], nodes: [{ proposedLabel: 'box' }], issues: [], remediations: [], blockers: [], limitations: [],
  };
  assert.equal(reportReviewFingerprint(report), reportReviewFingerprint({ ...report, generatedAt: 'second' }));
  assert.notEqual(reportReviewFingerprint(report), reportReviewFingerprint({
    ...report, nodes: [{ proposedLabel: 'tampered' }],
  }));
});

test('SSH failures retain causal stage and reason instead of generic attention', () => {
  const cases = [
    ['No ED25519 host key is known for workbox.\nHost key verification failed.', 'ssh.host-key.unknown', 'host-trust'],
    ['WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!', 'ssh.host-key.changed', 'host-trust'],
    ['ssh: Could not resolve hostname workbox: Name or service not known', 'network.dns-not-found', 'name-resolution'],
    ['ssh: connect to host workbox port 22: Connection refused', 'network.connection-refused', 'transport'],
    ['tailscale: access denied by policy', 'ssh.tailscale-policy-denied', 'authentication'],
    ['To authenticate, visit: https://login.tailscale.com/a/example', 'ssh.tailscale-check-required', 'authentication'],
    ['Permission denied (publickey).', 'ssh.authentication.rejected', 'authentication'],
    ['no matching host key type found. Their offer: ssh-rsa', 'ssh.algorithm-mismatch', 'ssh-negotiation'],
  ];
  for (const [stderr, reasonCode, stage] of cases) {
    const result = classifySshFailure({ code: 255, stdout: '', stderr, overflow: false, timedOut: false });
    assert.equal(result.reasonCode, reasonCode, stderr);
    assert.equal(result.stage, stage, stderr);
    assert.equal(result.herdr.state, 'not-checked');
  }
});

test('Linux and macOS host adapters preserve platform differences', () => {
  assert.deepEqual(linuxPackageAction('server', { ID: 'ubuntu' }), { manager: 'apt-get', args: ['install', 'openssh-server'] });
  assert.deepEqual(linuxPackageAction('client', { ID: 'fedora' }), { manager: 'dnf', args: ['install', 'openssh-clients'] });
  assert.deepEqual(linuxPackageAction('server', { ID: 'arch' }), { manager: 'pacman', args: ['-S', 'openssh'] });
  assert.equal(parseRemoteLogin('Remote Login: On'), 'on');
  assert.equal(parseRemoteLogin('Remote Login: Off'), 'off');
  assert.equal(parseRemoteLogin('administrator privileges required'), 'unknown');
  assert.deepEqual(tailscaleCapabilities('darwin', '/Applications/Tailscale.app/Contents/MacOS/Tailscale', false), {
    variant: 'gui-app', canHostTailscaleSsh: false, canUseSshWrapper: null,
  });
  assert.deepEqual(tailscaleCapabilities('darwin', '/usr/local/bin/tailscale', true), {
    variant: 'open-source-cli', canHostTailscaleSsh: true, canUseSshWrapper: true,
  });
});

test('remediation approval binds operation and target', () => {
  const base = {
    id: 'remediation:ssh.interactive-verify:abc', operation: 'ssh.interactive-verify',
    actor: 'local-user', disposition: 'interactive-user', requiresApproval: true, requiresTty: true,
    summary: 'Verify SSH', possibleChanges: ['user-known-hosts'], target: 'operator@workbox', port: 22, configMode: 'user',
  };
  const value = { ...base, digest: remediationDigest(base) };
  assert.doesNotThrow(() => validateRemediation(value));
  assert.throws(() => validateRemediation({ ...value, target: 'other' }));
  assert.throws(() => validateRemediation({ ...value, operation: 'shell.command' }));
});

test('client doctor preserves the destination user and offers a digest-bound interactive repair', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-multi-herdr-test-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ssh = path.join(directory, 'ssh');
  fs.writeFileSync(ssh, `#!/bin/sh
if [ "$1" = "-G" ]; then
  printf '%s\\n' 'hostname workbox.test' 'user remote-operator' 'port 22' 'proxyjump none' 'proxycommand none' 'identitiesonly yes'
  exit 0
fi
printf '%s\\n' 'Permission denied (publickey).' >&2
exit 255
`, { mode: 0o700 });
  const result = spawnSync(process.execPath, [script, 'doctor', '--target', 'workbox', '--json'], {
    encoding: 'utf8', env: { ...process.env, PATH: directory }, timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.route.reasonCode, 'ssh.authentication.rejected');
  assert.equal(report.route.effective.user, 'remote-operator');
  assert.equal(report.route.herdr.state, 'not-checked');
  assert.equal(report.remediations[0].operation, 'ssh.interactive-verify');
  assert.match(report.remediations[0].digest, /^sha256:[a-f0-9]{64}$/);

  const human = spawnSync(process.execPath, [script, 'doctor', '--target', 'workbox'], {
    encoding: 'utf8', env: { ...process.env, PATH: directory }, timeout: 10000,
  });
  assert.equal(human.status, 0, human.stderr);
  assert.doesNotMatch(human.stdout, /SSH attention required|Herdr unverified/i);
  assert.match(human.stdout, /non-interactive authentication was rejected/i);
});

test('resolver requires an exact digest and a real TTY before launching interactive SSH', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-multi-herdr-resolve-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ssh = path.join(directory, 'ssh');
  fs.writeFileSync(ssh, '#!/bin/sh\nexit 99\n', { mode: 0o700 });
  const base = {
    id: 'remediation:ssh.interactive-verify:test', operation: 'ssh.interactive-verify',
    actor: 'local-user', disposition: 'interactive-user', requiresApproval: true, requiresTty: true,
    summary: 'Verify SSH', possibleChanges: ['user-known-hosts'], target: 'operator@workbox', port: 22, configMode: 'user',
  };
  const action = { ...base, digest: remediationDigest(base) };
  const reportFile = path.join(directory, 'report.json');
  fs.writeFileSync(reportFile, JSON.stringify({ schema: 'setup-multi-herdr/v2', remediations: [action] }), { mode: 0o600 });
  const wrong = spawnSync(process.execPath, [
    script, 'resolve', '--report', reportFile, '--remediation', action.id, '--approve', `sha256:${'a'.repeat(64)}`,
  ], { encoding: 'utf8', env: { ...process.env, PATH: directory } });
  assert.equal(wrong.status, 4);
  assert.match(wrong.stderr, /approval digest does not match/i);

  const nonTty = spawnSync(process.execPath, [
    script, 'resolve', '--report', reportFile, '--remediation', action.id, '--approve', action.digest,
  ], { encoding: 'utf8', env: { ...process.env, PATH: directory } });
  assert.equal(nonTty.status, 4);
  assert.match(nonTty.stderr, /interactive terminal/i);
});

test('auto-discovered routes stay TCP-only until destination-user semantics are supplied', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-multi-herdr-auto-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sshMarker = path.join(directory, 'ssh-was-run');
  fs.writeFileSync(path.join(directory, 'ssh'), `#!/bin/sh\nprintf ran > ${sshMarker}\nexit 99\n`, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'herdr'), `#!/bin/sh
case "$*" in
  "--version") printf '%s\\n' 'herdr 0.9.0' ;;
  "machine --help") printf '%s\\n' 'saved SSH machines add list' ;;
  "machine list --json") printf '%s\\n' '[]' ;;
  *) exit 1 ;;
esac
`, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'tailscale'), `#!/bin/sh
printf '%s\\n' '{"BackendState":"Running","Peer":{"peer":{"ID":"peer-1","HostName":"candidate","DNSName":"","TailscaleIPs":["192.0.2.1"],"OS":"linux","Online":true}}}'
`, { mode: 0o700 });
  const result = spawnSync(process.execPath, [
    script, 'discover', '--json', '--interface', 'definitely-not-an-interface', '--ssh-port', '65534',
  ], { encoding: 'utf8', env: { ...process.env, PATH: directory }, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.nodes.length, 1);
  assert.match(report.nodes[0].routes[0].reasonCode, /^network\.(?:connection-refused|timeout|unreachable|unknown-failure)$/);
  assert.equal(report.nodes[0].routes[0].effective, null);
  assert.equal(fs.existsSync(sshMarker), false, 'auto-discovery must not invoke SSH with the source username');
});

test('an explicit authenticated target produces a separately digest-bound catalog proposal', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-multi-herdr-ready-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'herdr'), `#!/bin/sh
case "$*" in
  "--version") printf '%s\\n' 'herdr 0.9.0' ;;
  "machine --help") printf '%s\\n' 'saved SSH machines add list' ;;
  "machine list --json") printf '%s\\n' '[]' ;;
  *) exit 1 ;;
esac
`, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'ssh'), `#!/bin/sh
if [ "$1" = "-G" ]; then
  printf '%s\\n' 'hostname workbox.test' 'user remote-operator' 'port 22' 'proxyjump none' 'proxycommand none' 'identitiesonly yes'
  exit 0
fi
printf '%s\\n' 'SETUP_MULTI_HERDR_V1' 'os=Linux' 'arch=x86_64' 'hostname=workbox' 'machine_id=machine-1' 'tailscale_ip=' 'herdr_version=herdr 0.9.0' 'herdr_running=true'
`, { mode: 0o700 });
  const result = spawnSync(process.execPath, [
    script, 'discover', '--json', '--interface', 'definitely-not-an-interface', '--target', 'operator@workbox',
  ], { encoding: 'utf8', env: { ...process.env, PATH: directory }, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.outcome, 'catalog-actions-ready');
  assert.equal(report.nodes[0].routes[0].effective.user, 'remote-operator');
  assert.equal(report.nodes[0].routes[0].reasonCode, 'remote.herdr.running');
  assert.equal(report.proposal.approval.actions[0].type, 'add');
  assert.match(report.proposal.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(report.remediations.length, 0);
});

test('bond reconciles an approved manifest noninteractively with accept-new trust', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-multi-herdr-bond-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sshDirectory = path.join(directory, '.ssh');
  fs.mkdirSync(sshDirectory, { mode: 0o700 });
  const identity = path.join(sshDirectory, 'id-test');
  const generated = spawnSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', identity], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const foundFingerprint = listSshIdentities(sshDirectory)[0].fingerprint;
  const state = path.join(directory, 'catalog-created');
  const sshArgsFile = path.join(directory, 'ssh-args');
  fs.writeFileSync(path.join(directory, 'herdr'), `#!/bin/sh
case "$*" in
  "--version") printf '%s\n' 'herdr 0.9.1' ;;
  "machine --help") printf '%s\n' 'saved SSH machines add list' ;;
  "machine list --json")
    if [ -f "${state}" ]; then
      printf '%s\n' '[{"id":"profile-1","label":"workbox","target":"root@workbox","session":"default","enabled":true,"selected":false}]'
    else
      printf '%s\n' '[]'
    fi
    ;;
  "machine add root@workbox --label workbox") : > "${state}" ;;
  *) exit 1 ;;
esac
`, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'ssh'), `#!/bin/sh
if [ "$1" = "-G" ]; then
  printf '%s\n' 'hostname workbox' 'user root' 'port 22' 'proxyjump none' 'proxycommand none' 'identitiesonly yes'
  exit 0
fi
printf '%s\n' "$*" >> "${sshArgsFile}"
printf '%s\n' 'SETUP_MULTI_HERDR_V1' 'os=Linux' 'arch=x86_64' 'hostname=workbox' 'machine_id=machine-1' 'tailscale_ip=' 'herdr_version=herdr 0.9.1' 'herdr_running=true'
`, { mode: 0o700 });
  const manifest = {
    schema: 'setup-multi-herdr/manifest-v3',
    machines: [{ target: 'root@workbox', label: 'workbox', identity: 'id-test', identityFingerprint: foundFingerprint }],
  };
  const manifestFile = path.join(directory, 'manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest), { mode: 0o600 });
  const result = spawnSync(process.execPath, [
    script, 'bond', '--manifest', manifestFile, '--approve', bondManifestDigest(manifest), '--json',
  ], { encoding: 'utf8', env: { ...process.env, HOME: directory, PATH: `${directory}:${process.env.PATH}` }, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'bonded');
  assert.equal(report.machines[0].status, 'bonded');
  assert.equal(report.finalProfiles[0].target, 'root@workbox');
  assert.match(fs.readFileSync(sshArgsFile, 'utf8'), /StrictHostKeyChecking=accept-new/);
  assert.match(fs.readFileSync(sshArgsFile, 'utf8'), /IdentitiesOnly=yes/);
  assert.match(fs.readFileSync(sshArgsFile, 'utf8'), /id-test/);
  const sshInvocations = fs.readFileSync(sshArgsFile, 'utf8').trim().split('\n');
  assert.doesNotMatch(sshInvocations.at(-1), / -i /);
});

test('discovery stops before network work when local prerequisites are unavailable', () => {
  const result = spawnSync(process.execPath, [script, 'discover', '--json', '--interface', 'definitely-not-an-interface'], {
    encoding: 'utf8', env: { ...process.env, PATH: '' }, timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema, 'setup-multi-herdr/v2');
  assert.equal(report.outcome, 'prerequisite-blocked');
  assert.equal(report.local.herdr.installed, false);
  assert.equal(report.local.ssh.available, false);
  assert.deepEqual(report.nodes, []);
  assert.equal(report.scope.lanAddressCount, 0);
  assert.equal(report.proposal.approval, null);
  assert.equal(report.proposal.digest, null);
  assert.deepEqual(report.issues.map((item) => item.code).sort(), ['local.herdr.missing', 'local.ssh.client-missing']);
});
