import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { campaign as h, settings as session, docker } from './campaign-session.mjs';
import { native, logs, command, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Root owns registration integration, canonical reinstall and live acceptance.
export const registration = {
  zandronum: {
    recipe: 'doom/zandronum/egg-zandronum.json', ports: 1, peakMiB: 512, diskMiB: 2048,
    environment: { IWAD: 'freedoom1.wad', PUBLIC_SERVER: '0', MAX_PLAYERS: '8', MAP: 'e1m1', SERVER_NAME: 'Validator Zandronum', PWADS: '' },
  },
};
const config = '/zandronum/zandronum.ini';
const custom = '/zandronum/PWAD/validator-retained.txt';
const websiteKey = 'Doom.NetServerInfo/sv_website';
export const retentionRequiredPath = config;
const scope = 'N/A: session world; config and custom PWAD-directory file retention only. No custom map play, player or WAN claim.';
const digest = value => createHash('sha256').update(value).digest('hex');
const stamp = () => Date.now() + '-' + randomUUID();
function owned(ctx) {
  const s = ctx.fixture?.server;
  if (ctx.game.family !== 'zandronum' || ctx.game.recipe !== registration.zandronum.recipe || ctx.fixture.recipe !== ctx.game.recipe || !s || !/^[a-f0-9-]{36}$/.test(s.uuid) || s.uuid !== ctx.game.serverUUID || s.name !== 'validator-' + ctx.game.id) throw Error('Exact owned Zandronum fixture required');
  if (ctx.fixture.ports?.length !== 1 || !Number.isInteger(ctx.fixture.ports[0]) || ctx.fixture.ports[0] < 1 || ctx.fixture.ports[0] > 65535) throw Error('One primary UDP allocation required');
  return s;
}
export function retentionPaths(ctx) { owned(ctx); return [config, '/zandronum/PWAD']; }
export function restoreContext(ctx, saved) {
  owned(ctx);
  if (saved?.fixture !== ctx.fixture.server.uuid || !/^[a-f0-9-]{36}$/.test(saved?.marker ?? '') || saved.website !== 'https://example.invalid/validator-' + saved.marker) throw Error('Missing retained Zandronum identity');
  if (saved.typed?.file !== config || saved.typed.key !== websiteKey || saved.typed.type !== 'text' || saved.typed.value !== saved.website || !saved.typed.beforeRevision || !saved.typed.revision || saved.typed.beforeRevision === saved.typed.revision || !saved.typed.native || !saved.restart?.native || saved.restart.signal !== 'restart' || !Number.isFinite(Date.parse(saved.restart.before)) || !(Date.parse(saved.restart.after) > Date.parse(saved.restart.before))) throw Error('Missing typed edit/native restart evidence');
  for (const file of [config, custom]) if (!/^[a-f0-9]{64}$/.test(saved.hashes?.[file] ?? '')) throw Error('Missing retained hash: ' + file);
  if (saved.hashes[custom] !== digest(saved.marker + '\n') || saved.configSha256 !== saved.hashes[config]) throw Error('Retained hashes do not match saved identity');
  for (const evidence of [saved.typed.native, saved.restart.native]) {
    const q = evidence.query;
    if (q?.website !== saved.website || q.name !== 'Validator Zandronum' || q.map?.toLowerCase() !== 'e1m1' || q.maxplayers !== 8 || q.players !== 0 || !/^freedoom1(?:\.wad)?$/i.test(q.iwad ?? '')) throw Error('Saved native query identity differs');
  }
  ctx.zandronum = { marker: saved.marker, website: saved.website, restart: saved.restart, typed: saved.typed };
}
function typedDocument(doc, expected) {
  const fields = doc?.fields;
  const targets = fields?.filter(f => f.key === websiteKey);
  if (doc?.file !== config || typeof doc.revision !== 'string' || !doc.revision || !Array.isArray(fields) || targets.length !== 1 || targets[0].type !== 'text' || targets[0].readonly !== false || typeof targets[0].value !== 'string') throw Error('Exact Zandronum typed text/revision contract missing');
  if (fields.some(f => f.key !== websiteKey && (f.type !== 'readonly' || f.readonly !== true))) throw Error('Zandronum non-website fields must remain readonly');
  for (const key of ['Doom.NetServerInfo/sv_hostname', 'Doom.NetServerInfo/sv_maxplayers', 'Doom.ConsoleVariables/sv_broadcast']) if (!fields.some(f => f.key === key && f.readonly === true)) throw Error('Missing readonly managed field: ' + key);
  if (expected !== undefined && targets[0].value !== expected) throw Error('Typed website readback differs');
  return doc;
}
export async function prerequisites(ctx, c) {
  owned(ctx);
  const env = ctx.game.environment ?? {};
  if (env.IWAD !== 'freedoom1.wad' || env.PWADS || env.PUBLIC_SERVER !== '0') throw Error('Only bundled lawful Freedoom1 and no external PWAD are authorized');
  const release = JSON.parse(await c.read('/.voltra/zandronum/release.json'));
  const pin = release.releases?.find(r => r.version === 'Freedoom0.13.0');
  if (pin?.sha256 !== '3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59' || pin.bytes !== 24143781) throw Error('Pinned Freedoom release receipt missing');
  // Check bytes without passing a binary IWAD through the text file API.
  const root = '/data/volumes/' + ctx.fixture.server.uuid;
  const size = Number((await docker(['exec', 'voltra-validator-monitor', 'stat', '-c', '%s', root + '/zandronum/IWAD/freedoom1.wad'], ctx.signal)).trim());
  const hash = (await docker(['exec', 'voltra-validator-monitor', 'sha256sum', root + '/zandronum/IWAD/freedoom1.wad'], ctx.signal)).split(/\s+/)[0];
  if (!(size > 12 && size <= 32 * 1024 ** 2) || hash !== release.files?.['IWAD/freedoom1.wad']) throw Error('Freedoom IWAD size/hash differs from pinned install receipt');
  return { lawfulContent: 'Freedoom 0.13.0', pin, bytes: size, sha256: hash, uploadLimitBytes: 32 * 1024 ** 2, worldSave: scope };
}
async function query(ctx) {
  owned(ctx); ctx.signal.throwIfAborted();
  // Space independent launcher probes; do not turn a denied/invalid reply into success.
  const pause = (ctx.zandronumQueryCooldownMs ?? 11000) - (Date.now() - (ctx.zandronumLastQueryAt ?? 0));
  if (pause > 0) await delay(pause, undefined, { signal: ctx.signal });
  ctx.zandronumLastQueryAt = Date.now();
  // Reuse the reviewed Huffman/nonce parser from the verified campaign root.
  const helper = await import(pathToFileURL(resolve(session.campaignRoot, 'tools/game-query/id-family.mjs')).href);
  const info = await helper.query('zandronum', '127.0.0.1', ctx.fixture.ports[0]);
  ctx.signal.throwIfAborted();
  if (info.name !== 'Validator Zandronum' || info.map.toLowerCase() !== 'e1m1' || info.maxplayers !== 8 || !/^freedoom1(?:\.wad)?$/i.test(info.iwad) || info.players !== 0) throw Error('Native Zandronum query identity/capacity/content differs');
  return info;
}
export async function ready(ctx, c) {
  owned(ctx);
  const container = await native(ctx);
  if (!container?.state.Running) {
    if (container && Date.parse(container.state.StartedAt) >= ctx.startRequestedAt) {
      await ctx.artifact('zandronum-start-failure-' + stamp() + '.log', await logs(ctx));
      throw Error('Zandronum exited before readiness: ' + container.state.ExitCode);
    }
    return false;
  }
  if (!(Date.parse(container.state.StartedAt) >= ctx.startRequestedAt)) return false;
  const text = await logs(ctx);
  if (!/^VOLTRA_ID_NATIVE_READY\r?$/m.test(text) || await c.state() !== 'running') return false;
  const queryWindow = (await c.read(config)).match(/^sv_queryignoretime=(\d+)\r?$/m);
  if (queryWindow) {
    const seconds = Number(queryWindow[1]);
    if (!Number.isSafeInteger(seconds) || seconds > 60) throw Error('Unbounded native launcher query cooldown');
    ctx.zandronumQueryCooldownMs = (seconds + 1) * 1000;
  }
  const info = await query(ctx);
  await ctx.artifact('zandronum-ready-' + stamp() + '.log', text);
  return { startedAt: container.state.StartedAt, nativeReady: 'VOLTRA_ID_NATIVE_READY', query: info };
}
async function readback(ctx) {
  const website = ctx.zandronum.website;
  const console = await command(ctx, 'sv_website', new RegExp(website.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const info = await query(ctx);
  if (info.website !== website) throw Error('Native website query readback differs');
  return { console, query: info };
}
async function cleanStop(ctx, c) {
  const state = (await native(ctx))?.state;
  const text = await logs(ctx);
  await ctx.artifact('zandronum-stop-' + stamp() + '.log', text);
  if (await c.state() !== 'offline' || !state || state.Running || state.OOMKilled || state.Dead || state.ExitCode !== 0 || !/^VOLTRA_ID_EXIT 0\r?$/m.test(text)) throw Error('Zandronum native clean Stop0 proof missing');
  return state;
}
async function snapshot(ctx, label) {
  owned(ctx);
  // Full volume inventory, including directories, symlinks, uid/gid/mode/mtime
  // and every regular file hash. No extension filter or partial copy.
  const root = '/data/volumes/' + ctx.fixture.server.uuid;
  const script = 'set -eu; cd "' + root + '"; find . -exec stat -c "META %F|%a|%u|%g|%s|%Y|%N" {} \\; ; find . -type f -exec sha256sum {} \\;';
  const text = await docker(['exec', 'voltra-validator-monitor', 'sh', '-c', script], ctx.signal);
  if (!text.includes('zandronum.ini') || !text.includes('validator-retained.txt')) throw Error('Incomplete Zandronum snapshot');
  await ctx.artifact('zandronum-' + label + '-' + stamp() + '.snapshot', text);
  return text;
}
export async function settings(ctx, c) {
  owned(ctx);
  ctx.zandronum = { marker: randomUUID() };
  ctx.zandronum.website = 'https://example.invalid/validator-' + ctx.zandronum.marker;
  // Edit offline so native shutdown cannot overwrite the API's file edit.
  await c.power('stop');
  await wait(ctx, async () => await c.state() === 'offline', 'Zandronum typed settings stop');
  await cleanStop(ctx, c);
  const url = '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent(config);
  const discovery = await h.api(url);
  await ctx.artifact('zandronum-typed-discovery-' + stamp() + '.json', discovery);
  const before = typedDocument(discovery.attributes);
  if (before.fields.find(f => f.key === websiteKey).value === ctx.zandronum.website) throw Error('Fresh website marker already present');
  const result = await h.api(url, 'PUT', { revision: before.revision, settings: { [websiteKey]: ctx.zandronum.website } });
  const after = typedDocument((await h.api(url)).attributes, ctx.zandronum.website);
  const unrelated = doc => doc.fields.filter(f => f.key !== websiteKey);
  if (!isDeepStrictEqual(unrelated(before), unrelated(after))) throw Error('Typed edit changed unrelated fields');
  if (after.revision === before.revision) throw Error('Typed website edit did not change revision');
  ctx.zandronum.typed = { file: config, key: websiteKey, type: 'text', value: ctx.zandronum.website, beforeRevision: before.revision, revision: after.revision, put: result };
  await ctx.artifact('zandronum-typed-edit-' + stamp() + '.json', { before, after, ...ctx.zandronum.typed });
  await c.write(custom, ctx.zandronum.marker + '\n');
  if (!(await c.read(config)).includes(ctx.zandronum.website)) throw Error('Typed edit missing from INI');
  ctx.startRequestedAt = Date.now(); await c.power('start');
  await wait(ctx, () => ready(ctx, c), 'Zandronum settings start');
  ctx.zandronum.typed.native = await readback(ctx);
  const first = (await native(ctx)).state.StartedAt;
  ctx.startRequestedAt = Date.now(); await c.power('restart');
  const restarted = await wait(ctx, async () => {
    if ((await native(ctx))?.state.StartedAt === first) return false;
    return ready(ctx, c);
  }, 'Zandronum actual API restart');
  ctx.zandronum.restart = { signal: 'restart', before: first, after: restarted.startedAt, native: await readback(ctx) };
  await ctx.artifact('zandronum-api-restart-' + stamp() + '.json', ctx.zandronum.restart);
  await snapshot(ctx, 'post-restart-full');
  const final = typedDocument((await h.api(url)).attributes, ctx.zandronum.website);
  return { typed: ctx.zandronum.typed, restart: ctx.zandronum.restart, finalRevision: final.revision, worldSave: scope };
}
export async function saved(ctx, c) {
  owned(ctx); await cleanStop(ctx, c);
  const state = ctx.zandronum;
  if (!state?.restart || await c.read(custom) !== state.marker + '\n' || !(await c.read(config)).includes(state.website)) throw Error('Missing native restart/config/custom retention identity');
  const typed = typedDocument((await h.api('/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent(config))).attributes, state.website);
  const hashes = { [config]: digest(await c.read(config)), [custom]: digest(await c.read(custom)) };
  const result = { ...state, fixture: ctx.fixture.server.uuid, hashes, configSha256: hashes[config], savedRevision: typed.revision, snapshot: await snapshot(ctx, 'offline-baseline'), worldSave: scope, typedSettings: state.typed };
  restoreContext(ctx, result);
  return result;
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  const result = await readback(ctx);
  await c.power('stop');
  await wait(ctx, async () => await c.state() === 'offline' && !(await native(ctx))?.state.Running, 'Zandronum final native stop');
  const nativeStop = await cleanStop(ctx, c);
  const after = await snapshot(ctx, 'final-post-stop-full');
  if (typeof saved.snapshot !== 'string') throw Error('Full baseline snapshot required for final delta');
  const beforeLines = new Set(saved.snapshot.trim().split('\n')), afterLines = new Set(after.trim().split('\n'));
  // Keep both removed and added records: this includes deletions, byte changes
  // and metadata-only changes, including startup ownership changes.
  const delta = { removed: [...beforeLines].filter(x => !afterLines.has(x)), added: [...afterLines].filter(x => !beforeLines.has(x)), format: 'Complete META and SHA256 record delta; removed records are never discarded' };
  await ctx.artifact('zandronum-final-delta-' + stamp() + '.json', delta);
  if (await c.read(custom) !== saved.marker + '\n' || !(await c.read(config)).includes(saved.website)) throw Error('Retained config/custom identity differs after start; full snapshot and delta preserved');
  const customChanges = [...delta.removed, ...delta.added].filter(line => line.includes('./zandronum/PWAD'));
  if (customChanges.length) throw Error('PWAD bytes or metadata changed after start; inspect preserved full snapshot and delta');
  const typed = typedDocument((await h.api('/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent(config))).attributes, saved.website);
  // Startup may rewrite INI formatting; preserve its complete delta above.
  if (digest(await c.read(custom)) !== saved.hashes[custom]) throw Error('Retained custom bytes changed');
  return { native: result, nativeStop, markerRetained: true, restart: saved.restart, delta, hashes: saved.hashes, configByteIdentical: digest(await c.read(config)) === saved.hashes[config], worldSave: scope, typedSettings: saved.typed, loadedRevision: typed.revision, contentArchiveExport: 'Root must export full snapshot bytes plus complete delta before cleanup; inventory alone is not an archive', fullParity: false };
}
