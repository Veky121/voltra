import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { campaign as h, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
import { Blocked } from './runner.mjs';
export { verifyBuild } from './game-checks.mjs';

// Frozen wave485 RA recipe. Root owns registration, helper authority and live runs.
export const registration = {
  openra: { recipe: 'openra/openra_red_alert/egg-open-r-a.json', ports: 1, environment: {
    SERVER_NAME: 'Validator OpenRA', PUBLIC: 'false', SINGLEPLAYER: 'false', AUTH: 'false',
    PASSWORD: '', GEOIP: 'false', ANONYMOUS: 'true', VERSION: 'release-20250330',
    SERVER_MAP: '', RECORD_REPLAYS: 'true',
  } },
};
const config = '/OpenRAData/settings.yaml';
const scope = {
  worldSave: 'N/A: idle dedicated lobby; no continuing world-save mechanism',
  replay: 'Existing replays retained only; no synthetic replay or completed match',
  playerGameplay: 'Not exercised: protocol peer only, no actual players/match',
  wan: 'Unverified: owned loopback TCP only',
};
const hash = value => createHash('sha256').update(value).digest('hex');
const helpers = {
  'openra-ra-runtime.py': 'd002fd25fe4ac70c3c7b60e724a7446ddcb02273e55485617552b133a6f18143',
  'openra-family.py': '773405bc3332894491237078bff36760191d15332944e8f33609d24d52fb0ee0',
  'native-console.py': 'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5',
};
async function helperIntegrity(c) {
  for (const [name, expected] of Object.entries(helpers)) if (hash(await c.read('/.voltra/' + name)) !== expected) throw Error('OpenRA reviewed launch helper changed: ' + name);
}
export function retentionPaths() { return [config, '/OpenRAData/motd.txt', '/OpenRAData/maps', '/OpenRAData/Replays']; }
export const retentionRequiredPath = config;
function owned(ctx) {
  const s = ctx.fixture?.server, f = ctx.fixture;
  if (!s || !/^[a-f0-9-]{36}$/.test(s.uuid) || s.uuid !== ctx.game.serverUUID ||
      s.name !== 'validator-' + ctx.game.id || f.name !== s.name ||
      f.recipe !== registration.openra.recipe || ctx.game.recipe !== f.recipe ||
      f.ports?.length !== 1 || !Number.isInteger(f.ports[0]) || f.ports[0] < 1 || f.ports[0] > 65535)
    throw Error('Exact owned Red Alert fixture and one TCP allocation required');
  return s;
}
export async function prerequisites(ctx, c) {
  owned(ctx);
  if (await c.state() !== 'offline' || (await native(ctx))?.state.Running) throw Error('OpenRA prerequisites require offline native fixture');
  for (const [key, value] of Object.entries(registration.openra.environment))
    if (ctx.game.environment?.[key] !== value) throw Error('OpenRA frozen environment mismatch: ' + key);
  ctx.openra = { marker: randomUUID() };
  return { required: false, tcpPort: ctx.fixture.ports[0], ...scope };
}
// Adapted from wave9 protocol helper, without executing its campaign CLI or
// replacing canonical runtime helpers. First connection sends no handshake.
function string(value) {
  const bytes = Buffer.from(value), prefix = []; let n = bytes.length;
  do { let b = n & 127; n >>>= 7; if (n) b |= 128; prefix.push(b); } while (n);
  return Buffer.concat([Buffer.from(prefix), bytes]);
}
function decode(bytes, offset) {
  let n = 0, shift = 0;
  for (let i = 0; i < 5; i++) {
    if (offset >= bytes.length) throw Error('Truncated OpenRA string');
    const b = bytes[offset++]; n |= (b & 127) << shift;
    if (!(b & 128)) {
      if (n < 0 || n > 131072 || offset + n > bytes.length) throw Error('OpenRA string bounds');
      return { value: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + n)), end: offset + n };
    }
    shift += 7;
  }
  throw Error('Oversized OpenRA string');
}
async function probe(ctx, sync = false) {
  owned(ctx); ctx.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: ctx.fixture.ports[0] });
    let buffer = Buffer.alloc(0), greeting, sent = false, done = false;
    const finish = (error, result) => {
      if (done) return; done = true; clearTimeout(timer); ctx.signal.removeEventListener('abort', abort);
      socket.destroy(); error ? reject(error) : resolve(result);
    };
    const abort = () => finish(ctx.signal.reason ?? Error('Aborted'));
    const timer = setTimeout(() => finish(Error('OpenRA protocol query timed out')), 7000);
    ctx.signal.addEventListener('abort', abort, { once: true });
    socket.on('error', error => finish(error)); socket.on('end', () => finish(Error('OpenRA closed before native evidence')));
    socket.on('data', block => {
      try {
        buffer = Buffer.concat([buffer, block]);
        if (buffer.length > 262144) throw Error('OpenRA response exceeds bounds');
        if (!greeting) {
          if (buffer.length < 8) return;
          greeting = { protocol: buffer.readInt32LE(0), client: buffer.readInt32LE(4) };
          if (greeting.protocol !== 7 || greeting.client < 0) throw Error('OpenRA protocol7 required');
          buffer = buffer.subarray(8);
        }
        while (buffer.length >= 8) {
          const length = buffer.readInt32LE(0), client = buffer.readInt32LE(4);
          if (length < 4 || length > 131072 || client < 0) throw Error('Invalid OpenRA frame');
          if (buffer.length < length + 8) return;
          const frame = buffer.readInt32LE(8), data = buffer.subarray(12, length + 8);
          buffer = buffer.subarray(length + 8);
          if (frame !== 0) throw Error('Expected idle OpenRA frame');
          for (let offset = 0; offset < data.length;) {
            const type = data[offset++]; if (type === 0x20) break;
            if (type !== 0xfe && type !== 0xff) throw Error('Unsupported OpenRA scalar order');
            const name = decode(data, offset); offset = name.end; let value = '';
            if (type === 0xff) {
              if (offset + 2 > data.length) throw Error('Truncated OpenRA flags');
              const flags = data.readUInt16LE(offset); offset += 2;
              if (flags !== 0 && flags !== 4) throw Error('Unsupported OpenRA order fields');
              if (flags === 4) { const text = decode(data, offset); offset = text.end; value = text.value; }
            } else { const text = decode(data, offset); offset = text.end; value = text.value; }
            if (name.value === 'HandshakeRequest' && !sent) {
              const text = value.replaceAll('\r\n', '\n');
              if (!text.includes('\n\tMod: ra\n') || !text.includes('\n\tVersion: release-20250330\n')) throw Error('Exact native RA release identity differs');
              if (!sync) return finish(null, { protocol: 7, mod: 'ra', version: 'release-20250330', handshakeResponseSent: false });
              const yaml = 'Handshake:\n\tMod: ra\n\tVersion: release-20250330\n\tPassword: \n\tOrdersProtocol: 21\nClient:\n\tName: VoltraProbe\n';
              const order = Buffer.concat([Buffer.from([0xfe]), string('HandshakeResponse'), string(yaml)]), prefix = Buffer.alloc(8);
              prefix.writeInt32LE(order.length + 4); socket.write(Buffer.concat([prefix, order])); sent = true;
            } else if (sent && ['AuthenticationError', 'ServerError'].includes(name.value)) throw new Blocked('OPENRA_NATIVE_ADMISSION', 'Native protocol peer refused; preserve fixture and review required user input.');
            else if (sent && name.value === 'SyncInfo' && /\bName: VoltraProbe(?:\r?\n|$)/.test(value)) {
              const globals = /^GlobalSettings:\r?\n((?:\t[^\n]*\n?)*)/m.exec(value)?.[1] ?? '';
              const scalars = [...globals.matchAll(/^\tEnableSyncReports: (True|False)\r?$/gm)];
              if (scalars.length !== 1 || scalars[0][1] !== 'True') throw Error('Independent native SyncInfo EnableSyncReports readback differs');
              return finish(null, { protocol: 7, responseOrder: 'SyncInfo', nativeEnableSyncReports: true, protocolPeerOnly: true });
            }
          }
        }
      } catch (error) { finish(error); }
    });
  });
}
export async function ready(ctx, c) {
  owned(ctx); const container = await native(ctx), boundary = ctx.startRequestedAt;
  if (!Number.isFinite(boundary)) throw Error('Missing fresh OpenRA startup boundary');
  if (!container || Date.parse(container.state.StartedAt) < boundary) return false;
  if (!container.state.Running) throw Error('Native OpenRA startup exited ' + container.state.ExitCode);
  const text = await logs(ctx);
  if (!text.includes('Starting dedicated server')) return false;
  if (await c.state() !== 'running') return false;
  await helperIntegrity(c);
  let query;
  try { query = await probe(ctx); }
  catch (error) { if (error.code === 'ECONNREFUSED' || /query timed out/.test(error.message)) return false; throw error; }
  await ctx.artifact('openra-startup.log', text);
  ctx.openra ??= {}; ctx.openra.startedAt = container.state.StartedAt;
  return { startedAt: container.state.StartedAt, query, ...scope };
}
async function stopped(ctx, c) {
  owned(ctx); const state = (await native(ctx))?.state;
  // Current native-console returns subprocess status -SIGINT unchanged;
  // Python SystemExit(-2) becomes container254. Require the actual native
  // status and intentional-stop receipt, not historical shell exit130.
  if (await c.state() !== 'offline' || !state || state.Running || state.OOMKilled || state.ExitCode !== 254 ||
      state.StartedAt !== ctx.openra?.startedAt || Date.parse(state.FinishedAt) < Date.parse(state.StartedAt))
    throw Error('OpenRA canonical Ctrl-C stop requires fresh exact container254 receipt');
  await helperIntegrity(c);
  const text = await logs(ctx);
  if (!text.includes('Native process exited: raw_status=-2; signal=2 (SIGINT); stop_requested=true.')) throw Error('OpenRA underlying native intentional SIGINT receipt missing');
  await ctx.artifact('openra-stop.log', text);
  return state;
}
export async function settings(ctx, c) {
  owned(ctx); await c.power('stop');
  await wait(ctx, async () => await c.state() === 'offline' && !(await native(ctx))?.state.Running, 'OpenRA settings stop');
  const stop = await stopped(ctx, c), url = '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent(config);
  let before;
  try { before = (await h.api(url)).attributes; }
  catch (error) { throw Error('Native MiniYaml unavailable; preserve fixture for adapter review. ' + error.message); }
  if (!before?.revision || !before.fields?.some(x => x.key === 'Server.EnableSyncReports' || x.name === 'Server.EnableSyncReports'))
    throw Error('Existing native Server.EnableSyncReports field required; inspect canonical settings seed');
  await h.api(url, 'PUT', { revision: before.revision, settings: { 'Server.EnableSyncReports': true } });
  ctx.startRequestedAt = Date.now(); await c.power('start'); await wait(ctx, () => ready(ctx, c), 'OpenRA edited readiness');
  return { file: config, settings: { 'Server.EnableSyncReports': true }, stop, query: await probe(ctx), nativeSyncInfo: await probe(ctx, true), ...scope };
}
async function snapshot(ctx) {
  const uuid = owned(ctx).uuid;
  // Read-only monitor preserves binary maps/replays and rejects symlinks. No
  // synthetic world/replay, source edit or replacement helper is installed.
  const script = `set -eu; cd /data/volumes/${uuid}; test ! -L OpenRAData; test -s OpenRAData/settings.yaml; for p in OpenRAData/settings.yaml OpenRAData/motd.txt OpenRAData/maps OpenRAData/Replays; do test ! -L "$p"; if [ -e "$p" ]; then test -z "$(find "$p" -type l -print)"; printf 'PRESENT %s\\n' "$p"; find "$p" -type f -exec sha256sum {} \\; -exec stat -c 'META %a %u %g %n' {} \\;; else printf 'ABSENT %s\\n' "$p"; fi; done`;
  const raw = await docker(['exec', 'voltra-validator-monitor', 'sh', '-c', script], ctx.signal);
  const text = raw.trimEnd().split('\n').sort().join('\n') + '\n';
  if (!/^[a-f0-9]{64}  OpenRAData\/settings.yaml$/m.test(text)) throw Error('Missing retained MiniYaml checksum');
  return text;
}
export function restoreContext(ctx, saved) {
  owned(ctx);
  if (!/^[a-f0-9-]{36}$/.test(saved?.marker ?? '') || typeof saved.snapshot !== 'string' ||
      saved.snapshotSha256 !== hash(saved.snapshot) || saved.exitCode !== 254 || saved.serverUUID !== ctx.fixture.server.uuid)
    throw Error('Missing exact owned OpenRA persistence receipt');
  ctx.openra = { ...ctx.openra, marker: saved.marker };
}
export async function saved(ctx, c) {
  const state = await stopped(ctx, c), text = await snapshot(ctx);
  if (!ctx.openra?.marker) throw Error('Missing owned OpenRA lifecycle marker');
  await ctx.artifact('openra-retained.sha256', text);
  return { marker: ctx.openra.marker, serverUUID: ctx.fixture.server.uuid, snapshot: text, snapshotSha256: hash(text),
    hashes: [{ file: config, sha256: /^([a-f0-9]{64})  OpenRAData\/settings.yaml$/m.exec(text)[1] }],
    exitCode: state.ExitCode, nativeStop: state, ...scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  if (!await ready(ctx, c)) throw Error('OpenRA reload lacks fresh native readiness');
  if (await snapshot(ctx) !== saved.snapshot) throw Error('OpenRA retained settings/motd/maps/existing replays changed');
  const query = await probe(ctx), nativeSyncInfo = await probe(ctx, true);
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'OpenRA reload stop');
  const stop = await stopped(ctx, c);
  return { query, nativeSyncInfo, retainedBytesModesOwnership: true, nativeStop: stop, canonicalSignalExit: { container: 254, native: -2, signal: 'SIGINT', stopRequested: true, helperHashes: helpers }, ...scope };
}
