import dgram from 'node:dgram';
import { randomUUID, createHash } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Idle operator adapter. Root owns registration, runtime admission,
// canonical installation, native execution and closure. Importing has no effects.
const recipe = 'gta/gtac/egg-grand-theft-auto-connected.json';
const config = '/gtac/server.xml';
export const registration = {
  gtac: { recipe, ports: 1, peakMiB: 1024, installPeakMiB: 2048, diskMiB: 4096,
    environment: { DL_VERSION: '1.7.3', GAMETYPE: 'gta:iv', SERVERNAME: 'Validator GTAC',
      MAX_PLAYERS: '12', SERVERBROWSER: 'false', SERVER_PASSWORD: '' } },
};
const reviewed = {
  'gtac-runtime.py': '42ae3920b4818a6f77535d03e21404df89a9c23846f70dd61248ed2bd2c728c7',
  'gta-runtime.py': 'c0fe5ca7bc485b5ea6ff49c7fded2dab9ec4e0092e3b50b52c37bcb39599876a',
  'native-config.py': '8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2',
  'native-console.py': 'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5',
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const findings = Object.freeze({
  source: 'activecandidate5; GTAC source unchanged; frozen runtime profile and installed emitted bytes checked at execution',
  settings: 'Startup controls are writable authority. Managed XML scalars are intentionally readonly; editable typed XML support is not claimed.',
  scope: 'Idle native UDP name/capacity and JavaScript resource persistence only; no players, world, gameplay, WAN or master-listing acceptance.',
  serverbrowser: 'Served startup value and launcher-managed XML are checked. Historical UDP decoder exposes no reviewed serverbrowser readback; native browser consumption remains unproved.',
});
// Read-only disassembly of the retained publisher Server, not a native pass.
// ParseConfig GetBoolValue("serverbrowser", false) stores this+0x221;
// server.listed's registered getter reads precisely that native byte.
export const serverbrowserAuthority = Object.freeze({
  binarySHA256: '450fb81a4c451503058fbefc68000f0647b9f46cfb787db43a1ec90516bcb787',
  source: 'Retained publisher .local/gta-next/gtac.tar.gz:Server',
  parseConfig: '0x75cc9 key; 0x75cd3 GetBoolValue; 0x75ce4 stores this+0x221',
  registration: '0x89abc AddNamespace(server); 0x89b0f getter; 0x89b1b property listed',
  getter: '0x8bbd0 FunctionGetServerListed; 0x8bbe5 reads this+0x221',
  documentation: 'https://wiki.gtaconnected.com/server.listed',
  scope: 'Native configured false readback only; true/public listing, announcement success and WAN untested',
});
function owned(ctx) {
  const f = ctx.fixture, s = f?.server;
  if (ctx.game?.family !== 'gtac' || ctx.game.recipe !== recipe || f?.recipe !== recipe ||
      !s || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s.uuid ?? '') ||
      s.uuid !== ctx.game.serverUUID || f.name !== 'validator-' + ctx.game.id || s.name !== f.name ||
      !Number.isInteger(s.id) || !Number.isInteger(f.egg?.id) || ctx.game.testStartup ||
      f.ports?.length !== 1 || !Number.isInteger(f.ports[0]) || f.ports[0] < 1 || f.ports[0] > 65535)
    throw Error('GTAC requires exact owned canonical fixture, UUID and one allocation');
  ctx.signal.throwIfAborted();
  return f;
}
export const retentionRequiredPath = config;
export function retentionPaths(ctx) {
  owned(ctx);
  // Preserve the entire original resource tree, including custom script data.
  // Include native modules/plugins and resource data in the root installer snapshot.
  return [config, '/gtac', '/resources', '/plugins', '/mods', ...Object.keys(reviewed).map(name => '/.voltra/' + name)];
}
export async function helperAuthority(ctx, c) {
  const f = owned(ctx), profile = h.profileFromRuntime(recipe, receipt);
  const served = (await h.api('/api/application/servers/' + f.server.id)).attributes;
  if (served.uuid !== f.server.uuid || served.name !== f.name || served.egg !== f.egg.id ||
      served.container?.startup_command !== profile.egg.startup)
    throw Error('GTAC served startup/egg authority differs from frozen profile');
  const emitted = new Map();
  for (const m of profile.egg.scripts.installation.script.matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)) {
    const path = m[1];
    if (!/^\.?[A-Za-z0-9_./-]+$/.test(path) || path.includes('..') || path.startsWith('/'))
      throw Error('Unsafe frozen GTAC helper emission path');
    if (emitted.has(path)) throw Error('Ambiguous frozen GTAC helper emission');
    emitted.set(path, sha256(m[3] + '\n'));
  }
  const proofs = [];
  for (const [name, expected] of Object.entries(reviewed)) {
    const relative = '.voltra/' + name;
    if (emitted.get(relative) !== expected || sha256(await c.read('/' + relative)) !== expected)
      throw Error('GTAC frozen/installed helper authority mismatch: ' + name);
    proofs.push({ file: relative, sha256: expected });
  }
  return proofs;
}
const attrs = x => x?.attributes ?? x;
const resource = '/gtac/resources/validator_idle';
const controls = { SERVERNAME: 'Validator "GTAC" $ edited', MAX_PLAYERS: '7', SERVERBROWSER: 'false' };
const managed = ['servername', 'game', 'maxplayers', 'serverbrowser', 'password', 'port', 'httpport', 'bindip'];
const route = ctx => '/api/client/servers/' + owned(ctx).server.uuid;
async function startup(ctx, c, expected) {
  const rows = (await c.api('GET', route(ctx) + '/startup')).data.map(attrs);
  const coverage = {};
  for (const [key, value] of Object.entries(expected)) {
    const matches = rows.filter(x => x.env_variable === key);
    if (matches.length !== 1 || String(matches[0].server_value) !== value) throw Error('GTAC served startup mismatch: ' + key);
    coverage[key] = { value, exposed: true };
  }
  return coverage;
}
async function readonly(ctx, c) {
  const doc = attrs(await c.api('GET', route(ctx) + '/game-settings?file=' + encodeURIComponent(config)));
  for (const key of managed) {
    const fields = doc.fields?.filter(x => x.key === key);
    if (fields?.length !== 1 || !(fields[0].readonly || fields[0].readOnly || fields[0].type === 'readonly' || fields[0].kind === 'readonly'))
      throw Error('GTAC managed XML readonly field missing: ' + key);
  }
  const raw = await c.read(config);
  const browser = raw.match(/<serverbrowser>([^<]*)<\/serverbrowser>/g);
  if (browser?.length !== 1 || browser[0] !== '<serverbrowser>' + (ctx.gtac?.controls.SERVERBROWSER ?? 'false') + '</serverbrowser>')
    throw Error('GTAC launcher-managed serverbrowser XML differs');
  return { managedReadonly: managed, editableTypedXML: false, serverbrowserDiskOnly: true };
}
// Hash binary resource/module/plugin data using the existing read-only monitor.
// Never pass file contents through the text contents API.
async function files(ctx, c) {
  const result = [];
  async function walk(dir) {
    const rows = (await c.api('GET', route(ctx) + '/files/list?directory=' + encodeURIComponent(dir))).data.map(attrs);
    for (const row of rows) {
      if (!row.name || row.name === '.' || row.name === '..' || /[/\\\0]/.test(row.name) || row.is_symlink)
        throw Error('Unsafe GTAC retained tree entry');
      const file = dir + '/' + row.name;
      // Native append-only console log is diagnostic output, not retained config/resource data.
      if (file === '/gtac/logs') continue;
      if (row.is_file) {
        const path = '/data/volumes/' + owned(ctx).server.uuid + file;
        const digest = (await docker(['exec', 'voltra-validator-monitor', 'sha256sum', path], ctx.signal)).slice(0, 64);
        const metadata = (await docker(['exec', 'voltra-validator-monitor', 'stat', '-c', '%a:%u:%g:%s', path], ctx.signal)).trim();
        if (!/^[a-f0-9]{64}$/.test(digest) || !/^\d+:\d+:\d+:\d+$/.test(metadata)) throw Error('Invalid GTAC file snapshot');
        result.push({ file, sha256: digest, metadata });
      } else if (row.is_directory || row.is_file === false) await walk(file);
      else throw Error('Unsupported GTAC retained file type');
    }
  }
  await walk('/gtac');
  return result.sort((a, b) => a.file.localeCompare(b.file));
}
function unchanged(before, after, exceptions = []) {
  for (const entry of before) {
    if (exceptions.includes(entry.file)) continue;
    const other = after.find(x => x.file === entry.file);
    if (!other || other.sha256 !== entry.sha256 || other.metadata !== entry.metadata) throw Error('GTAC retained bytes/metadata changed: ' + JSON.stringify({before:entry,after:other??null}));
  }
}
// The canonical launcher serializes XML on launch. Compare unmanaged XML after
// that first normalization, preserving all remaining bytes on later launches.
function opaque(raw) {
  for (const key of managed) {
    raw = raw.replace(new RegExp('<'+key+'\\s*/>', 'g'), '<'+key+'></'+key+'>');
    const re = new RegExp('(<'+key+'>)[^<]*(</'+key+'>)', 'g'); let count = 0;
    raw = raw.replace(re, (_m, a, b) => { count++; return a + b; });
    if (count !== 1) throw Error('GTAC managed XML span missing/ambiguous: ' + key);
  }
  return raw;
}
async function query(ctx) {
  const port = owned(ctx).ports[0]; ctx.signal.throwIfAborted();
  const packet = await new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4'); let done = false;
    const finish = (error, bytes) => { if (done) return; done = true; clearTimeout(timer); ctx.signal.removeEventListener('abort', abort); try { socket.close(); } catch {} error ? reject(error) : resolve(bytes); };
    const abort = () => finish(Error('GTAC UDP query aborted'));
    const timer = setTimeout(() => finish(Error('GTAC native UDP query timeout')), 3000);
    socket.once('error', () => finish(Error('GTAC UDP socket failed')));
    socket.on('message', (bytes, peer) => { if (peer.address === '127.0.0.1' && peer.port === port) finish(null, bytes); });
    ctx.signal.addEventListener('abort', abort, { once: true });
    // Exact historical gtac-query.mjs request; no player connection.
    socket.send(Buffer.from([255,255,85,71,80,0,1,1,1,0x65]), port, '127.0.0.1', error => { if (error) finish(Error('GTAC UDP send failed')); });
    if (ctx.signal.aborted) abort();
  });
  if (packet.length < 16 || packet.length > 4096 || !packet.subarray(0, 6).equals(Buffer.from([255,255,85,71,80,0]))) throw Error('Invalid GTAC native query header');
  let offset = 11;
  const string = () => { const length = packet[offset++]; if (!length || offset + length > packet.length - 2 || packet[offset + length - 1] !== 0) throw Error('Invalid GTAC query string'); const text = new TextDecoder('utf-8', { fatal: true }).decode(packet.subarray(offset, offset + length - 1)); offset += length; return text; };
  const product = string(), name = string(), maxPlayers = packet.readUInt16BE(packet.length - 2);
  if (product !== 'Grand Theft Auto: Connected') throw Error('Wrong GTAC UDP product');
  const expected = ctx.gtac?.controls ?? registration.gtac.environment;
  if (name !== expected.SERVERNAME || maxPlayers !== Number(expected.MAX_PLAYERS)) throw Error('GTAC native UDP settings differ');
  return { product, name, maxPlayers, responseSha256: sha256(packet), responseBytes: packet.length, serverbrowserVerified: false, playerJoin: false };
}
async function processIdentity(ctx) {
  // A wrapper/container start alone cannot establish native fresh-process identity.
  const code = `import pathlib,json,os
rows=[]
for p in pathlib.Path('/proc').iterdir():
 if p.name.isdigit():
  try:
   if os.readlink(p/'exe')=='/home/container/gtac/Server':
    stat=(p/'stat').read_text(); tail=stat[stat.rfind(')')+2:].split()
    rows.append({'pid':int(p.name),'startTicks':tail[19]})
  except (FileNotFoundError,PermissionError,ProcessLookupError): pass
assert len(rows)==1,'Expected unique actual GTAC Server process'
print(json.dumps(rows[0]))`;
  return JSON.parse(await docker(['exec', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', owned(ctx).server.uuid, '/home/container/.voltra/python/bin/python3', '-B', '-c', code], ctx.signal));
}
async function clean(ctx, c) {
  const n = await native(ctx);
  if (await c.state() !== 'offline' || !n || n.state.Running || n.state.OOMKilled || n.state.ExitCode !== 0 ||
      !Number.isFinite(ctx.startRequestedAt) || Date.parse(n.state.StartedAt) < ctx.startRequestedAt ||
      !(Date.parse(n.state.FinishedAt) >= Date.parse(n.state.StartedAt))) throw Error('GTAC requires fresh clean native exit 0');
  const text = await logs(ctx, n.state.StartedAt);
  if (!text.includes('Server shutting down...')) throw Error('GTAC native shutdown evidence missing');
  return { containerId: n.id, startedAt: n.state.StartedAt, finishedAt: n.state.FinishedAt, exitCode: 0, logSha256: sha256(text) };
}
async function stop(ctx, c) {
  await c.power('stop'); await wait(ctx, async () => await c.state() === 'offline', 'GTAC graceful stop'); return clean(ctx, c);
}
async function start(ctx, c) {
  ctx.startRequestedAt = Date.now(); await c.power('start'); return wait(ctx, () => ready(ctx, c), 'GTAC native restart');
}
export async function prerequisites(ctx, c) {
  owned(ctx);
  if (await c.state() !== 'offline' || (await native(ctx))?.state.Running) throw Error('GTAC prerequisites require stopped fixture');
  for (const [key, value] of Object.entries(registration.gtac.environment))
    if (ctx.game.environment?.[key] !== value) throw Error('GTAC frozen environment mismatch: ' + key);
  const helpers = await helperAuthority(ctx, c);
  const originalFiles = await files(ctx, c);
  const resumed = originalFiles.some(x => x.file === resource + '/server.js');
  const initial = { ...registration.gtac.environment, ...(resumed ? controls : {}) };
  const coverage = await startup(ctx, c, initial);
  ctx.gtac = { controls: initial, originalFiles };
  await ctx.artifact('gtac-prestart-files.json', ctx.gtac.originalFiles);
  return { helpers, startupCoverage: coverage, findings };
}
export async function ready(ctx, c) {
  owned(ctx); const n = await native(ctx);
  if (!Number.isFinite(ctx.startRequestedAt)) throw Error('GTAC fresh start boundary required');
  if (!n || Date.parse(n.state.StartedAt) < ctx.startRequestedAt) return false;
  if (!n.state.Running) throw Error('GTAC exited before readiness: ' + n.state.ExitCode);
  const text = await logs(ctx, n.state.StartedAt);
  if (!text.includes('Server is now listening on port ' + ctx.fixture.ports[0] + ' max players ') || !/\d+\/\d+ Resources loaded, 0 failed/.test(text) || await c.state() !== 'running') return false;
  const helpers = await helperAuthority(ctx, c), protocol = await query(ctx), process = await processIdentity(ctx);
  if (ctx.gtac?.marker && !text.includes('VOLTRA_GTAC_SAVED_' + ctx.gtac.marker)) throw Error('GTAC native resource save callback missing');
  const identity = { containerId: n.id, startedAt: n.state.StartedAt, process };
  ctx.gtac ??= { controls: { ...registration.gtac.environment } };
  ctx.gtac.running = identity;
  return { ...identity, helpers, protocol, logSha256: sha256(text), findings };
}
export async function settings(ctx, c) {
  owned(ctx); await stop(ctx, c); await helperAuthority(ctx, c);
  const before = await c.read(config), baseline = await files(ctx, c);
  await ctx.artifact('gtac-first-stopped-files.json', baseline);
  await readonly(ctx, c);
  if ((before.match(/<\/resources>/g) ?? []).length !== 1) throw Error('GTAC existing resources element unavailable or ambiguous');
  if (ctx.gtac.originalFiles) unchanged(ctx.gtac.originalFiles, baseline, [config]);
  const existing = baseline.some(x => x.file.startsWith(resource + '/'));
  const oldScript = existing ? await c.read(resource + '/server.js') : '';
  const marker = existing ? oldScript.match(/VOLTRA_GTAC_SAVED_([a-f0-9-]{36})/)?.[1] : randomUUID();
  if (!marker || (existing && !before.includes('<resource src="validator_idle" />')) || (!existing && before.includes('validator_idle'))) throw Error('GTAC existing resource ownership unclear');
  // Native callback protocol copied from the historical idle acceptance resource.
  const script = '"use strict";\nlet restored = loadTextFile("marker.txt");\nif (restored !== null) {\n if (restored !== "'+marker+'") throw new Error("Unexpected persisted marker");\n console.log("VOLTRA_GTAC_RESTORED_'+marker+'");\n}\nsaveTextFile("marker.txt", "'+marker+'");\nconsole.log("VOLTRA_GTAC_SAVED_'+marker+'");\naddEventHandler("OnResourceStop", function(event, resource) {\n if (resource === thisResource) {\n saveTextFile("marker.txt", "'+marker+'");\n console.log("VOLTRA_GTAC_SHUTDOWN_'+marker+'");\n }\n});\n';
  if (existing && (oldScript !== script || await c.read(resource + '/meta.xml') !== '<meta><info name="Validator idle persistence" author="Voltra" type="script" /><script src="server.js" type="server" language="javascript" /></meta>\n')) throw Error('GTAC existing validator resource bytes differ; preserve');
  if (!existing) await c.api('POST', route(ctx) + '/files/create-folder', { root: '/gtac/resources', name: 'validator_idle' });
  await c.write(resource + '/meta.xml', '<meta><info name="Validator idle persistence" author="Voltra" type="script" /><script src="server.js" type="server" language="javascript" /></meta>\n');
  await c.write(resource + '/server.js', script);
  const patched = existing ? before : before.replace('</resources>', '<resource src="validator_idle" /></resources>');
  await c.write(config, patched);
  await h.api('/api/application/servers/' + owned(ctx).server.id + '/startup', 'PATCH', { environment: controls });
  const coverage = await startup(ctx, c, controls);
  if (await c.read(config) !== patched) throw Error('GTAC startup PATCH unexpectedly modified stopped XML');
  unchanged(baseline, await files(ctx, c), [config]);
  ctx.gtac = { ...ctx.gtac, controls: { ...controls }, marker, opaque: sha256(opaque(patched)), baseline };
  const readiness = await start(ctx, c);
  if (sha256(opaque(await c.read(config))) !== ctx.gtac.opaque) throw Error('GTAC launcher changed unrelated XML bytes');
  unchanged(baseline, await files(ctx, c), [config]);
  const xmlAuthority = await readonly(ctx, c);
  const result = { startupCoverage: coverage, nativeUDP: readiness.protocol, xmlAuthority, resource: 'native idle script save/restore/shutdown', serverbrowserNativeGap: findings.serverbrowser, allStartupControlsNativeVerified: false, findings };
  await ctx.artifact('gtac-settings.json', result); return result;
}
export function restoreContext(ctx, saved) {
  owned(ctx);
  if (saved?.fixture !== ctx.fixture.server.uuid || saved.port !== ctx.fixture.ports[0] || !/^[a-f0-9-]{36}$/.test(saved.marker ?? '') ||
      !/^[a-f0-9]{64}$/.test(saved.opaque ?? '') || saved.exit?.exitCode !== 0 || !saved.running?.process?.startTicks ||
      !Array.isArray(saved.files) || !saved.files.some(x => x.file === resource + '/marker.txt') ||
      saved.files.some(x => !x.file.startsWith('/gtac/') || x.file.split('/').includes('..') || !/^[a-f0-9]{64}$/.test(x.sha256)) ||
      Object.entries(controls).some(([k, v]) => saved.controls?.[k] !== v)) throw Error('GTAC genuine retained idle identity missing');
  ctx.gtac = { controls: saved.controls, marker: saved.marker, opaque: saved.opaque, running: saved.running, baseline: saved.files };
}
// Narrow follow-up for a genuine previously passed, parked idle fixture.
// No change to publication controls or historical lifecycle/retention results.
export async function serverbrowserReadback(ctx, c, saved) {
  restoreContext(ctx, saved);
  if (await c.state() !== 'offline' || (await native(ctx))?.state.Running || saved.controls.SERVERBROWSER !== 'false')
    throw Error('GTAC serverbrowser follow-up requires parked private fixture');
  await helperAuthority(ctx, c); await startup(ctx, c, controls); await readonly(ctx, c);
  const binary = (await docker(['exec', 'voltra-validator-monitor', 'sha256sum', '/data/volumes/' + owned(ctx).server.uuid + '/gtac/Server'], ctx.signal)).slice(0, 64);
  if (binary !== serverbrowserAuthority.binarySHA256) throw Error('GTAC reviewed native listed getter binary differs');
  const path = resource + '/server.js', original = await c.read(path);
  const accepted = saved.files.filter(row => row.file === path);
  if (accepted.length !== 1 || accepted[0].sha256 !== sha256(original) || !original.includes('VOLTRA_GTAC_SAVED_' + saved.marker) || original.includes('VOLTRA_GTAC_LISTED_'))
    throw Error('GTAC accepted owned idle resource differs');
  unchanged(saved.files, await files(ctx, c));
  const nonce = randomUUID(), marker = 'VOLTRA_GTAC_LISTED_' + nonce + '_false';
  const probe = '\n// Bounded native getter readback; no publication mutation.\nif (typeof server.listed !== "boolean" || server.listed !== false) throw new Error("Native private listing setting differs");\nconsole.log("' + marker + '");\n';
  await c.write(path, original + probe);
  await ctx.artifact('gtac-serverbrowser-probe-staged.json', { nonce, authority: serverbrowserAuthority, priorScriptSHA256: accepted[0].sha256 });
  // A failed probe stays preserved for inspection; do not erase failed output.
  const readiness = await start(ctx, c);
  const text = await wait(ctx, async () => {
    const output = await logs(ctx, readiness.startedAt);
    return output.split(/\r?\n/).some(line => line.replace(/\x1b\[[0-9;]*m/g, '') === marker) ? output : false;
  }, 'GTAC actual native private listing getter');
  await stop(ctx, c);
  if (await c.read(path) !== original + probe) throw Error('GTAC owned probe changed during execution');
  await c.write(path, original);
  unchanged(saved.files, await files(ctx, c));
  const result = { configured: false, nativeListed: false, serverbrowserVerified: true, nonce,
    freshProcess: readiness, authority: serverbrowserAuthority, logSHA256: sha256(text), originalResourceRestored: true,
    scope: serverbrowserAuthority.scope, priorLifecycleAndRetentionReused: true };
  await ctx.artifact('gtac-serverbrowser-native-readback.json', result);
  return result;
}
export async function saved(ctx, c) {
  owned(ctx); const exit = await clean(ctx, c); await helperAuthority(ctx, c);
  const state = ctx.gtac, text = await logs(ctx, exit.startedAt);
  if (!state?.marker || state.running?.startedAt !== exit.startedAt || !text.includes('VOLTRA_GTAC_SAVED_' + state.marker) ||
      !text.includes('VOLTRA_GTAC_SHUTDOWN_' + state.marker) || await c.read(resource + '/marker.txt') !== state.marker) throw Error('GTAC native persisted resource shutdown callback missing');
  if (sha256(opaque(await c.read(config))) !== state.opaque) throw Error('GTAC unrelated XML bytes changed');
  const snapshot = await files(ctx, c); unchanged(state.baseline, snapshot, [config]);
  await startup(ctx, c, controls);
  const result = { fixture: ctx.fixture.server.uuid, port: ctx.fixture.ports[0], marker: state.marker, controls: { ...controls }, opaque: state.opaque,
    files: snapshot, exit, running: state.running, findings };
  restoreContext(ctx, result); return result;
}
export async function retentionBaseline(ctx, c) {
  const result = await saved(ctx, c); await ctx.artifact('gtac-retention-current-stopped.json', result); return result;
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  if (!(ctx.startRequestedAt > Date.parse(saved.exit.finishedAt))) throw Error('GTAC reload needs fresh start after stopped save');
  const readiness = await ready(ctx, c);
  if (!readiness || readiness.startedAt === saved.running.startedAt ||
      (readiness.containerId === saved.running.containerId && readiness.process.pid === saved.running.process.pid && readiness.process.startTicks === saved.running.process.startTicks)) throw Error('GTAC fresh actual native process required');
  const text = await logs(ctx, readiness.startedAt);
  if (!text.includes('VOLTRA_GTAC_RESTORED_' + saved.marker)) throw Error('GTAC native resource did not restore persisted marker');
  unchanged(saved.files, await files(ctx, c));
  await startup(ctx, c, controls); await readonly(ctx, c);
  await stop(ctx, c); const after = await retentionBaseline(ctx, c);
  unchanged(saved.files, after.files);
  return { nativeUDP: readiness.protocol, restoredResource: true, freshProcess: readiness, cleanExit: after.exit, exactRetainedFiles: after.files, findings };
}
