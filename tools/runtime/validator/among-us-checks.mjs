import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Root owns routing, wave485 build admission, canonical install/reinstall and rollback gates.
export const registration = {
  crewlink: { recipe: 'among_us/bettercrewlink_server/egg-better-crewlink-server.json', ports: 1, environment: {} },
  impostor: { recipe: 'among_us/impostor_server/egg-among-us--impostor-server.json', ports: 1, environment: { AUTO_UPDATE: '0', PUBLIC_IP: '127.0.0.1' } },
};
const scope = {
  worldSave: 'N/A: idle lobby; config retention only',
  stdinSemanticCapability: { verified: false, gate: 'Separate genuine native stdin semantic check required; no echo acceptance' },
  consoleClassification: 'Separate root gate remains open', rollback: 'Separate root rollback gate remains open',
  players: 'Synthetic protocol peers only; no human/game players, voice, gameplay, WAN or TLS acceptance',
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const markerFile = '/validator-among-us-retention.txt';
function owned(ctx) {
  const s = ctx.fixture, r = registration[ctx.game.family];
  if (!r || ctx.game.recipe !== r.recipe || s?.recipe !== r.recipe || s.name !== 'validator-' + ctx.game.id || s.server?.name !== s.name || !/^[a-f0-9-]{36}$/.test(s.server?.uuid ?? '') || s.ports?.length !== 1 || !Number.isInteger(s.ports[0]) || s.ports[0] < 1 || s.ports[0] > 65535 || ctx.game.testStartup) throw Error('Among Us owned canonical fixture mismatch');
  return s;
}
const crew = ctx => ctx.game.family === 'crewlink';
const config = ctx => crew(ctx) ? '/crewlink/config/peerConfig.yml' : '/impostor/config.json';
const endpoint = ctx => '/api/client/servers/' + owned(ctx).server.uuid;
const settingsURL = ctx => endpoint(ctx) + '/game-settings?file=' + encodeURIComponent(config(ctx));
const view = async ctx => (await h.api(settingsURL(ctx))).attributes;
export function retentionPaths(ctx) { owned(ctx); return [config(ctx), markerFile]; }

export async function helperAuthority(ctx, c) {
  const s = owned(ctx), profile = h.profileFromRuntime(ctx.game.recipe, receipt);
  const served = (await h.api('/api/application/servers/' + s.server.id)).attributes;
  if (served.uuid !== s.server.uuid || served.name !== s.name || served.egg !== s.egg.id || served.container?.startup_command !== profile.egg.startup) throw Error('Canonical startup authority changed');
  const proofs = [];
  for (const match of profile.egg.scripts.installation.script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)) {
    const file = match[1];
    if (!file.endsWith('.py')) continue;
    if (!/^\.?[A-Za-z0-9_./-]+$/.test(file) || file.includes('..') || file.startsWith('/')) throw Error('Unsafe canonical helper path');
    const expected = hash(match[3] + '\n');
    if (hash(await c.read('/' + file)) !== expected) throw Error('Canonical helper integrity mismatch: ' + file);
    proofs.push({ file, sha256: expected });
  }
  if (!proofs.some(x => x.file.endsWith('among-us-runtime.py')) || (crew(ctx) && !proofs.some(x => x.file.endsWith('crewlink-controls.py')))) throw Error('Canonical family helper authority absent');
  return proofs;
}
export async function prerequisites(ctx) {
  const s = owned(ctx);
  if (crew(ctx) && typeof WebSocket !== 'function') throw Error('Node built-in WebSocket required');
  return { required: false, allocation: s.ports[0], canonicalHelperRequired: true, ...scope };
}
async function http(ctx, path, options = {}) {
  ctx.signal.throwIfAborted();
  const response = await fetch('http://127.0.0.1:' + owned(ctx).ports[0] + path, { ...options, redirect: 'error', signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(4000)]) });
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 65536) throw Error('Native HTTP response exceeds probe limit'); chunks.push(chunk); }
  return { status: response.status, text: Buffer.concat(chunks).toString('utf8') };
}
async function health(ctx) {
  const r = await http(ctx, '/health');
  if (r.status !== 200) throw Error('CrewLink HTTP health failed');
  const v = JSON.parse(r.text);
  if (!Number.isInteger(v.connectionCount) || !Number.isInteger(v.lobbiesCount)) throw Error('CrewLink health shape mismatch');
  return { connectionCount: v.connectionCount, lobbiesCount: v.lobbiesCount };
}
async function until(ctx, test, label) {
  const end = Date.now() + 5000;
  do { ctx.signal.throwIfAborted(); const result = test(); if (result) return result; await delay(40, undefined, { signal: ctx.signal }); } while (Date.now() < end);
  throw Error('CrewLink protocol timeout: ' + label);
}
async function crewProtocol(ctx, expected) {
  if (typeof expected !== 'boolean') throw Error('Independent CrewLink setting required');
  const initial = await health(ctx);
  if (initial.connectionCount !== 0 || initial.lobbiesCount !== 0) throw Error('CrewLink probe requires empty owned lobby');
  const peers = [];
  const abort = () => { for (const p of peers) p.ws?.close(); };
  ctx.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 18000);
  try {
    for (let i = 0; i < 2; i++) {
      const p = { events: [], open: false, namespace: false, failed: false, frames: 0 };
      peers.push(p);
      p.ws = new WebSocket('ws://127.0.0.1:' + owned(ctx).ports[0] + '/socket.io/?EIO=3&transport=websocket');
      p.ws.addEventListener('error', () => { p.failed = true; });
      p.ws.addEventListener('message', event => {
        try {
          const frame = String(event.data);
          if (++p.frames > 80 || frame.length > 16384) throw Error('Frame budget');
          if (frame.startsWith('0')) { const e = JSON.parse(frame.slice(1)); if (typeof e.sid !== 'string') throw Error('Open shape'); p.open = true; }
          else if (frame === '2') p.ws.send('3');
          else if (frame.startsWith('40')) p.namespace = true;
          else if (frame.startsWith('42')) p.events.push(JSON.parse(frame.slice(2)));
        } catch { p.failed = true; p.ws.close(); }
      });
      p.send = (event, ...args) => p.ws.send('42' + JSON.stringify([event, ...args]));
    }
    const event = (p, name) => { if (p.failed) throw Error('CrewLink protocol/frame failure'); return p.events.find(e => e[0] === name); };
    for (const p of peers) {
      await until(ctx, () => { if (p.failed) throw Error('CrewLink connection failed'); return p.open; }, 'Engine.IO 3 open');
      await delay(100, undefined, { signal: ctx.signal });
      if (!p.namespace) p.ws.send('40');
      const e = await until(ctx, () => event(p, 'clientPeerConfig'), 'peer config');
      if (e[1]?.forceRelayOnly !== expected || e[1]?.iceServers?.some(s => /turns?:/i.test(String(s.urls)))) throw Error('CrewLink independent peer readback/relay mismatch');
    }
    const [a, b] = peers, lobby = 'VALIDATOR_' + randomUUID();
    a.send('id', 101, 1001); a.send('join', lobby, 101, 1001, true);
    await until(ctx, () => event(a, 'setClients'), 'host membership');
    b.send('id', 102, 1002); b.send('join', lobby, 102, 1002, false);
    const set = await until(ctx, () => event(b, 'setClients'), 'guest membership');
    const join = await until(ctx, () => event(a, 'join'), 'guest announcement');
    const host = Object.keys(set[1])[0], guest = join[1];
    if (!host || !guest || set[1][host]?.playerId !== 101 || join[2]?.playerId !== 102) throw Error('CrewLink membership mismatch');
    const payload = randomUUID(); a.send('signal', { to: guest, data: payload });
    const signal = await until(ctx, () => event(b, 'signal'), 'signal relay');
    if (signal[1]?.from !== host || signal[1]?.data !== payload) throw Error('CrewLink relay mismatch');
    const live = await health(ctx);
    if (live.connectionCount !== 2 || live.lobbiesCount !== 1) throw Error('CrewLink live counters mismatch');
  } finally { clearTimeout(timer); ctx.signal.removeEventListener('abort', abort); abort(); }
  await wait(ctx, async () => { const v = await health(ctx); return v.connectionCount === 0 && v.lobbiesCount === 0; }, 'CrewLink synthetic peer cleanup', 5000);
  return { engineIO: 3, socketIO: true, syntheticPeers: 2, membership: true, relay: true, forceRelayOnly: expected, disconnectCleanup: true };
}
async function impostorProtocol(ctx) {
  const hello = await http(ctx, '/');
  if (hello.status !== 200 || !hello.text.includes('Impostor is running')) throw Error('Impostor native greeting failed');
  const options = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if ((await http(ctx, '/api/user', options({}))).status !== 400) throw Error('Impostor malformed auth not rejected');
  const request = { Puid: 'validator-' + randomUUID(), Username: 'ValidatorProbe', ClientVersion: 20240712, Language: 0 };
  const auth = await http(ctx, '/api/user', options(request));
  let token;
  try { const wire = auth.text.trim(); token = JSON.parse(Buffer.from(wire.startsWith('"') ? JSON.parse(wire) : wire, 'base64').toString('utf8')); } catch { throw Error('Impostor auth response shape mismatch'); }
  if (auth.status !== 200 || token.Content?.Puid !== request.Puid || token.Content?.ClientVersion !== request.ClientVersion) throw Error('Impostor native auth roundtrip failed');
  const port = owned(ctx).ports[0];
  // Read only the exact owned container's UDP namespace. No host-wide listener inference.
  const rows = await docker(['exec', ctx.fixture.server.uuid, 'cat', '/proc/net/udp', '/proc/net/udp6'], ctx.signal, 5000);
  if (rows.length > 65536 || !rows.split('\n').some(line => { const cols = line.trim().split(/\s+/); return /^\d+:$/.test(cols[0]) && parseInt(cols[1]?.split(':').at(-1), 16) === port; })) throw Error('Impostor owned UDP listener missing');
  return { hello: 200, malformedAuth: 400, validAuth: 200, puidRoundtrip: true, versionRoundtrip: true, ownedUDPBound: true, credentialsRetained: false, udpGameHandshake: false };
}
function field(doc, key) { const fields = doc.fields?.filter(f => f.key === key); if (fields?.length !== 1) throw Error('Missing/ambiguous typed setting: ' + key); return fields[0]; }
export async function ready(ctx, c) {
  owned(ctx); const n = await native(ctx);
  if (!Number.isFinite(ctx.startRequestedAt)) throw Error('Fresh start boundary missing');
  if (!n?.state.Running) { if (n && Date.parse(n.state.StartedAt) >= ctx.startRequestedAt && n.state.ExitCode !== 0) throw Error('Among Us native startup exited ' + n.state.ExitCode); return false; }
  if (!(Date.parse(n.state.StartedAt) >= ctx.startRequestedAt)) return false;
  const helpers = await helperAuthority(ctx, c);
  const text = await docker(['logs', '--tail', '200', '--since', n.state.StartedAt, n.id], ctx.signal, 5000);
  if (crew(ctx) && !text.includes('BetterCrewLink Server started:')) return false;
  if (!crew(ctx) && !text.includes('Matchmaker is listening on')) return false;
  let advertisedIP;
  if (!crew(ctx)) {
    advertisedIP = field(await view(ctx), '/Server/PublicIp').value;
    const clean = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    if (!/^127\.0\.0\.[123]$/.test(advertisedIP) || !clean.includes('the public server ip is ' + advertisedIP + ':')) throw Error('Impostor native advertised-IP readback mismatch');
  }
  const protocol = crew(ctx) ? await crewProtocol(ctx, field(await view(ctx), '/forceRelayOnly').value) : await impostorProtocol(ctx);
  return { containerId: n.id, startedAt: n.state.StartedAt, helpers, protocol, ...(advertisedIP ? { nativeAdvertisedIP: advertisedIP } : {}), ...scope };
}
async function stopped(ctx, c) {
  const n = await native(ctx);
  if (await c.state() !== 'offline' || !n || n.state.Running || n.state.ExitCode !== 0 || n.state.OOMKilled || !(Date.parse(n.state.StartedAt) >= ctx.startRequestedAt) || !(Date.parse(n.state.FinishedAt) >= Date.parse(n.state.StartedAt))) throw Error('Fresh clean native stop required');
  return n.state;
}
export async function settings(ctx, c) {
  await helperAuthority(ctx, c);
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline' && !(await native(ctx))?.state.Running, 'Among Us settings stop');
  await stopped(ctx, c);
  const before = await view(ctx), raw = await c.read(config(ctx));
  const key = crew(ctx) ? '/forceRelayOnly' : '/Server/PublicIp';
  const f = field(before, key);
  if (f.readonly || f.readOnly || f.type !== (crew(ctx) ? 'boolean' : 'text')) throw Error('Editable native typed field missing');
  const value = crew(ctx) ? !f.value : f.value === '127.0.0.2' ? '127.0.0.3' : '127.0.0.2';
  if (crew(ctx) && typeof f.value !== 'boolean') throw Error('CrewLink boolean type mismatch');
  if (!crew(ctx)) for (const k of ['/Server/ListenIp', '/Server/ListenPort', '/HttpServer/ListenIp', '/HttpServer/ListenPort']) { const x = field(before, k); if (!(x.readonly ?? x.readOnly)) throw Error('Allocated listener must remain readonly'); }
  await h.api(settingsURL(ctx), 'PUT', { revision: before.revision, settings: { [key]: value } });
  const after = await view(ctx), patched = await c.read(config(ctx));
  if (field(after, key).value !== value) throw Error('Typed setting readback mismatch');
  const comparable = doc => doc.fields.filter(x => x.key !== key).map(x => ({ key: x.key, value: x.value, type: x.type, readonly: x.readonly ?? x.readOnly, secret: x.secret }));
  if (!isDeepStrictEqual(comparable(before), comparable(after))) throw Error('Unrelated typed fields changed');
  if (crew(ctx)) {
    // Preserve secret-bearing YAML scalars without returning their contents.
    const scalars = text => text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#') && !/^forceRelayOnly\s*:/.test(line)).sort();
    if (!isDeepStrictEqual(scalars(raw), scalars(patched))) throw Error('Unrelated YAML values or credentials changed; root must review normalization');
  }
  if (!crew(ctx)) { const expected = JSON.parse(raw); expected.Server.PublicIp = value; if (!isDeepStrictEqual(expected, JSON.parse(patched))) throw Error('Unrelated JSON changed'); }
  ctx.amongUs = { marker: randomUUID(), key, value }; await c.write(markerFile, ctx.amongUs.marker);
  ctx.startRequestedAt = Date.now(); await c.power('start');
  const readiness = await wait(ctx, () => ready(ctx, c), 'Among Us settings readiness');
  if (hash(await c.read(config(ctx))) !== hash(patched)) throw Error('Native startup changed edited config');
  return { file: config(ctx), key, value, native: readiness, consumption: crew(ctx) ? 'Independent native clientPeerConfig readback' : 'Fresh native Matchmaker advertised-IP readback plus authentication and listener', ...scope };
}
export function restoreContext(ctx, saved) {
  const s = owned(ctx), key = crew(ctx) ? '/forceRelayOnly' : '/Server/PublicIp';
  if (saved?.uuid !== s.server.uuid || saved.family !== ctx.game.family || saved.port !== s.ports[0] || saved.key !== key || !/^[a-f0-9-]{36}$/.test(saved.marker ?? '') || (crew(ctx) ? typeof saved.value !== 'boolean' : !['127.0.0.2', '127.0.0.3'].includes(saved.value))) throw Error('Among Us retained identity mismatch');
  for (const file of retentionPaths(ctx)) if (saved.hashes?.filter(x => x.file === file && /^[a-f0-9]{64}$/.test(x.sha256)).length !== 1) throw Error('Missing config retention hash');
  ctx.amongUs = { marker: saved.marker, key, value: saved.value };
}
export async function saved(ctx, c) {
  const s = owned(ctx); await stopped(ctx, c); await helperAuthority(ctx, c);
  const state = ctx.amongUs;
  if (!state || await c.read(markerFile) !== state.marker || field(await view(ctx), state.key).value !== state.value) throw Error('Among Us config checkpoint missing');
  const hashes = [];
  for (const file of retentionPaths(ctx)) { const bytes = await c.read(file); if (!bytes.trim()) throw Error('Empty retained config'); hashes.push({ file, sha256: hash(bytes) }); }
  return { uuid: s.server.uuid, family: ctx.game.family, port: s.ports[0], ...state, hashes, ...scope };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  const readiness = await ready(ctx, c); if (!readiness) throw Error('Fresh retained native readiness missing');
  for (const entry of saved.hashes) if (!retentionPaths(ctx).includes(entry.file) || hash(await c.read(entry.file)) !== entry.sha256) throw Error('Retained config bytes changed');
  if (await c.read(markerFile) !== saved.marker || field(await view(ctx), saved.key).value !== saved.value) throw Error('Retained native setting mismatch');
  return { native: readiness, configRetained: true, hashes: saved.hashes, ...scope };
}
