import { randomUUID } from 'node:crypto';
import { campaign as h, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

export const registration = {
  barotrauma: { recipe: 'barotrauma/egg-barotrauma.json', ports: 2, environment: { AUTO_UPDATE: '0', VOLTRA_STEAM_AUTO_UPDATE: '0', PUBLIC_SERVER: '0' } },
};
const config = '/serversettings.xml';
const directory = '/Daedalic Entertainment GmbH/Barotrauma/Multiplayer';
const values = { servername: 'Validator Barotrauma retained', maxplayers: '6', ispublic: false };
const notes = ['Idle native campaign operator evidence only; no player, gameplay or WAN acceptance.', 'Native XML rewrite proves persisted settings; capacity enforcement with connected clients is not tested.', 'Retention paths are an array. Preserve spaces using argv or shell quoting, never join them into shell words.'];
const plain = text => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
function owned(ctx) {
  const s = ctx.fixture?.server;
  if (!s || !/^[a-f0-9-]{36}$/.test(s.uuid) || s.uuid !== ctx.game.serverUUID || s.name !== 'validator-' + ctx.game.id || ctx.fixture.recipe !== registration.barotrauma.recipe || ctx.game.recipe !== registration.barotrauma.recipe || ctx.game.family !== 'barotrauma') throw Error('Exact current owned Barotrauma fixture required');
  return s;
}
function identity(ctx) {
  owned(ctx);
  const b = ctx.barotrauma;
  if (!b || b.fixture !== ctx.fixture.server.uuid || !/^ValidatorCampaign[a-f0-9]{32}$/.test(b.name)) throw Error('Missing owned Barotrauma campaign identity');
  return b;
}
export function retentionPaths(ctx) {
  return [config, directory + '/' + identity(ctx).name + '.save'];
}
export function restoreContext(ctx, saved) {
  owned(ctx);
  if (saved?.fixture !== ctx.fixture.server.uuid || !/^ValidatorCampaign[a-f0-9]{32}$/.test(saved?.name ?? '') || !saved.campaign || !saved.round || !/^[a-f0-9]{64}$/.test(saved.save?.sha256 ?? '') || saved.save?.file !== directory + '/' + saved.name + '.save') throw Error('Invalid retained Barotrauma identity');
  ctx.barotrauma = { fixture: saved.fixture, name: saved.name, campaign: saved.campaign, round: saved.round };
}
async function clean(ctx, c) {
  owned(ctx);
  const state = (await native(ctx))?.state;
  if (await c.state() !== 'offline' || !state || state.Running || state.OOMKilled || state.ExitCode !== 0) throw Error('Barotrauma native stop was not clean');
  return state;
}
async function stop(ctx, c) {
  await c.power('stop');
  await wait(ctx, async () => await c.state() === 'offline', 'Barotrauma stop');
  return clean(ctx, c);
}
async function start(ctx, c) {
  ctx.startRequestedAt = Date.now();
  await c.power('start');
  return wait(ctx, () => ready(ctx, c), 'Barotrauma readiness');
}
// Each interactive response has its own Docker timestamp boundary. Keep the full
// response, since a save listing or round generation can exceed 3000 characters.
async function exchange(ctx, input, accept, label) {
  owned(ctx);
  const since = new Date().toISOString();
  await h.api('/api/client/servers/' + ctx.fixture.server.uuid + '/command', 'POST', { command: input });
  return wait(ctx, async () => {
    const raw = await logs(ctx, since), text = plain(raw);
    await ctx.artifact('barotrauma-' + label + '.log', raw);
    if (/Unknown command|Invalid command|Unhandled exception|Failed to load campaign|Error loading/i.test(text)) throw Error('Barotrauma rejected ' + label);
    return accept(text) ? text : false;
  }, 'Barotrauma ' + label, 60000);
}
function round(text) {
  const field = key => text.match(new RegExp('(?:^|\\n)\\s*' + key + ':\\s*([^\\n]+)'))?.[1].trim();
  const result = { mode: field('Game mode'), submarine: field('Submarine'), seed: field('Level seed') };
  if (result.mode !== 'Campaign' || !result.submarine || !result.seed || !/Round started\./.test(text)) throw Error('Missing native campaign round identity');
  return result;
}
async function campaignInfo(ctx, label) {
  const text = await exchange(ctx, 'campaigninfo', t => /CAMPAIGN STATUS/.test(t) && /Available destinations:/.test(t) && /^\s*\d+\.\s+\S/m.test(t), label);
  const money = text.match(/^\s*Money:\s*(\d+)\s*$/m)?.[1];
  const location = text.match(/^\s*Current location:\s*(.+?)\s*$/m)?.[1];
  const destinations = [...text.slice(text.indexOf('Available destinations:')).matchAll(/^\s*(\d+)\.\s+(.+?)\s*$/gm)].map(m => ({ index: Number(m[1]), name: m[2] }));
  if (money === undefined || !location || !destinations.length) throw Error('Incomplete native campaign status');
  return { money, location, destinations };
}
async function disk(ctx) {
  const file = retentionPaths(ctx)[1], path = '/data/volumes/' + owned(ctx).uuid + file;
  // argv keeps "Daedalic Entertainment GmbH" intact. Do not split sha256sum's filename.
  const sha256 = (await docker(['exec', 'voltra-validator-monitor', 'sha256sum', path], ctx.signal)).trim().slice(0, 64);
  const bytes = Number((await docker(['exec', 'voltra-validator-monitor', 'stat', '-c', '%s', path], ctx.signal)).trim());
  if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(bytes) || bytes <= 0) throw Error('Missing nonempty native campaign save');
  return { file, sha256, bytes };
}
async function xml(ctx, c, label) {
  const text = await c.read(config);
  // Only inspect root attributes, not matching strings in comments or child data.
  const root = text.replace(/<!--[\s\S]*?-->/g, '').match(/<ServerSettings\b([^>]*)>/i)?.[1];
  if (!root) throw Error('Missing native ServerSettings root');
  for (const [key, value] of Object.entries(values)) {
    const matches = [...root.matchAll(new RegExp('\\b' + key + '\\s*=\\s*(["\x27])(.*?)\\1', 'gi'))];
    if (matches.length !== 1 || matches[0][2].toLowerCase() !== String(value).toLowerCase()) throw Error('Native XML setting mismatch: ' + key);
  }
  // Avoid publishing the XML, which can contain the private server password.
  await ctx.artifact('barotrauma-' + label + '.json', { file: config, observed: values });
  return { file: config, observed: values };
}
export async function prerequisites(ctx, c) {
  owned(ctx);
  if (await c.state() !== 'offline' || (await native(ctx))?.state.Running) throw Error('Barotrauma prerequisites require offline fixture');
  if (ctx.fixture.ports?.length !== 2 || !ctx.fixture.ports.every(p => Number.isInteger(p) && p > 0 && p < 65536) || new Set(ctx.fixture.ports).size !== 2) throw Error('Two distinct Barotrauma allocations required');
  if (ctx.game.environment?.PUBLIC_SERVER !== '0' || ctx.game.environment?.AUTO_UPDATE !== '0') throw Error('Private pinned Barotrauma environment required');
  let parent = '/';
  for (const name of directory.slice(1).split('/')) {
    const route = '/api/client/servers/' + ctx.fixture.server.uuid + '/files';
    const entries = (await c.api('GET', route + '/list?directory=' + encodeURIComponent(parent))).data;
    const existing = entries.map(x => x.attributes ?? x).find(x => x.name === name);
    if (existing?.is_file) throw Error('Campaign directory is a file');
    if (!existing) await c.api('POST', route + '/create-folder', { root: parent, name });
    parent = parent.replace(/\/$/, '') + '/' + name;
  }
  ctx.barotrauma = { fixture: ctx.fixture.server.uuid, name: 'ValidatorCampaign' + randomUUID().replaceAll('-', '') };
  return { campaign: ctx.barotrauma.name, ports: ctx.fixture.ports, notes };
}
export async function ready(ctx, c) {
  owned(ctx);
  const container = await native(ctx), began = Date.parse(container?.state.StartedAt);
  if (!Number.isFinite(ctx.startRequestedAt)) throw Error('Missing fresh Barotrauma start boundary');
  if (!container || !Number.isFinite(began) || began < ctx.startRequestedAt) return false;
  const text = await logs(ctx, container.state.StartedAt);
  if (!container.state.Running) {
    await ctx.artifact('barotrauma-startup-failure.log', text);
    throw Error('Barotrauma exited before readiness: ' + container.state.ExitCode);
  }
  if (!/Barotrauma Dedicated Server/.test(text) || !/Server started/.test(text) || await c.state() !== 'running') return false;
  await ctx.artifact('barotrauma-startup.log', text);
  return { startedAt: container.state.StartedAt, nativeReady: true, notes };
}
export async function settings(ctx, c) {
  const b = identity(ctx);
  await stop(ctx, c);
  const url = '/api/client/servers/' + b.fixture + '/game-settings?file=' + encodeURIComponent(config);
  const before = (await h.api(url)).attributes;
  await h.api(url, 'PUT', { revision: before.revision, settings: values });
  await xml(ctx, c, 'typed-settings');
  await start(ctx, c);
  // Graceful quit makes the native server serialize its consumed settings.
  await stop(ctx, c);
  const rewritten = await xml(ctx, c, 'native-rewritten-settings');
  await start(ctx, c);
  const rows = (await c.api('GET', '/api/client/servers/' + b.fixture + '/files/list?directory=' + encodeURIComponent(directory))).data;
  if (rows.some(x => (x.attributes ?? x).name === b.name + '.save')) throw Error('Owned campaign name already exists');
  await exchange(ctx, 'gamemode campaign', t => /Do you want to start a new campaign\? Y\/N/.test(t), 'create-setup');
  await exchange(ctx, 'y', t => /Enter a save name for the campaign:/.test(t), 'create-name-prompt');
  const created = await exchange(ctx, b.name, t => /Campaign started!/.test(t) && /Round started\./.test(t) && /No living players on the server/.test(t), 'created-round');
  b.round = round(created);
  b.campaign = await campaignInfo(ctx, 'created-info');
  return { settings: values, nativeRewrite: rewritten, name: b.name, campaign: b.campaign, round: b.round, notes };
}
export async function saved(ctx, c) {
  const b = identity(ctx), state = await clean(ctx, c);
  if (!b.campaign || !b.round) throw Error('No native campaign creation evidence');
  return { fixture: b.fixture, name: b.name, campaign: b.campaign, round: b.round, save: await disk(ctx), settings: await xml(ctx, c, 'saved-settings'), exitCode: state.ExitCode, notes };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  const b = identity(ctx), current = await disk(ctx);
  if (current.sha256 !== saved.save.sha256 || current.bytes !== saved.save.bytes) throw Error('Campaign bytes changed before native selection');
  await xml(ctx, c, 'reload-settings');
  await exchange(ctx, 'gamemode campaign', t => /Do you want to start a new campaign\? Y\/N/.test(t), 'reload-setup');
  const listing = await exchange(ctx, 'n', t => /Saved campaigns:/.test(t) && /Select a save file to load/.test(t), 'reload-list');
  const expected = saved.save.file.slice(1);
  const matches = [...listing.matchAll(/^\s*(\d+)\.\s+(.+?\.save)\s*$/gm)].filter(m => m[2] === expected);
  if (matches.length !== 1) throw Error('Owned campaign not uniquely present in native save list');
  const index = matches[0][1];
  const reply = await exchange(ctx, index, t => /Campaign loaded!/.test(t) && /Round started\./.test(t) && /No living players on the server/.test(t), 'reloaded-round');
  const actualRound = round(reply), actualCampaign = await campaignInfo(ctx, 'reloaded-info');
  if (JSON.stringify(actualRound) !== JSON.stringify(saved.round) || JSON.stringify(actualCampaign) !== JSON.stringify(saved.campaign)) throw Error('Native campaign state changed across reload');
  const exit = await stop(ctx, c);
  const nativeSettings = await xml(ctx, c, 'reloaded-native-rewrite');
  const afterSave = await disk(ctx);
  return { selectedSave: expected, listedIndex: Number(index), campaign: actualCampaign, round: actualRound, priorDiskSave: saved.save, afterSave, nativeSettings, exitCode: exit.ExitCode, idleEvidence: 'Native reported no living players; connected-client count not asserted', notes };
}
