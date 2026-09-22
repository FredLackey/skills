#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SCHEMA = 'setup-multi-herdr/v2';
const MAX_OUTPUT = 1024 * 1024;
const MAX_PROPOSAL = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 700;
const DEFAULT_MAX_HOSTS = 512;
const MAX_EXPLICIT_HOSTS = 1024;
const MAX_TAILNET_PEERS = 512;
const CONCURRENCY = 28;
const VIRTUAL_INTERFACE = /^(tailscale|utun|tun|tap|wg|docker|br(?:-|\d)|veth|virbr|vmnet|vboxnet|zt|cni|podman|kube|flannel)/i;

const REMOTE_PROBE = String.raw`LC_ALL=C
printf '%s\n' 'SETUP_MULTI_HERDR_V1'
printf 'os=%s\n' "$(uname -s 2>/dev/null | tr -d '\r\n' | cut -c1-80)"
printf 'arch=%s\n' "$(uname -m 2>/dev/null | tr -d '\r\n' | cut -c1-80)"
printf 'hostname=%s\n' "$(hostname 2>/dev/null | tr -d '\r\n' | cut -c1-160)"
machine_id=''
if [ -r /etc/machine-id ]; then machine_id=$(sed -n '1p' /etc/machine-id 2>/dev/null)
elif [ -r /var/lib/dbus/machine-id ]; then machine_id=$(sed -n '1p' /var/lib/dbus/machine-id 2>/dev/null)
elif command -v ioreg >/dev/null 2>&1; then machine_id=$(ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | sed -n 's/.*"IOPlatformUUID" = "\([^"]*\)".*/\1/p' | sed -n '1p')
fi
printf 'machine_id=%s\n' "$(printf '%s' "$machine_id" | tr -cd 'A-Za-z0-9-_' | cut -c1-160)"
tail_ip=''
if command -v tailscale >/dev/null 2>&1; then tail_ip=$(tailscale ip -4 2>/dev/null | sed -n '1p'); fi
printf 'tailscale_ip=%s\n' "$(printf '%s' "$tail_ip" | tr -cd '0-9.' | cut -c1-48)"
herdr_bin=''
if command -v herdr >/dev/null 2>&1; then herdr_bin=$(command -v herdr)
else
  for candidate in "$HOME/.local/bin/herdr" "$HOME/.local/share/mise/shims/herdr" "$HOME/.nix-profile/bin/herdr" /opt/homebrew/bin/herdr /usr/local/bin/herdr /usr/bin/herdr /nix/var/nix/profiles/default/bin/herdr /run/current-system/sw/bin/herdr; do
    if [ -x "$candidate" ]; then herdr_bin=$candidate; break; fi
  done
fi
if [ -n "$herdr_bin" ]; then
  printf 'herdr_version=%s\n' "$("$herdr_bin" --version 2>/dev/null | sed -n '1p' | tr -d '\r\n' | cut -c1-160)"
  if "$herdr_bin" session list --json 2>/dev/null | tr -d '[:space:]' | grep -q '"running":true'; then
    printf '%s\n' 'herdr_running=true'
  elif "$herdr_bin" status server --json 2>/dev/null | tr -d '[:space:]' | grep -q '"running":true'; then
    printf '%s\n' 'herdr_running=true'
  else
    printf '%s\n' 'herdr_running=false'
  fi
else
  printf '%s\n' 'herdr_version='
  printf '%s\n' 'herdr_running=false'
fi`;

function usage() {
  return `Usage:
  setup-multi-herdr.mjs preflight [--json]
  setup-multi-herdr.mjs discover [--json] [--cidr CIDR]... [--interface NAME]...
    [--target SSH_TARGET]... [--ssh-port PORT] [--timeout-ms N] [--max-hosts N]
  setup-multi-herdr.mjs doctor --target SSH_TARGET [--ssh-port PORT] [--json]
  setup-multi-herdr.mjs doctor --host [--json]
  setup-multi-herdr.mjs resolve --report FILE --remediation ID --approve sha256:HEX
  setup-multi-herdr.mjs apply --proposal FILE --approve sha256:HEX [--dry-run]

preflight, discover, and doctor are read-only. Auto-discovered addresses remain
TCP-only candidates until an explicit target supplies remote-user semantics.
resolve performs exactly one digest-approved allowlisted repair, using the
user's terminal for every prompt. Run fresh discovery after any repair.
apply accepts only the exact digest-bound proposal emitted by discover and uses
the official interactive "herdr machine" commands.`;
}

export function parseArgs(argv) {
  const command = argv[0];
  if (!command || ['-h', '--help', 'help'].includes(command)) return { command: 'help' };
  if (!['preflight', 'discover', 'doctor', 'resolve', 'apply'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const options = {
    command, json: false, cidrs: [], interfaces: [], targets: [], sshPort: 22,
    timeoutMs: DEFAULT_TIMEOUT_MS, maxHosts: DEFAULT_MAX_HOSTS, proposal: null,
    report: null, remediation: null, approve: null, dryRun: false, host: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      return next;
    };
    if (arg === '--json') options.json = true;
    else if (arg === '--cidr') options.cidrs.push(value());
    else if (arg === '--interface') options.interfaces.push(value());
    else if (arg === '--target') options.targets.push(validateTarget(value()));
    else if (arg === '--ssh-port') options.sshPort = boundedInt(value(), 'ssh-port', 1, 65535);
    else if (arg === '--timeout-ms') options.timeoutMs = boundedInt(value(), 'timeout-ms', 100, 5000);
    else if (arg === '--max-hosts') options.maxHosts = boundedInt(value(), 'max-hosts', 1, MAX_EXPLICIT_HOSTS);
    else if (arg === '--proposal') options.proposal = value();
    else if (arg === '--report') options.report = value();
    else if (arg === '--remediation') options.remediation = value();
    else if (arg === '--approve') options.approve = value();
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--host') options.host = true;
    else if (arg === '--help' || arg === '-h') return { command: 'help' };
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (['preflight', 'discover', 'doctor'].includes(command) &&
      (options.proposal || options.report || options.remediation || options.approve || options.dryRun)) {
    throw new Error('mutation-only options were supplied to a read-only command');
  }
  if (command === 'preflight' && (options.cidrs.length || options.interfaces.length || options.targets.length || options.host ||
      options.sshPort !== 22 || options.timeoutMs !== DEFAULT_TIMEOUT_MS || options.maxHosts !== DEFAULT_MAX_HOSTS)) {
    throw new Error('discovery or doctor options were supplied to preflight');
  }
  if (command === 'discover' && options.host) throw new Error('--host is valid only with doctor');
  if (command === 'doctor') {
    if (options.host === (options.targets.length > 0)) throw new Error('doctor requires exactly one of --host or --target');
    if (options.targets.length > 1) throw new Error('doctor accepts only one --target');
    if (options.cidrs.length || options.interfaces.length || options.maxHosts !== DEFAULT_MAX_HOSTS || options.timeoutMs !== DEFAULT_TIMEOUT_MS) {
      throw new Error('scan options were supplied to doctor');
    }
  }
  if (command === 'resolve') {
    if (!options.report || !options.remediation || !options.approve) {
      throw new Error('resolve requires --report, --remediation, and --approve');
    }
    if (options.proposal || options.json || options.cidrs.length || options.interfaces.length || options.targets.length || options.host ||
        options.dryRun || options.sshPort !== 22 || options.timeoutMs !== DEFAULT_TIMEOUT_MS || options.maxHosts !== DEFAULT_MAX_HOSTS) {
      throw new Error('unrelated options were supplied to resolve');
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(options.approve)) throw new Error('invalid approval digest');
  }
  if (command === 'apply') {
    if (!options.proposal || !options.approve) throw new Error('apply requires --proposal and --approve');
    if (options.report || options.remediation || options.host || options.json || options.cidrs.length || options.interfaces.length || options.targets.length ||
        options.sshPort !== 22 || options.timeoutMs !== DEFAULT_TIMEOUT_MS || options.maxHosts !== DEFAULT_MAX_HOSTS) {
      throw new Error('discovery options were supplied to apply');
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(options.approve)) throw new Error('invalid approval digest');
  }
  return options;
}

function boundedInt(value, label, minimum, maximum) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an integer`);
  const result = Number(value);
  if (result < minimum || result > maximum) throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  return result;
}

function validateTarget(value) {
  if (!value || value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value) || /^-/.test(value)) {
    throw new Error(`Unsafe SSH target: ${JSON.stringify(value)}`);
  }
  const authority = value.startsWith('ssh://') ? value.slice(6) : value;
  const at = authority.lastIndexOf('@');
  if (at >= 0 && authority.slice(0, at).includes(':')) throw new Error('SSH targets must not contain passwords');
  if (/\s/.test(value)) throw new Error('SSH targets must not contain whitespace');
  return value;
}

function clean(value, limit = 160) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, limit);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function localCEnv(extra = {}) {
  return { ...process.env, LANG: 'C', LC_ALL: 'C', ...extra };
}

export function remediationDigest(remediation) {
  const { digest: _digest, ...approval } = remediation;
  return sha(canonicalJson(approval));
}

function remediation(operation, fields) {
  const scope = canonicalJson({ operation, target: fields.target ?? null, unit: fields.unit ?? null });
  const value = {
    id: `remediation:${operation}:${sha(scope).slice(7, 19)}`,
    operation,
    actor: fields.actor ?? 'local-user',
    disposition: fields.disposition ?? 'interactive-user',
    requiresApproval: true,
    requiresTty: fields.requiresTty !== false,
    summary: clean(fields.summary, 300),
    possibleChanges: fields.possibleChanges ?? [],
    ...fields,
  };
  value.digest = remediationDigest(value);
  return value;
}

function issue(code, stage, summary, fields = {}) {
  const scope = fields.scope ?? null;
  return {
    id: fields.id ?? `issue:${code}:${sha(canonicalJson({ code, scope, summary })).slice(7, 19)}`,
    code, stage, scope, severity: fields.severity ?? 'blocking',
    confidence: fields.confidence ?? 'observed',
    actor: fields.actor ?? 'local-user',
    summary: clean(summary, 300),
    detail: clean(fields.detail ?? '', 500),
    remediationIds: fields.remediationIds ?? [],
  };
}

export function catalogFingerprint(profiles) {
  const normalized = profiles.map(({ id, label, target, session, enabled, selected }) => ({
    id, label, target, session, enabled: Boolean(enabled), selected: Boolean(selected),
  })).sort((a, b) => a.id.localeCompare(b.id));
  return sha(canonicalJson(normalized));
}

export function proposalDigest(approval) {
  return sha(canonicalJson(approval));
}

function findExecutable(name) {
  const suffixes = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  for (const directory of String(process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    for (const suffix of suffixes) {
      const candidate = path.join(directory, `${name}${suffix}`);
      try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* continue */ }
    }
  }
  if (name === 'tailscale') {
    const extra = process.platform === 'darwin'
      ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale']
      : process.platform === 'win32'
        ? [path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe')]
        : [];
    for (const candidate of extra) {
      try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* continue */ }
    }
  }
  return null;
}

function run(command, args, { timeoutMs = 5000, maxOutput = MAX_OUTPUT, env = process.env } = {}) {
  return new Promise((resolve) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let overflow = false;
    const child = spawn(command, args, { shell: false, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), overflow, ...result });
    };
    const append = (current, chunk) => {
      if (current.length + chunk.length > maxOutput) {
        overflow = true;
        child.kill('SIGKILL');
        return current;
      }
      return Buffer.concat([current, chunk]);
    };
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.on('error', (error) => finish({ code: null, error, timedOut: false }));
    child.on('close', (code, signal) => finish({ code, signal, timedOut: false }));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ code: null, signal: 'SIGKILL', timedOut: true });
    }, timeoutMs);
  });
}

async function detectHerdrInstallMethod(executable) {
  let resolved = executable;
  try { resolved = fs.realpathSync(executable); } catch { /* retain the executable path */ }
  const normalized = resolved.replaceAll('\\', '/');
  if (normalized.includes('/Cellar/')) return 'homebrew';
  if (normalized.includes('/.local/share/mise/') || normalized.includes('/mise/installs/')) return 'mise';
  if (normalized.startsWith('/nix/store/')) return 'nix';
  const packageChecks = process.platform === 'linux' ? [
    ['pacman', ['-Qo', executable], 'pacman'],
    ['dpkg-query', ['-S', executable], 'dpkg'],
    ['rpm', ['-qf', executable], 'rpm'],
  ] : [];
  for (const [command, args, method] of packageChecks) {
    const packageExecutable = findExecutable(command);
    if (!packageExecutable) continue;
    const result = await run(packageExecutable, args, { timeoutMs: 2000, maxOutput: 64 * 1024 });
    if (result.code === 0 && !result.overflow) return method;
  }
  return 'direct-or-manual';
}

async function inspectHerdr({ includeInstallMethod = true } = {}) {
  const executable = findExecutable('herdr');
  if (!executable) return {
    installed: false, executable: null, version: null, installMethod: null,
    machineCommandAvailable: false, machineSupported: false,
    catalogState: 'not-installed', catalogError: null, profiles: [],
  };
  const versionResult = await run(executable, ['--version']);
  const version = versionResult.code === 0 ? clean(versionResult.stdout.trim()) : null;
  const helpResult = await run(executable, ['machine', '--help']);
  const machineCommandAvailable = helpResult.code === 0 &&
    /saved SSH machines|machine\s+(?:add|list)|\badd\b[\s\S]*\blist\b/i.test(`${helpResult.stdout}\n${helpResult.stderr}`);
  const listResult = await run(executable, ['machine', 'list', '--json']);
  let profiles = [];
  let machineSupported = false;
  let catalogError = null;
  if (listResult.code === 0 && !listResult.overflow) {
    try {
      const parsed = JSON.parse(listResult.stdout);
      if (Array.isArray(parsed) && parsed.every(validProfile)) {
        profiles = parsed.map(normalizeProfile);
        machineSupported = true;
      } else catalogError = 'machine list returned an unexpected shape';
    } catch { catalogError = 'machine list returned invalid JSON'; }
  } else if (listResult.overflow) {
    catalogError = 'machine list output exceeded the safety limit';
  } else {
    catalogError = machineCommandAvailable ? 'machine list failed' : 'machine command unavailable';
  }
  return {
    installed: true, executable, version,
    installMethod: includeInstallMethod ? await detectHerdrInstallMethod(executable) : null,
    machineCommandAvailable, machineSupported,
    catalogState: machineSupported ? 'ok' : machineCommandAvailable ? 'catalog-unavailable' : 'unsupported-version',
    catalogError, profiles,
  };
}

function readOsRelease() {
  if (process.platform !== 'linux') return {};
  let text;
  try { text = fs.readFileSync('/etc/os-release', 'utf8'); } catch { return {}; }
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, '').slice(0, 160);
  }
  return values;
}

export function linuxPackageAction(kind, osRelease = readOsRelease()) {
  const ids = `${osRelease.ID ?? ''} ${osRelease.ID_LIKE ?? ''}`.toLowerCase();
  if (/\b(debian|ubuntu)\b/.test(ids)) return {
    manager: 'apt-get', args: ['install', kind === 'client' ? 'openssh-client' : 'openssh-server'],
  };
  if (/\b(fedora|rhel|centos)\b/.test(ids)) return {
    manager: 'dnf', args: ['install', kind === 'client' ? 'openssh-clients' : 'openssh-server'],
  };
  if (/\barch\b/.test(ids)) return { manager: 'pacman', args: ['-S', 'openssh'] };
  if (/\b(suse|opensuse)\b/.test(ids)) return { manager: 'zypper', args: ['install', 'openssh'] };
  return null;
}

async function preflightReport() {
  const herdr = await inspectHerdr();
  const sshExecutable = findExecutable('ssh');
  const issues = [];
  const remediations = [];
  if (!sshExecutable) {
    let remediationIds = [];
    if (process.platform === 'linux') {
      const packageAction = linuxPackageAction('client');
      if (packageAction && findExecutable(packageAction.manager)) {
        const action = remediation('linux.install-openssh-client', {
          actor: 'local-user', summary: `Install ${packageAction.args.at(-1)} with ${packageAction.manager}.`,
          possibleChanges: ['system-packages'], manager: packageAction.manager, args: packageAction.args,
        });
        remediations.push(action);
        remediationIds = [action.id];
      }
    }
    issues.push(issue('local.ssh.client-missing', 'client-prerequisite',
      'The OpenSSH client is not installed, so remote machines cannot be checked.', { remediationIds }));
  }
  if (!herdr.installed) {
    const remediationIds = [];
    const brew = findExecutable('brew');
    if (brew) {
      const action = remediation('homebrew.install-herdr', {
        actor: 'local-user', summary: 'Install Herdr with the existing Homebrew installation.',
        possibleChanges: ['homebrew-packages'], executable: brew,
      });
      remediations.push(action);
      remediationIds.push(action.id);
    }
    const mise = findExecutable('mise');
    if (mise) {
      const action = remediation('mise.install-or-update-herdr', {
        actor: 'local-user', summary: 'Install the current Herdr release as a global mise tool.',
        possibleChanges: ['mise-global-tools'], executable: mise,
      });
      remediations.push(action);
      remediationIds.push(action.id);
    }
    issues.push(issue('local.herdr.missing', 'client-prerequisite',
      'Herdr is not installed locally, so native multi-machine setup cannot continue.', {
        remediationIds,
        detail: remediationIds.length
          ? 'Approve the Homebrew action, or choose another supported installation method from the Herdr guide.'
          : 'Choose a supported installation method from the Herdr guide; the helper will not guess package ownership.',
      }));
  } else if (!herdr.machineCommandAvailable) {
    let remediationIds = [];
    if (herdr.installMethod === 'homebrew' && findExecutable('brew')) {
      const action = remediation('homebrew.upgrade-herdr', {
        actor: 'local-user', summary: 'Upgrade the Homebrew-managed Herdr installation.',
        possibleChanges: ['homebrew-packages'], executable: findExecutable('brew'),
      });
      remediations.push(action);
      remediationIds = [action.id];
    } else if (herdr.installMethod === 'mise' && findExecutable('mise')) {
      const action = remediation('mise.install-or-update-herdr', {
        actor: 'local-user', summary: 'Update the mise-managed Herdr installation.',
        possibleChanges: ['mise-global-tools'], executable: findExecutable('mise'),
      });
      remediations.push(action);
      remediationIds = [action.id];
    }
    issues.push(issue('local.herdr.multi-machine-unsupported', 'client-prerequisite',
      `The installed Herdr${herdr.version ? ` (${herdr.version})` : ''} does not expose native multi-machine commands.`, {
        remediationIds,
        detail: remediationIds.length
          ? 'Use the detected package owner to update Herdr, then run preflight again.'
          : `Installation ownership is ${herdr.installMethod ?? 'unknown'}; choose its supported updater explicitly.`,
      }));
  } else if (!herdr.machineSupported) {
    issues.push(issue('local.herdr.catalog-unavailable', 'client-prerequisite',
      `Herdr exposes multi-machine commands, but its saved-machine catalog could not be read: ${herdr.catalogError}.`, {
        actor: 'local-user', detail: 'Resolve the local catalog or permission error before scanning the network.',
      }));
  }
  if (!['linux', 'darwin'].includes(process.platform)) {
    issues.push(issue('local.platform.unsupported', 'client-prerequisite',
      'Native multi-machine Herdr setup is supported only from Linux or macOS.', { actor: 'local-user' }));
  }
  return {
    schema: SCHEMA, kind: 'preflight', generatedAt: new Date().toISOString(),
    outcome: issues.length ? 'prerequisite-blocked' : 'ready',
    local: {
      platform: process.platform, arch: process.arch, hostname: clean(os.hostname()),
      ssh: { available: Boolean(sshExecutable), executable: sshExecutable },
      herdr: {
        installed: herdr.installed, executable: herdr.executable, version: herdr.version,
        installMethod: herdr.installMethod, machineCommandAvailable: herdr.machineCommandAvailable,
        machineSupported: herdr.machineSupported, catalogState: herdr.catalogState,
        catalogError: herdr.catalogError,
      },
    },
    issues, remediations,
  };
}

function validProfile(value) {
  return value && typeof value === 'object' && typeof value.id === 'string' &&
    typeof value.label === 'string' && typeof value.target === 'string' && typeof value.session === 'string' &&
    safeTarget(value.target);
}

function safeTarget(value) {
  try { validateTarget(value); parseTarget(value); return true; } catch { return false; }
}

function normalizeProfile(value) {
  return {
    id: clean(value.id, 128), label: clean(value.label, 128), target: clean(value.target, 1024),
    session: clean(value.session, 128), enabled: Boolean(value.enabled), selected: Boolean(value.selected),
  };
}

async function inspectTailscale() {
  const executable = findExecutable('tailscale');
  if (!executable) return { state: 'not-installed', executable: null, capabilities: null, self: null, peers: [] };
  const capabilities = tailscaleCapabilities(process.platform, executable, Boolean(findExecutable('tailscaled')));
  const env = executable.includes('/Applications/Tailscale.app/')
    ? { ...process.env, TAILSCALE_BE_CLI: '1' } : process.env;
  const result = await run(executable, ['status', '--json'], { env, maxOutput: MAX_OUTPUT });
  if (result.code !== 0 || result.overflow) {
    return { state: 'daemon-unavailable', executable, capabilities, self: null, peers: [] };
  }
  let status;
  try { status = JSON.parse(result.stdout); } catch { return { state: 'malformed-status', executable, capabilities, self: null, peers: [] }; }
  const state = status.BackendState === 'Running' ? 'running' : 'logged-out-or-stopped';
  const normalizePeer = (peer) => ({
    internalId: clean(peer?.ID ?? peer?.NodeID ?? peer?.PublicKey ?? peer?.DNSName, 256),
    hostName: clean(peer?.HostName, 160),
    dnsName: clean(peer?.DNSName, 253).replace(/\.$/, ''),
    addresses: Array.isArray(peer?.TailscaleIPs) ? peer.TailscaleIPs.map((item) => clean(item, 80)) : [],
    os: clean(peer?.OS, 40), online: peer?.Online === true,
  });
  const self = status.Self ? normalizePeer(status.Self) : null;
  const rawPeers = Array.isArray(status.Peer) ? status.Peer : Object.values(status.Peer ?? {});
  if (rawPeers.length > MAX_TAILNET_PEERS) {
    return { state: 'peer-cap-exceeded', executable, capabilities, self, peers: [] };
  }
  return { state, executable, capabilities, self, peers: rawPeers.map(normalizePeer) };
}

export function tailscaleCapabilities(platform, executable, hasTailscaled = false) {
  if (platform === 'darwin') return executable.includes('/Applications/Tailscale.app/')
    ? { variant: 'gui-app', canHostTailscaleSsh: false, canUseSshWrapper: null }
    : { variant: hasTailscaled ? 'open-source-cli' : 'cli-unknown', canHostTailscaleSsh: hasTailscaled, canUseSshWrapper: true };
  if (platform === 'linux') return { variant: 'linux-cli', canHostTailscaleSsh: true, canUseSshWrapper: true };
  return { variant: 'other', canHostTailscaleSsh: false, canUseSshWrapper: true };
}

export function parseRemoteLogin(output) {
  if (/Remote Login:\s*On/i.test(output)) return 'on';
  if (/Remote Login:\s*Off/i.test(output)) return 'off';
  return 'unknown';
}

function ipv4ToInt(value) {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
}

function intToIpv4(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function isPrivateIpv4(value) {
  const ip = ipv4ToInt(value);
  if (ip === null) return false;
  return (ip >= ipv4ToInt('10.0.0.0') && ip <= ipv4ToInt('10.255.255.255')) ||
    (ip >= ipv4ToInt('172.16.0.0') && ip <= ipv4ToInt('172.31.255.255')) ||
    (ip >= ipv4ToInt('192.168.0.0') && ip <= ipv4ToInt('192.168.255.255'));
}

function maskToPrefix(mask) {
  const value = ipv4ToInt(mask);
  if (value === null) return null;
  const bits = value.toString(2).padStart(32, '0');
  if (!/^1*0*$/.test(bits)) return null;
  return bits.indexOf('0') < 0 ? 32 : bits.indexOf('0');
}

export function parseCidr(value) {
  const match = /^([^/]+)\/(\d{1,2})$/.exec(value);
  if (!match) throw new Error(`Invalid IPv4 CIDR: ${value}`);
  const rawIp = ipv4ToInt(match[1]);
  const prefix = Number(match[2]);
  if (rawIp === null || prefix < 8 || prefix > 30 || !isPrivateIpv4(match[1])) {
    throw new Error(`CIDR must be private IPv4 with prefix /8 through /30: ${value}`);
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (rawIp & mask) >>> 0;
  const size = 2 ** (32 - prefix);
  return { input: value, prefix, network, size, first: network + 1, last: network + size - 2 };
}

function cidrAddresses(cidr, cap) {
  const parsed = parseCidr(cidr);
  const hosts = parsed.size - 2;
  if (hosts > cap) throw new Error(`${cidr} contains ${hosts} hosts, above --max-hosts ${cap}`);
  return Array.from({ length: hosts }, (_, index) => intToIpv4(parsed.first + index));
}

function localNetworkPlan(options, interfaces = os.networkInterfaces()) {
  const addresses = new Set();
  const selfAddresses = new Set();
  const scopes = [];
  for (const [name, records] of Object.entries(interfaces)) {
    for (const record of records ?? []) {
      if (record.family === 'IPv4' || record.family === 4) selfAddresses.add(record.address);
      if (!(record.family === 'IPv4' || record.family === 4) || record.internal || !isPrivateIpv4(record.address)) continue;
      const explicitlySelected = options.interfaces.includes(name);
      if (!explicitlySelected && VIRTUAL_INTERFACE.test(name)) continue;
      if (options.interfaces.length && !explicitlySelected) continue;
      const prefix = Number.isInteger(record.prefixLength) ? record.prefixLength : maskToPrefix(record.netmask);
      if (prefix === null || prefix >= 31) continue;
      const effectivePrefix = prefix < 24 ? 24 : prefix;
      const ip = ipv4ToInt(record.address);
      const mask = (0xffffffff << (32 - effectivePrefix)) >>> 0;
      const network = (ip & mask) >>> 0;
      const cidr = `${intToIpv4(network)}/${effectivePrefix}`;
      const candidates = cidrAddresses(cidr, options.maxHosts);
      for (const candidate of candidates) {
        if (!addresses.has(candidate) && addresses.size >= options.maxHosts) {
          throw new Error(`combined LAN scope exceeds --max-hosts ${options.maxHosts}`);
        }
        addresses.add(candidate);
      }
      scopes.push({ interface: clean(name, 80), sourceCidr: `${record.address}/${prefix}`, scannedCidr: cidr, truncated: prefix < 24 });
    }
  }
  for (const cidr of options.cidrs) {
    for (const candidate of cidrAddresses(cidr, options.maxHosts)) {
      if (!addresses.has(candidate) && addresses.size >= options.maxHosts) {
        throw new Error(`combined LAN scope exceeds --max-hosts ${options.maxHosts}`);
      }
      addresses.add(candidate);
    }
    scopes.push({ interface: null, sourceCidr: cidr, scannedCidr: cidr, truncated: false, explicit: true });
  }
  for (const address of selfAddresses) addresses.delete(address);
  return { addresses: [...addresses], selfAddresses, scopes };
}

async function neighborAddresses() {
  const spec = process.platform === 'linux' ? ['ip', ['neigh']]
    : process.platform === 'darwin' ? ['arp', ['-an']]
      : process.platform === 'win32' ? ['arp', ['-a']] : null;
  if (!spec || !findExecutable(spec[0])) return [];
  const result = await run(findExecutable(spec[0]), spec[1], { timeoutMs: 2000, maxOutput: 256 * 1024 });
  if (result.code !== 0) return [];
  const text = process.platform === 'linux'
    ? result.stdout.split(/\r?\n/).filter((line) => {
      const device = /\bdev\s+(\S+)/.exec(line)?.[1];
      return !device || !VIRTUAL_INTERFACE.test(device);
    }).join('\n')
    : result.stdout;
  const found = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
  return [...new Set(found.filter(isPrivateIpv4))].slice(0, DEFAULT_MAX_HOSTS);
}

function cidrContains(cidr, address) {
  const parsed = parseCidr(cidr);
  const candidate = ipv4ToInt(address);
  return candidate !== null && candidate >= parsed.first && candidate <= parsed.last;
}

function parseTarget(target, defaultPort = 22) {
  if (target.startsWith('ssh://')) {
    const url = new URL(target);
    if (url.protocol !== 'ssh:' || url.password || !url.hostname || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
      throw new Error(`Invalid SSH target: ${target}`);
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return { original: target, host, user: url.username || null, port: Number(url.port || defaultPort), alias: false };
  }
  const at = target.lastIndexOf('@');
  const user = at >= 0 ? target.slice(0, at) : null;
  const host = at >= 0 ? target.slice(at + 1) : target;
  return { original: target, host, user, port: defaultPort, alias: ipv4ToInt(host) === null && net.isIP(host) === 0 };
}

export function canonicalHerdrTarget(target, port = 22) {
  const parsed = parseTarget(target, port);
  if (target.startsWith('ssh://') || port === 22) return target;
  const host = net.isIP(parsed.host) === 6 ? `[${parsed.host}]` : parsed.host;
  return `ssh://${parsed.user ? `${parsed.user}@` : ''}${host}:${port}`;
}

function sshArgs(target, defaultPort, remoteProgram) {
  const parsed = parseTarget(target, defaultPort);
  const destination = parsed.user ? `${parsed.user}@${parsed.host}` : parsed.host;
  return [
    '-v', '-T', '-S', 'none', '-o', 'BatchMode=yes', '-o', 'NumberOfPasswordPrompts=0',
    '-o', 'KbdInteractiveAuthentication=no', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'UpdateHostKeys=no', '-o', 'ClearAllForwardings=yes',
    '-o', 'PermitLocalCommand=no', '-o', 'RemoteCommand=none',
    '-o', 'ConnectTimeout=3', '-o', 'ConnectionAttempts=1',
    ...(parsed.port !== 22 ? ['-p', String(parsed.port)] : []), destination, remoteProgram,
  ];
}

async function inspectSshConfig(target, defaultPort, sshExecutable) {
  const parsed = parseTarget(target, defaultPort);
  const destination = parsed.user ? `${parsed.user}@${parsed.host}` : parsed.host;
  const result = await run(sshExecutable, [
    '-G', ...(parsed.port !== 22 ? ['-p', String(parsed.port)] : []), destination,
  ], { timeoutMs: 3000, maxOutput: 256 * 1024, env: localCEnv() });
  if (result.code !== 0 || result.overflow || result.timedOut) return { ok: false, result };
  const allowed = new Set(['hostname', 'user', 'port', 'proxyjump', 'proxycommand', 'identitiesonly', 'hostkeyalias']);
  const values = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const index = line.indexOf(' ');
    if (index <= 0) continue;
    const key = line.slice(0, index).toLowerCase();
    if (allowed.has(key)) values[key] = clean(line.slice(index + 1), 1024);
  }
  return {
    ok: true,
    effective: {
      hostname: values.hostname || parsed.host,
      user: values.user || parsed.user,
      port: Number(values.port || parsed.port),
      proxyConfigured: Boolean((values.proxyjump && values.proxyjump !== 'none') || (values.proxycommand && values.proxycommand !== 'none')),
      identitiesOnly: values.identitiesonly === 'yes',
      hostKeyAlias: values.hostkeyalias && values.hostkeyalias !== 'none' ? values.hostkeyalias : null,
    },
  };
}

async function inspectSshAgent() {
  const executable = process.platform === 'darwin' && fs.existsSync('/usr/bin/ssh-add')
    ? '/usr/bin/ssh-add' : findExecutable('ssh-add');
  if (!executable) return { state: 'tool-unavailable', identityCount: null };
  const result = await run(executable, ['-l'], { timeoutMs: 2000, maxOutput: 64 * 1024, env: localCEnv() });
  if (result.code === 0) return {
    state: 'available', identityCount: result.stdout.split(/\r?\n/).filter(Boolean).length,
  };
  if (result.code === 2 || /Could not open a connection to your authentication agent/i.test(result.stderr)) {
    return { state: 'unavailable', identityCount: null };
  }
  if (/The agent has no identities/i.test(`${result.stdout}\n${result.stderr}`) || result.code === 1) {
    return { state: 'empty', identityCount: 0 };
  }
  return { state: 'unknown', identityCount: null };
}

function tcpProbe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let done = false;
    const finish = (state, errorCode = null) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ state, errorCode });
    };
    socket.setTimeout(timeoutMs, () => finish('timed-out', 'ETIMEDOUT'));
    socket.once('connect', () => finish('open'));
    socket.once('error', (error) => {
      const states = {
        ENOTFOUND: 'dns-not-found', EAI_AGAIN: 'dns-temporary-failure', ECONNREFUSED: 'refused',
        ETIMEDOUT: 'timed-out', EHOSTUNREACH: 'host-unreachable', ENETUNREACH: 'network-unreachable',
      };
      finish(states[error.code] ?? 'failed', clean(error.code, 40) || null);
    });
  });
}

export function classifySshFailure(result, tcp = { state: 'not-tested', errorCode: null }) {
  const diagnostic = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const base = { state: 'ssh-blocked', authenticated: false, tcp, herdr: { state: 'not-checked' } };
  if (result.overflow) return { ...base, stage: 'remote-command', reasonCode: 'ssh.output-overflow', summary: 'SSH diagnostic output exceeded the safety limit.' };
  if (result.timedOut) return { ...base, stage: 'transport', reasonCode: 'network.timeout', summary: 'The SSH connection or handshake timed out.' };
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(diagnostic)) return { ...base, stage: 'host-trust', reasonCode: 'ssh.host-key.changed', summary: 'The stored SSH host key conflicts with the key now presented. Verify the change independently; do not remove it automatically.' };
  if (/WARNING: REVOKED HOST KEY|host key .* revoked/i.test(diagnostic)) return { ...base, stage: 'host-trust', reasonCode: 'ssh.host-key.revoked', summary: 'SSH rejected a revoked host key. This requires administrator or security review.' };
  if (/No .* host key is known for|Host key verification failed/i.test(diagnostic)) return { ...base, stage: 'host-trust', reasonCode: 'ssh.host-key.unknown', summary: 'SSH does not yet trust this host key. Verify its fingerprint before accepting it interactively.' };
  if (/Could not resolve hostname|Name or service not known|nodename nor servname provided/i.test(diagnostic)) return { ...base, stage: 'name-resolution', reasonCode: 'network.dns-not-found', summary: 'The SSH hostname did not resolve.' };
  if (/Temporary failure in name resolution/i.test(diagnostic)) return { ...base, stage: 'name-resolution', reasonCode: 'network.dns-temporary-failure', summary: 'Name resolution failed temporarily.' };
  if (/Connection refused/i.test(diagnostic)) return { ...base, stage: 'transport', reasonCode: 'network.connection-refused', summary: 'The target answered, but no SSH service accepted this port.' };
  if (/No route to host|Network is unreachable/i.test(diagnostic)) return { ...base, stage: 'transport', reasonCode: 'network.unreachable', summary: 'No working network route to the SSH target was found.' };
  if (/Connection timed out|Operation timed out/i.test(diagnostic)) return { ...base, stage: 'transport', reasonCode: 'network.timeout', summary: 'The SSH connection timed out; the machine, route, firewall, or policy may be unavailable.' };
  if (/Bad configuration option|terminating, .* bad configuration|Could not open user '.*' config file/i.test(diagnostic)) return { ...base, stage: 'effective-config', reasonCode: 'ssh.config.invalid', summary: 'OpenSSH could not evaluate the selected SSH configuration.' };
  if (/no matching (?:host key type|key exchange method|cipher) found|no mutual signature algorithm/i.test(diagnostic)) return { ...base, stage: 'ssh-negotiation', reasonCode: 'ssh.algorithm-mismatch', summary: 'The client and server could not agree on a secure SSH algorithm; update the obsolete side.' };
  if (/login\.tailscale\.com\/a\/|tailscale\.com\/a\/|verification code|reauthenticate|additional check/i.test(diagnostic)) return { ...base, stage: 'authentication', reasonCode: 'ssh.tailscale-check-required', summary: 'Tailscale SSH requires an interactive identity check.' };
  if (/tailscale:.*(?:access denied|not allowed|denied by policy)/i.test(diagnostic)) return { ...base, stage: 'authentication', reasonCode: 'ssh.tailscale-policy-denied', summary: 'The tailnet policy does not permit this source, target, or destination OS user.' };
  if (/Too many authentication failures/i.test(diagnostic)) return { ...base, stage: 'authentication', reasonCode: 'ssh.too-many-auth-failures', summary: 'The server disconnected after too many identities were offered.' };
  if (/sign_and_send_pubkey: signing failed|agent refused operation|security key provider/i.test(diagnostic)) return { ...base, stage: 'authentication', reasonCode: 'ssh.identity.signing-failed', summary: 'The selected agent or hardware-backed identity could not sign.' };
  if (/UNPROTECTED PRIVATE KEY FILE|bad permissions.*private key|identity file .* not accessible/i.test(diagnostic)) return { ...base, stage: 'authentication', reasonCode: 'ssh.identity.unavailable', summary: 'A configured SSH identity is missing or unusable.' };
  if (/passphrase|password|keyboard-interactive|keyboard interactive|MFA|one-time|Authentications that can continue:.*(?:password|keyboard-interactive)/i.test(diagnostic)) return { ...base, stage: 'authentication', reasonCode: 'ssh.authentication.interactive-required', confidence: 'heuristic', summary: 'SSH needs an interactive password, passphrase, hardware-key, or MFA step.' };
  if (/Permission denied \(|Permission denied[,.:]|No supported authentication methods available/i.test(diagnostic)) return { ...base, stage: 'authentication', reasonCode: 'ssh.authentication.rejected', confidence: 'heuristic', summary: 'SSH reached the target, but non-interactive authentication was rejected. Confirm the destination username, selected identity, and target policy.' };
  return { ...base, stage: 'ssh', reasonCode: 'ssh.unknown-failure', confidence: 'heuristic', summary: 'SSH failed for a reason that could not be classified safely. Run the approved interactive check to see OpenSSH’s live diagnostic.' };
}

function tcpFailureProbe(tcp) {
  const mapping = {
    'dns-not-found': ['name-resolution', 'network.dns-not-found', 'The candidate name did not resolve.'],
    'dns-temporary-failure': ['name-resolution', 'network.dns-temporary-failure', 'Name resolution failed temporarily.'],
    refused: ['transport', 'network.connection-refused', 'The candidate answered, but no SSH service accepted this port.'],
    'timed-out': ['transport', 'network.timeout', 'The SSH port did not answer before the bounded timeout.'],
    'host-unreachable': ['transport', 'network.unreachable', 'The host is unreachable from this client.'],
    'network-unreachable': ['transport', 'network.unreachable', 'No route to the candidate network is available.'],
    failed: ['transport', 'network.unknown-failure', 'The TCP probe failed for an unclassified local networking reason.'],
  };
  const [stage, reasonCode, summary] = mapping[tcp.state] ?? mapping.failed;
  return { state: 'ssh-blocked', stage, reasonCode, summary, confidence: 'observed', tcp, authenticated: false, herdr: { state: 'not-checked', blockedBy: reasonCode } };
}

function parseRemoteProbe(stdout, nonce) {
  const lines = stdout.split(/\r?\n/);
  if (lines[0] !== 'SETUP_MULTI_HERDR_V1') return null;
  const values = {};
  for (const line of lines.slice(1)) {
    const index = line.indexOf('=');
    if (index > 0) values[line.slice(0, index)] = clean(line.slice(index + 1), 200);
  }
  const rawMachineId = values.machine_id || '';
  const identityToken = rawMachineId ? sha(`${nonce}:${rawMachineId}`) : null;
  delete values.machine_id;
  return {
    os: values.os || null, arch: values.arch || null, hostname: values.hostname || null,
    tailscaleIp: values.tailscale_ip || null, herdrVersion: values.herdr_version || null,
    herdrRunning: values.herdr_running === 'true', identityToken,
  };
}

async function sshProbe(route, sshExecutable, nonce, options) {
  const parsed = parseTarget(route.target, route.port ?? options.sshPort);
  const config = await inspectSshConfig(route.target, route.port ?? options.sshPort, sshExecutable);
  if (!config.ok) {
    const classified = classifySshFailure(config.result);
    classified.stage = 'effective-config';
    classified.reasonCode = 'ssh.config.invalid';
    classified.summary = 'OpenSSH could not evaluate the explicitly selected target configuration.';
    classified.herdr.blockedBy = classified.reasonCode;
    return classified;
  }
  let tcp = { state: 'not-tested', errorCode: null };
  if (!parsed.alias && !config.effective.proxyConfigured) {
    tcp = await tcpProbe(config.effective.hostname, config.effective.port, options.timeoutMs);
  }
  if (tcp.state !== 'not-tested' && tcp.state !== 'open') return { ...tcpFailureProbe(tcp), effective: config.effective };
  const result = await run(sshExecutable, sshArgs(route.target, route.port ?? options.sshPort, REMOTE_PROBE), {
    timeoutMs: 6000, maxOutput: 64 * 1024, env: localCEnv(),
  });
  if (result.code !== 0 || result.overflow || result.timedOut) {
    const classified = classifySshFailure(result, tcp);
    classified.effective = config.effective;
    if (classified.stage === 'authentication') classified.agent = await inspectSshAgent();
    classified.herdr.blockedBy = classified.reasonCode;
    return classified;
  }
  const details = parseRemoteProbe(result.stdout, nonce);
  if (!details) return {
    state: 'ssh-blocked', stage: 'remote-command', reasonCode: 'probe.output.malformed',
    summary: 'SSH authenticated, but the fixed remote probe did not return valid output. A restricted shell, forced command, or startup output may be interfering.',
    confidence: 'observed', tcp, authenticated: true, effective: config.effective,
    herdr: { state: 'probe-failed', blockedBy: 'probe.output.malformed' },
  };
  const supported = ['Linux', 'Darwin'].includes(details.os) && ['x86_64', 'aarch64', 'arm64'].includes(details.arch);
  const state = !supported ? 'unsupported-platform'
    : !details.herdrVersion ? 'ssh-confirmed-herdr-missing'
      : details.herdrRunning ? 'herdr-running' : 'herdr-installed';
  const reasonCode = !supported ? (!['Linux', 'Darwin'].includes(details.os) ? 'remote.platform.unsupported' : 'remote.arch.unsupported')
    : !details.herdrVersion ? 'remote.herdr.missing' : details.herdrRunning ? 'remote.herdr.running' : 'remote.herdr.installed';
  const summary = !supported ? `Authenticated target ${details.os ?? 'unknown OS'}/${details.arch ?? 'unknown architecture'} is not supported by native multi-machine Herdr.`
    : !details.herdrVersion ? 'SSH is ready; Herdr is missing and can be offered by interactive machine setup.'
      : details.herdrRunning ? `SSH is ready and ${details.herdrVersion} has a running session.`
        : `SSH is ready and ${details.herdrVersion} is installed; machine setup can prepare the requested session.`;
  return {
    state, stage: supported ? 'remote-herdr' : 'remote-platform', reasonCode, summary,
    confidence: 'observed', tcp, authenticated: true, effective: config.effective,
    herdr: { state: !supported ? 'not-checked' : !details.herdrVersion ? 'missing' : details.herdrRunning ? 'running' : 'installed' },
    ...details,
  };
}

async function candidateProbe(route, options) {
  if (!route.online) return {
    state: 'peer-offline', stage: 'candidate', reasonCode: 'candidate.peer-offline',
    summary: 'Tailscale reports this candidate offline, so it was not probed.', confidence: 'observed',
    tcp: { state: 'not-tested', errorCode: null }, authenticated: false,
    herdr: { state: 'not-checked', blockedBy: 'candidate.peer-offline' },
  };
  const parsed = parseTarget(route.target, route.port ?? options.sshPort);
  const tcp = await tcpProbe(parsed.host, parsed.port, options.timeoutMs);
  if (tcp.state !== 'open') return tcpFailureProbe(tcp);
  return {
    state: 'candidate-user-required', stage: 'authentication', reasonCode: 'ssh.target-user-required',
    summary: 'An SSH service is reachable, but the destination OS username is unknown. Supply USER@HOST or a reviewed SSH alias; the helper will not guess it.',
    confidence: 'observed', tcp, authenticated: false,
    herdr: { state: 'not-checked', blockedBy: 'ssh.target-user-required' },
  };
}

function issueActor(reasonCode) {
  if (['network.connection-refused', 'probe.output.malformed', 'ssh.remote-command.denied'].includes(reasonCode)) return 'target-admin';
  if (['network.timeout', 'network.unreachable', 'ssh.tailscale-policy-denied'].includes(reasonCode)) return 'network-or-tailnet-admin';
  if (reasonCode?.startsWith('remote.platform') || reasonCode?.startsWith('remote.arch')) return 'target-owner';
  return 'local-user';
}

function addRouteResolution(route, remediations) {
  const interactiveCodes = new Set([
    'ssh.host-key.unknown', 'ssh.authentication.rejected', 'ssh.authentication.interactive-required',
    'ssh.tailscale-check-required', 'ssh.identity.signing-failed', 'ssh.too-many-auth-failures',
    'ssh.unknown-failure', 'probe.output.malformed',
  ]);
  const remediationIds = [];
  if (interactiveCodes.has(route.probe.reasonCode) && ['ssh-alias', 'existing-profile'].includes(route.route)) {
    const action = remediation('ssh.interactive-verify', {
      actor: 'local-user', target: route.target, port: parseTarget(route.target, route.port ?? 22).port,
      configMode: 'user',
      summary: `Run an interactive SSH verification for ${route.target}; OpenSSH will own all trust and credential prompts.`,
      possibleChanges: route.probe.reasonCode === 'ssh.host-key.unknown' ? ['user-known-hosts'] : ['interactive-authentication-state'],
    });
    remediations.push(action);
    remediationIds.push(action.id);
  }
  route.issue = issue(route.probe.reasonCode, route.probe.stage, route.probe.summary, {
    confidence: route.probe.confidence,
    actor: issueActor(route.probe.reasonCode), remediationIds,
    scope: { route: route.route, target: route.target },
    severity: ['remote.herdr.running', 'remote.herdr.installed', 'remote.herdr.missing'].includes(route.probe.reasonCode) ? 'informational' : 'blocking',
    detail: [
      route.probe.effective?.user ? `OpenSSH selected destination OS user ${route.probe.effective.user}.` : '',
      route.probe.agent && route.probe.agent.state !== 'available' ? `SSH agent state: ${route.probe.agent.state}.` : '',
      route.probe.herdr?.state === 'not-checked' ? `Herdr was not checked because setup stopped at ${route.probe.stage}.` : '',
    ].filter(Boolean).join(' '),
  });
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function normalizeName(value) {
  const first = clean(value, 160).split('.')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return first && first !== 'local' ? first : 'machine';
}

function uniqueName(base, used, stableInput) {
  let candidate = normalizeName(base);
  if (!used.has(candidate.toLowerCase())) { used.add(candidate.toLowerCase()); return candidate; }
  const suffix = crypto.createHash('sha256').update(stableInput || candidate).digest('hex').slice(0, 6);
  candidate = `${candidate}-${suffix}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

function publicRoute(route) {
  return {
    route: route.route, target: route.target, port: parseTarget(route.target, route.port ?? 22).port, online: route.online,
    state: route.probe.state, stage: route.probe.stage, reasonCode: route.probe.reasonCode,
    summary: route.probe.summary, confidence: route.probe.confidence,
    tcp: route.probe.tcp, authenticated: route.probe.authenticated,
    os: route.probe.os ?? route.os ?? null, arch: route.probe.arch ?? null,
    hostname: route.probe.hostname ?? route.hostName ?? null,
    herdrVersion: route.probe.herdrVersion ?? null, herdrRunning: route.probe.herdrRunning === true,
    herdr: route.probe.herdr, effective: route.probe.effective ?? null, issue: route.issue,
    agent: route.probe.agent ?? null,
  };
}

function buildGroups(routes, tailscale, nonce, profiles) {
  const peerByIp = new Map();
  for (const peer of tailscale.peers) {
    for (const address of peer.addresses) peerByIp.set(address, peer.internalId);
  }
  const buckets = new Map();
  for (const route of routes) {
    const peerId = route.peerId || peerByIp.get(route.probe.tailscaleIp);
    const key = peerId ? `tail:${sha(`${nonce}:${peerId}`)}`
      : route.probe.identityToken ? `host:${route.probe.identityToken}` : `route:${sha(route.target)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(route);
  }
  const rank = { 'ssh-alias': 0, 'existing-profile': 0, tailnet: 1, 'tailnet-ip': 2, lan: 3 };
  return [...buckets.entries()].map(([key, members]) => {
    const authenticated = members.filter((item) => item.probe.authenticated);
    const preferred = authenticated.sort((a, b) => (rank[a.route] ?? 9) - (rank[b.route] ?? 9))[0] ?? null;
    const existing = profiles.filter((profile) => members.some((route) => route.target === profile.target));
    return { key, members, preferred, existing };
  });
}

function buildProposal(localName, groups, profiles, nonce) {
  const used = new Set(profiles.map((profile) => profile.label.toLowerCase()));
  const nodes = [];
  const actions = [];
  for (const group of groups) {
    const preferred = group.preferred;
    const representative = preferred ?? group.members.find((member) => member.route === 'tailnet') ?? group.members[0];
    const seed = representative?.probe.hostname ?? representative?.hostName ?? representative?.target ?? 'machine';
    const preferredPort = preferred ? parseTarget(preferred.target, preferred.port ?? 22).port : null;
    const preferredTarget = preferred ? canonicalHerdrTarget(preferred.target, preferredPort) : null;
    const exact = preferredTarget ? profiles.find((profile) => profile.target === preferredTarget && profile.session === 'default') : null;
    const label = exact?.label ?? uniqueName(seed, used, group.key);
    let action = null;
    const identityToken = preferred?.probe.identityToken ?? null;
    if (exact && !exact.enabled && identityToken) {
      action = {
        type: 'enable', profileId: exact.id, target: exact.target,
        port: preferredPort,
        label: exact.label, session: exact.session, identityToken, risk: 'connects saved remote',
      };
    } else if (!exact && identityToken && ['herdr-running', 'herdr-installed', 'ssh-confirmed-herdr-missing'].includes(preferred?.probe.state)) {
      const risk = preferred.probe.state === 'ssh-confirmed-herdr-missing'
        ? 'will offer to install remote Herdr'
        : preferred.probe.state === 'herdr-installed'
          ? 'may start or replace remote Herdr'
          : 'may replace incompatible remote Herdr and stop its panes';
      action = {
        type: 'add', target: preferredTarget, port: preferredPort,
        label, session: 'default', identityToken, risk,
      };
    }
    if (action) actions.push(action);
    nodes.push({
      nodeKey: group.key, proposedLabel: label, preferredTarget,
      preferredReason: preferred ? preferred.route : null,
      readiness: preferred ? (preferred.probe.state === 'herdr-running' ? 'ready' : 'ready-for-herdr-add')
        : representative?.probe.reasonCode === 'candidate.peer-offline' ? 'temporarily-unavailable'
          : representative?.probe.reasonCode?.startsWith('remote.') ? 'unsupported' : 'needs-action',
      classification: representative?.probe.reasonCode ?? 'candidate.unknown',
      correlation: group.members.length > 1 ? 'strong-or-tailnet' : 'single-route',
      routes: group.members.map(publicRoute), existingProfiles: group.existing, proposedAction: action,
    });
  }
  actions.sort((a, b) => `${a.type}:${a.target ?? a.profileId}`.localeCompare(`${b.type}:${b.target ?? b.profileId}`));
  const approval = { schema: SCHEMA, localName, nonce, catalogFingerprint: catalogFingerprint(profiles), actions };
  return { nodes, approval };
}

function reviewProjection(report) {
  return {
    schema: report.schema, local: report.local, scope: report.scope,
    existingProfiles: report.existingProfiles, nodes: report.nodes,
    issues: report.issues, remediations: report.remediations,
    blockers: report.blockers, limitations: report.limitations,
  };
}

export function reportReviewFingerprint(report) {
  return sha(canonicalJson(reviewProjection(report)));
}

async function discover(options) {
  const preflight = await preflightReport();
  if (preflight.outcome !== 'ready') return {
    ...preflight, kind: 'discovery', scope: { lan: [], lanAddressCount: 0, tailnetPeerCount: 0 },
    existingProfiles: [], nodes: [], proposal: { state: 'blocked', approval: null, digest: null },
    blockers: preflight.issues.map((item) => item.summary),
    limitations: ['No network discovery was performed because local prerequisites are blocked.'],
  };
  const nonce = crypto.randomBytes(16).toString('hex');
  const [herdr, tailscale] = await Promise.all([inspectHerdr(), inspectTailscale()]);
  const lan = localNetworkPlan(options);
  if (!options.interfaces.length) {
    for (const neighbor of await neighborAddresses()) {
      const inObservedScope = lan.scopes.some((scope) => cidrContains(scope.scannedCidr, neighbor));
      if (inObservedScope && !lan.selfAddresses.has(neighbor) && lan.addresses.length < options.maxHosts && !lan.addresses.includes(neighbor)) {
        lan.addresses.push(neighbor);
      }
    }
  }
  const selfAddresses = new Set([...lan.selfAddresses, ...(tailscale.self?.addresses ?? [])]);
  const routes = [];
  for (const peer of tailscale.peers) {
    if (peer.addresses.some((value) => selfAddresses.has(value))) continue;
    if (peer.dnsName) {
      routes.push({ route: 'tailnet', target: peer.dnsName, port: options.sshPort, online: peer.online, os: peer.os, hostName: peer.hostName, peerId: peer.internalId, authSemantics: false });
    }
    const tailnetIp = peer.addresses.find((value) => net.isIP(value) === 4) ?? peer.addresses[0];
    if (tailnetIp && tailnetIp !== peer.dnsName) {
      routes.push({ route: 'tailnet-ip', target: tailnetIp, port: options.sshPort, online: peer.online, os: peer.os, hostName: peer.hostName, peerId: peer.internalId, authSemantics: false });
    }
  }
  for (const address of lan.addresses) routes.push({ route: 'lan', target: address, port: options.sshPort, online: true, authSemantics: false });
  for (const profile of herdr.profiles) {
    routes.push({ route: 'existing-profile', target: profile.target, port: parseTarget(profile.target, 22).port, online: true, authSemantics: true });
  }
  for (const target of options.targets) {
    routes.push({ route: 'ssh-alias', target, port: parseTarget(target, options.sshPort).port, online: true, authSemantics: true });
  }
  const uniqueRoutes = [...new Map(routes.map((route) => [`${route.target}\u0000${route.port ?? 22}`, route])).values()];
  const sshExecutable = findExecutable('ssh');
  const probed = await mapLimit(uniqueRoutes, CONCURRENCY, async (route) => {
    if (!route.authSemantics) return { ...route, probe: await candidateProbe(route, options) };
    if (!sshExecutable) return { ...route, probe: {
      state: 'ssh-blocked', stage: 'client-prerequisite', reasonCode: 'local.ssh.client-missing',
      summary: 'The OpenSSH client is unavailable.', confidence: 'observed', authenticated: false,
      tcp: { state: 'not-tested', errorCode: null }, herdr: { state: 'not-checked', blockedBy: 'local.ssh.client-missing' },
    } };
    return { ...route, probe: await sshProbe(route, sshExecutable, nonce, options) };
  });
  const remediations = [];
  for (const route of probed) addRouteResolution(route, remediations);
  const uniqueRemediations = [...new Map(remediations.map((item) => [item.id, item])).values()];
  const localStable = tailscale.self?.internalId || `${os.hostname()}:${process.platform}:${process.arch}`;
  const existingNames = [...herdr.profiles.map((profile) => profile.label), ...tailscale.peers.map((peer) => peer.hostName || peer.dnsName)];
  const localName = uniqueName(tailscale.self?.hostName || os.hostname(), new Set(existingNames.map((item) => normalizeName(item))), localStable);
  const groups = buildGroups(probed, tailscale, nonce, herdr.profiles);
  const { nodes, approval } = buildProposal(localName, groups, herdr.profiles, nonce);
  const report = {
    schema: SCHEMA, kind: 'discovery', generatedAt: new Date().toISOString(),
    outcome: approval.actions.length ? 'catalog-actions-ready'
      : probed.some((route) => route.issue?.severity === 'blocking') ? 'attention-required' : 'no-actions',
    local: {
      platform: process.platform, arch: process.arch, hostname: clean(os.hostname()), proposedName: localName,
      ssh: preflight.local.ssh,
      herdr: {
        installed: herdr.installed, executable: herdr.executable, version: herdr.version,
        installMethod: herdr.installMethod, machineCommandAvailable: herdr.machineCommandAvailable,
        machineSupported: herdr.machineSupported, catalogState: herdr.catalogState,
        catalogError: herdr.catalogError,
      },
      tailscale: { state: tailscale.state, peerCount: tailscale.peers.length, capabilities: tailscale.capabilities },
    },
    scope: { lan: lan.scopes, lanAddressCount: lan.addresses.length, tailnetPeerCount: tailscale.peers.length },
    existingProfiles: herdr.profiles, nodes, issues: probed.map((route) => route.issue).filter((item) => item?.severity === 'blocking'),
    remediations: uniqueRemediations,
    proposal: { state: approval.actions.length ? 'ready' : 'no-actions', approval, digest: null },
    blockers: probed.map((route) => route.issue).filter((item) => item?.severity === 'blocking').map((item) => item.summary),
    limitations: [
      'Discovery is bounded and may miss sleeping, firewalled, routed, IPv6-only, or nonstandard-SSH hosts.',
      'A Tailscale peer or open SSH port is not proof of Herdr; only strict authenticated SSH can confirm it.',
      'The proposed local name is advisory because Herdr 0.9 displays the current endpoint as Local.',
    ],
  };
  approval.reviewFingerprint = reportReviewFingerprint(report);
  if (approval.actions.length) report.proposal.digest = proposalDigest(approval);
  return report;
}

function printHuman(report) {
  if (report.outcome === 'prerequisite-blocked') {
    console.log('Setup Multi-Herdr: local prerequisites need action');
    for (const item of report.issues) {
      console.log(`\n${item.summary}`);
      if (item.detail) console.log(`  ${item.detail}`);
      for (const remediationId of item.remediationIds) {
        const action = report.remediations.find((candidate) => candidate.id === remediationId);
        if (action) console.log(`  Approved repair available: ${action.id} (${action.digest}) — ${action.summary}`);
      }
    }
    console.log('\nNo network discovery was performed and no catalog proposal was created.');
    return;
  }
  console.log(`Local: Local (${report.local.proposedName})`);
  console.log(`Herdr: ${report.local.herdr.version ?? 'not installed'}; multi-machine: ${report.local.herdr.machineSupported ? 'ready' : 'blocked'}`);
  console.log(`Tailscale: ${report.local.tailscale.state}; peers visible: ${report.local.tailscale.peerCount}`);
  console.log(`LAN addresses probed: ${report.scope.lanAddressCount}`);
  console.log('');
  console.log('Label\tPlatform\tReadiness\tPreferred target\tAlternate routes\tHerdr\tAction');
  for (const node of report.nodes) {
    const action = node.proposedAction ? `${node.proposedAction.type} ${node.proposedAction.target ?? node.proposedAction.profileId}` : '-';
    const authenticatedRoute = node.routes.find((route) => route.authenticated);
    const platform = [authenticatedRoute?.os, authenticatedRoute?.arch].filter(Boolean).join('/') || node.routes.find((route) => route.os)?.os || 'unknown';
    const herdr = authenticatedRoute?.herdr?.state ?? 'not-checked';
    const alternatives = node.routes.filter((route) => route.target !== node.preferredTarget).map((route) => route.target).join(', ') || '-';
    console.log([node.proposedLabel, platform, node.readiness, node.preferredTarget ?? '-', alternatives, herdr, action].map((value) => clean(value, 240)).join('\t'));
    for (const route of node.routes.filter((item) => item.issue?.severity === 'blocking')) {
      console.log(`  ${route.target}: stopped at ${route.stage} — ${route.summary}`);
      if (route.effective?.user) console.log(`    Destination OS user selected by OpenSSH: ${route.effective.user}.`);
      if (route.agent) console.log(`    SSH agent: ${route.agent.state}${Number.isInteger(route.agent.identityCount) ? ` (${route.agent.identityCount} identities)` : ''}.`);
      if (route.herdr?.state === 'not-checked') console.log(`    Herdr: not checked because ${route.reasonCode} blocked the probe.`);
      console.log(`    Next owner: ${route.issue.actor}.`);
      for (const remediationId of route.issue.remediationIds) {
        const repair = report.remediations.find((candidate) => candidate.id === remediationId);
        if (repair) console.log(`    Approved repair available: ${repair.id} (${repair.digest}) — ${repair.summary}`);
      }
    }
  }
  if (report.blockers.length) {
    console.log('\nBlockers:');
    for (const blocker of report.blockers) console.log(`- ${blocker}`);
  }
  if (report.proposal.digest) {
    console.log(`\nCatalog proposal: ${report.proposal.digest}`);
    console.log('No configuration was changed. Review every proposed catalog action before apply.');
  } else {
    console.log('\nNo catalog actions are ready. Resolve selected issues, discard this report, and run fresh discovery.');
  }
}

function printPreflight(report) {
  if (report.outcome !== 'ready') return printHuman(report);
  console.log('Setup Multi-Herdr preflight: ready');
  console.log(`Platform: ${report.local.platform}/${report.local.arch}`);
  console.log(`SSH client: ${report.local.ssh.executable}`);
  console.log(`Herdr: ${report.local.herdr.version}; machine catalog: ready`);
  console.log('No network discovery was performed.');
}

async function doctorTarget(options) {
  const sshExecutable = findExecutable('ssh');
  if (!sshExecutable) {
    const preflight = await preflightReport();
    return { ...preflight, kind: 'client-doctor' };
  }
  const route = {
    route: 'ssh-alias', target: options.targets[0], port: parseTarget(options.targets[0], options.sshPort).port,
    online: true, authSemantics: true,
  };
  route.probe = await sshProbe(route, sshExecutable, crypto.randomBytes(16).toString('hex'), options);
  const remediations = [];
  addRouteResolution(route, remediations);
  return {
    schema: SCHEMA, kind: 'client-doctor', generatedAt: new Date().toISOString(),
    outcome: route.probe.authenticated ? 'ready' : 'attention-required',
    route: publicRoute(route), issues: route.issue?.severity === 'blocking' ? [route.issue] : [], remediations,
  };
}

function systemExecutable(name, candidates) {
  return findExecutable(name) ?? candidates.find((candidate) => {
    try { fs.accessSync(candidate, fs.constants.X_OK); return true; } catch { return false; }
  }) ?? null;
}

async function inspectSystemdUnits() {
  const systemctl = findExecutable('systemctl');
  if (!systemctl) return [];
  const units = [];
  for (const name of ['ssh.service', 'sshd.service', 'ssh.socket', 'sshd.socket']) {
    const result = await run(systemctl, ['show', name, '--property=LoadState,ActiveState,UnitFileState', '--no-pager'], {
      timeoutMs: 2000, maxOutput: 16 * 1024, env: localCEnv(),
    });
    const values = Object.fromEntries(result.stdout.split(/\r?\n/).map((line) => line.split('=', 2)).filter((parts) => parts.length === 2));
    if (values.LoadState && values.LoadState !== 'not-found') units.push({
      name, loadState: values.LoadState, activeState: values.ActiveState ?? 'unknown', unitFileState: values.UnitFileState ?? 'unknown',
    });
  }
  return units;
}

async function inspectSshdConfig(sshd) {
  if (!sshd) return 'not-installed';
  const sudo = systemExecutable('sudo', ['/usr/bin/sudo']);
  let result = sudo ? await run(sudo, ['-n', '--', sshd, '-t'], { timeoutMs: 3000, maxOutput: 32 * 1024, env: localCEnv() }) : null;
  if (result?.code === 0) return 'valid';
  result = await run(sshd, ['-t'], { timeoutMs: 3000, maxOutput: 32 * 1024, env: localCEnv() });
  if (result.code === 0) return 'valid';
  if (/bad configuration option|unsupported option|directive .* is not allowed|Missing argument/i.test(`${result.stdout}\n${result.stderr}`)) return 'invalid';
  return 'privileged-inspection-unavailable';
}

async function doctorHost() {
  const issues = [];
  const remediations = [];
  const [listener, herdr, tailscale] = await Promise.all([
    tcpProbe('127.0.0.1', 22, 700), inspectHerdr(), inspectTailscale(),
  ]);
  const host = {
    platform: process.platform, arch: process.arch, hostname: clean(os.hostname()),
    ssh: { listener }, herdr: { installed: herdr.installed, version: herdr.version, installMethod: herdr.installMethod },
    tailscale: { state: tailscale.state, capabilities: tailscale.capabilities },
  };
  if (process.platform === 'linux') {
    const osRelease = readOsRelease();
    const sshd = systemExecutable('sshd', ['/usr/sbin/sshd', '/sbin/sshd']);
    const units = await inspectSystemdUnits();
    host.osRelease = { id: osRelease.ID ?? null, name: osRelease.PRETTY_NAME ?? null };
    host.ssh.serverExecutable = sshd;
    host.ssh.units = units;
    host.ssh.configState = await inspectSshdConfig(sshd);
    if (!sshd) {
      const plan = linuxPackageAction('server', osRelease);
      let remediationIds = [];
      if (plan && findExecutable(plan.manager)) {
        const action = remediation('linux.install-openssh-server', {
          actor: 'target-admin', summary: `Install ${plan.args.at(-1)} with ${plan.manager} on this Linux target.`,
          possibleChanges: ['system-packages'], manager: plan.manager, args: plan.args,
        });
        remediations.push(action); remediationIds = [action.id];
      }
      issues.push(issue('host.ssh.server-missing', 'target-service', 'OpenSSH Server is not installed on this Linux target.', {
        actor: 'target-admin', remediationIds,
      }));
    } else if (host.ssh.configState === 'invalid') {
      issues.push(issue('host.ssh.config-invalid', 'target-service', 'OpenSSH Server configuration is invalid on this Linux target.', {
        actor: 'target-admin', detail: 'Correct and revalidate sshd configuration before starting or restarting the service.',
      }));
    } else if (listener.state !== 'open') {
      const startable = units.find((unit) => ['ssh.service', 'sshd.service', 'ssh.socket', 'sshd.socket'].includes(unit.name) && unit.activeState !== 'active');
      let remediationIds = [];
      if (startable) {
        const action = remediation('linux.start-ssh-unit', {
          actor: 'target-admin', unit: startable.name,
          summary: `Start ${startable.name} on this Linux target for the current boot.`,
          possibleChanges: ['system-service-state'],
        });
        remediations.push(action); remediationIds = [action.id];
      }
      issues.push(issue('host.ssh.not-listening', 'target-service', 'OpenSSH Server is present but port 22 is not accepting connections on this Linux target.', {
        actor: 'target-admin', remediationIds,
        detail: 'Validate sshd configuration and the detected service/socket before changing firewall policy.',
      }));
    }
    const disabledUnit = units.find((unit) => unit.loadState === 'loaded' && unit.unitFileState === 'disabled');
    if (disabledUnit) {
      const action = remediation('linux.enable-ssh-unit', {
        actor: 'target-admin', unit: disabledUnit.name,
        summary: `Enable ${disabledUnit.name} at boot on this Linux target without starting it now.`,
        possibleChanges: ['system-service-boot-state'],
      });
      remediations.push(action);
      issues.push(issue('host.ssh.not-enabled-at-boot', 'target-service', `${disabledUnit.name} is disabled at boot, so remote access may not survive a restart.`, {
        actor: 'target-admin', severity: 'recommended', remediationIds: [action.id],
      }));
    }
  } else if (process.platform === 'darwin') {
    const systemsetup = '/usr/sbin/systemsetup';
    let result = fs.existsSync(systemsetup)
      ? await run(systemsetup, ['-getremotelogin'], { timeoutMs: 3000, maxOutput: 16 * 1024, env: localCEnv() })
      : { code: null, stdout: '', stderr: '' };
    if (result.code !== 0 && fs.existsSync('/usr/bin/sudo') && fs.existsSync(systemsetup)) {
      result = await run('/usr/bin/sudo', ['-n', '--', systemsetup, '-getremotelogin'], {
        timeoutMs: 3000, maxOutput: 16 * 1024, env: localCEnv(),
      });
    }
    const remoteLogin = parseRemoteLogin(result.stdout);
    host.ssh.remoteLogin = remoteLogin;
    const sshd = systemExecutable('sshd', ['/usr/sbin/sshd']);
    host.ssh.configState = await inspectSshdConfig(sshd);
    const launchctl = systemExecutable('launchctl', ['/bin/launchctl']);
    if (launchctl) {
      const launchd = await run(launchctl, ['print', 'system/com.openssh.sshd'], {
        timeoutMs: 3000, maxOutput: 64 * 1024, env: localCEnv(),
      });
      host.ssh.launchdState = launchd.code === 0 ? 'loaded-or-socket-available' : 'unavailable';
    }
    if (host.ssh.configState === 'invalid') {
      issues.push(issue('host.macos.ssh-config-invalid', 'target-service', 'The Mac SSH server configuration is invalid.', {
        actor: 'target-admin', detail: 'Correct and revalidate sshd configuration before enabling or restarting Remote Login.',
      }));
    } else if (remoteLogin === 'off') {
      const action = remediation('macos.enable-remote-login', {
        actor: 'target-admin', summary: 'Enable Apple Remote Login on this Mac while preserving its configured user allow list.',
        possibleChanges: ['macos-remote-login', 'network-listener'],
      });
      remediations.push(action);
      issues.push(issue('host.macos.remote-login-off', 'target-service', 'Apple Remote Login is off on this Mac.', {
        actor: 'target-admin', remediationIds: [action.id],
        detail: 'This enables SSH on networks permitted by the Mac firewall and network policy.',
      }));
    } else if (listener.state !== 'open') {
      issues.push(issue('host.macos.ssh-not-listening', 'target-service',
        remoteLogin === 'on'
          ? 'Remote Login is on, but port 22 is not accepting local connections; validate launchd and sshd configuration.'
          : 'Port 22 is not accepting local connections, and Remote Login state could not be read without administrator access.', {
          actor: 'target-admin', detail: 'Use System Settings > General > Sharing > Remote Login or run the doctor with suitable administrator access.',
        }));
    }
  } else {
    issues.push(issue('host.platform.unsupported', 'target-service', 'Target-host preparation supports only Linux and macOS.', { actor: 'target-owner' }));
  }
  return {
    schema: SCHEMA, kind: 'host-doctor', generatedAt: new Date().toISOString(),
    outcome: issues.length ? 'attention-required' : 'ready', host, issues, remediations,
  };
}

function printDoctor(report) {
  console.log(`Setup Multi-Herdr ${report.kind}: ${report.outcome}`);
  if (report.route) {
    console.log(`${report.route.target}: ${report.route.summary}`);
    if (report.route.herdr?.state === 'not-checked') console.log(`Herdr: not checked because ${report.route.reasonCode} blocked the probe.`);
  }
  if (report.host) {
    console.log(`Host: ${report.host.platform}/${report.host.arch}; SSH listener: ${report.host.ssh.listener.state}`);
    console.log(`Herdr: ${report.host.herdr.version ?? 'not installed'}`);
    console.log(`Tailscale: ${report.host.tailscale.state}${report.host.tailscale.capabilities?.variant ? ` (${report.host.tailscale.capabilities.variant})` : ''}`);
  }
  for (const item of report.issues) {
    console.log(`\n${item.summary}`);
    if (item.detail) console.log(`  ${item.detail}`);
    console.log(`  Next owner: ${item.actor}.`);
    for (const remediationId of item.remediationIds) {
      const action = report.remediations.find((candidate) => candidate.id === remediationId);
      if (action) console.log(`  Approved repair available: ${action.id} (${action.digest}) — ${action.summary}`);
    }
  }
}

function loadPrivateReport(filePath, label = 'report') {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular, non-symlink file`);
  if (stat.size > MAX_PROPOSAL) throw new Error(`${label} file is too large`);
  if (process.platform !== 'win32' && (stat.mode & 0o077)) throw new Error(`${label} file must be private (mode 0600)`);
  if (process.getuid && stat.uid !== process.getuid()) throw new Error(`${label} file must be owned by the current user`);
  const report = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (report?.schema !== SCHEMA) throw new Error(`unsupported ${label} schema`);
  return report;
}

export function validateRemediation(value) {
  const allowed = new Set([
    'ssh.interactive-verify', 'homebrew.install-herdr', 'homebrew.upgrade-herdr',
    'mise.install-or-update-herdr',
    'linux.install-openssh-client', 'linux.install-openssh-server', 'linux.start-ssh-unit', 'linux.enable-ssh-unit',
    'macos.enable-remote-login',
  ]);
  if (!value || !allowed.has(value.operation) || typeof value.id !== 'string') throw new Error('unsupported remediation operation');
  if (remediationDigest(value) !== value.digest) throw new Error('remediation digest is invalid');
  if (value.operation === 'ssh.interactive-verify') {
    validateTarget(value.target);
    boundedInt(String(value.port), 'remediation port', 1, 65535);
    if (value.configMode !== 'user') throw new Error('unsupported SSH configuration mode');
  }
  if (['linux.start-ssh-unit', 'linux.enable-ssh-unit'].includes(value.operation) && !['ssh.service', 'sshd.service', 'ssh.socket', 'sshd.socket'].includes(value.unit)) {
    throw new Error('unsupported SSH unit');
  }
  return value;
}

function runInteractive(command, args, errorMessage) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Object.assign(new Error('resolution requires an interactive terminal'), { exitCode: 4 });
  const result = spawnSync(command, args, { shell: false, stdio: 'inherit' });
  if (result.status !== 0) throw Object.assign(new Error(errorMessage), { exitCode: 5 });
}

async function resolveRemediation(options) {
  const report = loadPrivateReport(options.report, 'remediation report');
  if (!Array.isArray(report.remediations)) throw Object.assign(new Error('report has no remediations'), { exitCode: 4 });
  const action = report.remediations.find((candidate) => candidate.id === options.remediation);
  if (!action) throw Object.assign(new Error('remediation ID is not present in the report'), { exitCode: 4 });
  validateRemediation(action);
  if (action.digest !== options.approve) throw Object.assign(new Error('approval digest does not match the remediation'), { exitCode: 4 });
  if (action.operation === 'ssh.interactive-verify') {
    const ssh = findExecutable('ssh');
    if (!ssh) throw Object.assign(new Error('SSH is unavailable'), { exitCode: 4 });
    const parsed = parseTarget(action.target, action.port);
    const destination = parsed.user ? `${parsed.user}@${parsed.host}` : parsed.host;
    const args = ['-T', '-S', 'none', '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no',
      '-o', 'RemoteCommand=none', '-o', 'StrictHostKeyChecking=ask', '-o', 'UpdateHostKeys=no',
      ...(parsed.port !== 22 ? ['-p', String(parsed.port)] : []), destination, 'true'];
    runInteractive(ssh, args, 'interactive SSH verification did not complete successfully');
  } else if (action.operation === 'homebrew.install-herdr' || action.operation === 'homebrew.upgrade-herdr') {
    const brew = findExecutable('brew');
    if (!brew || brew !== action.executable) throw Object.assign(new Error('Homebrew executable changed; run preflight again'), { exitCode: 4 });
    runInteractive(brew, [action.operation.includes('install') ? 'install' : 'upgrade', 'herdr'], 'Homebrew Herdr operation failed');
  } else if (action.operation === 'mise.install-or-update-herdr') {
    const mise = findExecutable('mise');
    if (!mise || mise !== action.executable) throw Object.assign(new Error('mise executable changed; run preflight again'), { exitCode: 4 });
    runInteractive(mise, ['use', '-g', 'herdr'], 'mise Herdr operation failed');
  } else if (action.operation === 'linux.install-openssh-client' || action.operation === 'linux.install-openssh-server') {
    if (process.platform !== 'linux') throw Object.assign(new Error('Linux package remediation was requested on another platform'), { exitCode: 4 });
    const kind = action.operation.endsWith('client') ? 'client' : 'server';
    const plan = linuxPackageAction(kind);
    if (!plan || plan.manager !== action.manager || canonicalJson(plan.args) !== canonicalJson(action.args)) {
      throw Object.assign(new Error('Linux package mapping changed; run doctor again'), { exitCode: 4 });
    }
    const sudo = findExecutable('sudo');
    const manager = findExecutable(plan.manager);
    if (!sudo || !manager) throw Object.assign(new Error('sudo or the detected package manager is unavailable'), { exitCode: 4 });
    runInteractive(sudo, ['--', manager, ...plan.args], 'OpenSSH package installation failed');
  } else if (action.operation === 'linux.start-ssh-unit' || action.operation === 'linux.enable-ssh-unit') {
    if (process.platform !== 'linux') throw Object.assign(new Error('Linux service remediation was requested on another platform'), { exitCode: 4 });
    const sudo = findExecutable('sudo');
    const systemctl = findExecutable('systemctl');
    if (!sudo || !systemctl) throw Object.assign(new Error('sudo or systemctl is unavailable'), { exitCode: 4 });
    const verb = action.operation === 'linux.start-ssh-unit' ? 'start' : 'enable';
    runInteractive(sudo, ['--', systemctl, verb, action.unit], `Failed to ${verb} ${action.unit}`);
  } else if (action.operation === 'macos.enable-remote-login') {
    if (process.platform !== 'darwin') throw Object.assign(new Error('macOS remediation was requested on another platform'), { exitCode: 4 });
    runInteractive('/usr/bin/sudo', ['--', '/usr/sbin/systemsetup', '-setremotelogin', 'on'], 'Failed to enable Remote Login');
  }
  console.log('Remediation completed. Discard this report and run fresh discovery before approving any Herdr catalog action.');
}

function loadProposal(filePath) {
  const report = loadPrivateReport(filePath, 'proposal');
  if (report?.proposal?.approval?.schema !== SCHEMA) throw new Error('unsupported proposal schema');
  if (!Array.isArray(report.proposal.approval.actions)) throw new Error('proposal actions must be an array');
  if (!Array.isArray(report.existingProfiles) || !report.existingProfiles.every(validProfile)) throw new Error('invalid baseline profile catalog');
  for (const action of report.proposal.approval.actions) validateAction(action);
  if (report.proposal.approval.catalogFingerprint !== catalogFingerprint(report.existingProfiles.map(normalizeProfile))) {
    throw new Error('proposal baseline catalog fingerprint is invalid');
  }
  if (report.proposal.approval.reviewFingerprint !== reportReviewFingerprint(report)) {
    throw new Error('proposal review content was modified');
  }
  return report;
}

function validOpaqueId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    !/^-|[\u0000-\u001f\u007f]/.test(value);
}

export function validateAction(action) {
  if (!action || !['add', 'rename', 'enable'].includes(action.type)) throw new Error('proposal contains an unsupported action');
  if (action.type === 'add') {
    validateTarget(action.target);
    boundedInt(String(action.port), 'action port', 1, 65535);
    if (!action.label || action.label.length > 128 || /[\u0000-\u001f\u007f]/.test(action.label)) throw new Error('invalid add label');
    if (!action.session || action.session.length > 128 || /[\u0000-\u001f\u007f]/.test(action.session)) throw new Error('invalid add session');
    if (!/^sha256:[a-f0-9]{64}$/.test(action.identityToken)) throw new Error('add action lacks a stable machine identity');
  } else {
    if (!validOpaqueId(action.profileId)) throw new Error(`invalid ${action.type} profile ID`);
    if (action.type === 'rename' && (!action.label || action.label.length > 128 || /[\u0000-\u001f\u007f]/.test(action.label))) {
      throw new Error('invalid rename label');
    }
    if (action.type === 'enable') {
      validateTarget(action.target);
      boundedInt(String(action.port), 'action port', 1, 65535);
      if (!/^sha256:[a-f0-9]{64}$/.test(action.identityToken)) throw new Error('enable action lacks a stable machine identity');
    }
  }
}

export function catalogMatchesApprovedProgress(baseline, current, actions) {
  if (![baseline, current, actions].every(Array.isArray)) return false;
  const currentById = new Map(current.map((profile) => [profile.id, profile]));
  if (currentById.size !== current.length) return false;
  const baselineIds = new Set(baseline.map((profile) => profile.id));
  for (const before of baseline) {
    const after = currentById.get(before.id);
    if (!after || after.target !== before.target || after.session !== before.session) return false;
    const rename = actions.find((action) => action.type === 'rename' && action.profileId === before.id);
    if (after.label !== before.label && after.label !== rename?.label) return false;
    const enable = actions.some((action) => action.type === 'enable' && action.profileId === before.id);
    if (Boolean(after.enabled) !== Boolean(before.enabled) && !(enable && after.enabled === true)) return false;
  }
  const unusedAdds = actions.filter((action) => action.type === 'add');
  for (const after of current) {
    if (baselineIds.has(after.id)) continue;
    const index = unusedAdds.findIndex((action) => action.target === after.target &&
      action.session === after.session && action.label === after.label && after.enabled === true);
    if (index < 0) return false;
    unusedAdds.splice(index, 1);
  }
  return true;
}

async function applyProposal(options) {
  if (!['linux', 'darwin'].includes(process.platform)) throw Object.assign(new Error('Herdr multi-machine apply is supported only on Linux and macOS'), { exitCode: 4 });
  const report = loadProposal(options.proposal);
  const approval = report.proposal.approval;
  const digest = proposalDigest(approval);
  if (digest !== report.proposal.digest || digest !== options.approve) throw Object.assign(new Error('approval digest does not match the proposal'), { exitCode: 4 });
  const herdr = await inspectHerdr({ includeInstallMethod: false });
  if (!herdr.machineSupported) throw Object.assign(new Error('local Herdr does not support multi-machine commands'), { exitCode: 4 });
  if (catalogFingerprint(herdr.profiles) !== approval.catalogFingerprint &&
      !catalogMatchesApprovedProgress(report.existingProfiles.map(normalizeProfile), herdr.profiles, approval.actions)) {
    throw Object.assign(new Error('Herdr catalog changed outside the approved actions; run discovery again'), { exitCode: 4 });
  }
  const sshExecutable = findExecutable('ssh');
  const completed = [];
  for (const action of approval.actions) {
    const currentSnapshot = await inspectHerdr({ includeInstallMethod: false });
    if (!currentSnapshot.machineSupported) throw Object.assign(new Error('Herdr catalog became unavailable during apply'), { exitCode: 5 });
    const current = currentSnapshot.profiles;
    if (!catalogMatchesApprovedProgress(report.existingProfiles.map(normalizeProfile), current, approval.actions)) {
      throw Object.assign(new Error('Herdr catalog changed outside the approved actions during apply'), { exitCode: 4 });
    }
    if (action.type === 'add' && current.some((profile) => profile.target === action.target && profile.session === action.session)) {
      completed.push({ action, result: 'already-present' });
      continue;
    }
    if (action.type === 'rename' && current.find((profile) => profile.id === action.profileId)?.label === action.label) {
      completed.push({ action, result: 'already-renamed' });
      continue;
    }
    if (action.type === 'enable' && current.find((profile) => profile.id === action.profileId)?.enabled) {
      completed.push({ action, result: 'already-enabled' });
      continue;
    }
    if (action.type === 'add' && current.some((profile) => profile.label.toLowerCase() === action.label.toLowerCase())) {
      throw Object.assign(new Error(`label collision appeared for ${action.label}`), { exitCode: 4 });
    }
    if (action.target) {
      if (!sshExecutable) throw Object.assign(new Error('SSH is unavailable during apply revalidation'), { exitCode: 4 });
      const probe = await sshProbe(
        { target: action.target, port: action.port }, sshExecutable, approval.nonce,
        { sshPort: action.port, timeoutMs: DEFAULT_TIMEOUT_MS },
      );
      if (!probe.authenticated || probe.identityToken !== action.identityToken) {
        throw Object.assign(new Error(`machine identity changed or cannot be revalidated for ${action.label}`), { exitCode: 4 });
      }
    }
    if (options.dryRun) {
      console.log(`DRY RUN ${action.type}: ${action.label ?? action.profileId} ${action.target ?? ''}`.trim());
      continue;
    }
    if (action.type === 'add' && (!process.stdin.isTTY || !process.stdout.isTTY)) {
      throw Object.assign(new Error('machine add requires an interactive terminal for remote install/replacement prompts'), { exitCode: 4 });
    }
    const args = action.type === 'add'
      ? ['machine', 'add', action.target, '--label', action.label, ...(action.session !== 'default' ? ['--remote-session', action.session] : [])]
      : action.type === 'rename'
        ? ['machine', 'rename', action.profileId, '--label', action.label]
        : ['machine', 'enable', action.profileId];
    const result = spawnSync(herdr.executable, args, { stdio: 'inherit', shell: false });
    if (result.status !== 0) {
      console.error(JSON.stringify({ completed, failed: action }, null, 2));
      throw Object.assign(new Error(`Herdr command failed for ${action.type}`), { exitCode: 5 });
    }
    const verification = await inspectHerdr({ includeInstallMethod: false });
    if (!verification.machineSupported) {
      throw Object.assign(new Error(`Herdr catalog verification failed after ${action.type}`), { exitCode: 5 });
    }
    completed.push({ action, result: 'applied' });
  }
  const finalSnapshot = await inspectHerdr({ includeInstallMethod: false });
  if (!finalSnapshot.machineSupported) throw Object.assign(new Error('final Herdr catalog verification failed'), { exitCode: 5 });
  const finalProfiles = finalSnapshot.profiles;
  if (!options.dryRun) {
    for (const action of approval.actions) {
      const verified = action.type === 'add'
        ? finalProfiles.some((profile) => profile.target === action.target && profile.session === action.session && profile.label === action.label)
        : action.type === 'rename'
          ? finalProfiles.some((profile) => profile.id === action.profileId && profile.label === action.label)
          : finalProfiles.some((profile) => profile.id === action.profileId && profile.enabled);
      if (!verified) throw Object.assign(new Error(`final verification failed for ${action.type} ${action.label ?? action.profileId}`), { exitCode: 5 });
    }
  }
  console.log(JSON.stringify({ status: options.dryRun ? 'dry-run' : 'applied', completed, finalProfiles }, null, 2));
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try { options = parseArgs(argv); }
  catch (error) { console.error(`Error: ${error.message}\n\n${usage()}`); return 2; }
  if (options.command === 'help') { console.log(usage()); return 0; }
  try {
    if (options.command === 'preflight') {
      const report = await preflightReport();
      if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else printPreflight(report);
      return 0;
    }
    if (options.command === 'discover') {
      const report = await discover(options);
      if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else printHuman(report);
      return ['malformed-status', 'peer-cap-exceeded'].includes(report.local.tailscale?.state) ? 3 : 0;
    }
    if (options.command === 'doctor') {
      const report = options.host ? await doctorHost() : await doctorTarget(options);
      if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else printDoctor(report);
      return 0;
    }
    if (options.command === 'resolve') {
      await resolveRemediation(options);
      return 0;
    }
    await applyProposal(options);
    return 0;
  } catch (error) {
    console.error(`Error: ${clean(error.message, 500)}`);
    return error.exitCode ?? 3;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) process.exitCode = await main();
