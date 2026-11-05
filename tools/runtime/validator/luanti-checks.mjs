import { randomUUID } from 'node:crypto';
import { campaign as h, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

const file = '/.minetest/minetest.conf', world = '/.minetest/worlds/validator_world';
const values = { server_name: 'Validator Luanti edited', motd: 'Native literal "quotes" \\ # equals= retained', max_users: '12', server_announce: false };
function owned(ctx) {
  const s = ctx.fixture?.server;
  if (!s || !/^[a-f0-9-]{36}$/.test(s.uuid) || s.uuid !== ctx.game.serverUUID || s.name !== 'validator-' + ctx.game.id || ctx.fixture.recipe !== 'minetest/egg-minetest.json' || ctx.game.environment?.WORLD_NAME !== 'validator_world') throw Error('Exact owned Luanti fixture and validator_world environment required');
  return s;
}
async function clean(ctx, c) {
  const state = (await native(ctx))?.state;
  if (await c.state() !== 'offline' || !state || state.Running || state.OOMKilled || state.ExitCode !== 0) throw Error('Luanti native stop did not exit cleanly');
  return state;
}
async function proof(ctx, name) {
  const since = new Date().toISOString(), marker = 'VOLTRA_PARITY_' + name.toUpperCase();
  await h.api('/api/client/servers/' + owned(ctx).uuid + '/command', 'POST', { command: '/voltra_parity_' + name });
  return wait(ctx, async () => {
    const text = await logs(ctx, since);
    await ctx.artifact('luanti-' + name + '.log', text);
    if (/VOLTRA_PARITY_\w*(?:FAILED|NOT_EMPTY)|Unknown command|LuaError|ERROR\[/.test(text)) throw Error('Luanti native proof failed; see luanti-' + name + '.log');
    return text.includes(marker + '_OK') && { command: '/voltra_parity_' + name, reply: text.slice(-3000) };
  }, 'Luanti ' + name, 45000);
}
export async function prerequisites(ctx, c) {
  owned(ctx);
  if (await c.state() !== 'offline' || (await native(ctx))?.state.Running) throw Error('Worldmod installation requires offline fixture');
  // A fresh marker rejects prior evidence; one mod name avoids duplicate commands on retry.
  ctx.luanti = { marker: randomUUID(), mod: 'validator_parity' };
  const { marker, mod } = ctx.luanti;
  const lua = `-- Adapted from wave235-luanti-live/world-fixture.lua. Owned test world only.
local pos = {x=0,y=0,z=0}
local storage = core.get_mod_storage()
local marker = '${marker}'
local function result(name, ok)
 core.log(ok and 'action' or 'error', 'VOLTRA_PARITY_' .. name .. (ok and '_OK' or '_FAILED'))
 return ok, ok and 'Owned fixture verified' or 'Owned fixture mismatch'
end
core.register_chatcommand('voltra_parity_write', {privs={server=true}, func=function()
 core.emerge_area(pos,pos,function(_,_,remaining)
  if remaining ~= 0 then return end
  core.set_node(pos,{name='default:stone'})
  core.get_meta(pos):set_string('voltra_parity',marker)
  storage:set_string('parity_fixture',marker)
  result('WRITE',core.get_meta(pos):get_string('voltra_parity') == marker and storage:get_string('parity_fixture') == marker)
 end)
 return true,'Owned fixture save queued'
end})
core.register_chatcommand('voltra_parity_read', {privs={server=true}, func=function()
 core.load_area(pos,pos)
 return result('READ',core.get_node(pos).name == 'default:stone' and core.get_meta(pos):get_string('voltra_parity') == marker and storage:get_string('parity_fixture') == marker)
end})
core.register_chatcommand('voltra_parity_settings', {privs={server=true}, func=function()
 return result('SETTINGS',core.settings:get('server_name') == 'Validator Luanti edited'
  and core.settings:get('motd') == 'Native literal "quotes" \\\\ # equals= retained'
  and core.settings:get('max_users') == '12' and core.settings:get_bool('server_announce') == false)
end})
core.register_chatcommand('voltra_parity_empty', {privs={server=true}, func=function()
 return result('EMPTY',#core.get_connected_players() == 0)
end})
core.register_on_mods_loaded(function() core.log('action','VOLTRA_PARITY_MOD_READY_${marker}') end)
`;
  const root = world + '/worldmods/' + mod;
  for (const directory of [world, world + '/worldmods', root]) {
    const parent = directory.slice(0, directory.lastIndexOf('/')), name = directory.split('/').at(-1);
    const rows = (await c.api('GET', '/api/client/servers/' + ctx.game.serverUUID + '/files/list?directory=' + encodeURIComponent(parent))).data;
    const existing = rows.map(x => x.attributes ?? x).find(x => x.name === name);
    if (existing?.is_file) throw Error('Worldmod directory is a file: ' + directory);
    if (!existing) await c.api('POST', '/api/client/servers/' + ctx.game.serverUUID + '/files/create-folder', { root: parent, name });
  }
  for (const [path, content] of [[root + '/mod.conf', 'name = ' + mod + '\ndepends = default\n'], [root + '/init.lua', lua]]) {
    await c.write(path, content);
    if (await c.read(path) !== content) throw Error('Worldmod file API readback differs: ' + path);
  }
  await ctx.artifact('luanti-worldmod.lua', lua);
  return { world, mod, marker, installedVia: 'owned file API' };
}
export async function ready(ctx, c) {
  owned(ctx);
  const container = await native(ctx);
  if (!container?.state.Running) {
    if (container && Date.parse(container.state.StartedAt) >= ctx.startRequestedAt) {
      await ctx.artifact('luanti-startup-failure.log', await logs(ctx));
      throw Error('Luanti exited before readiness: ' + container.state.ExitCode);
    }
    return false;
  }
  const text = await logs(ctx);
  if (/LuaError|ERROR\[/.test(text)) { await ctx.artifact('luanti-startup-failure.log', text); throw Error('Luanti startup error'); }
  if (!ctx.luanti || !text.includes('VOLTRA_PARITY_MOD_READY_' + ctx.luanti.marker) || !text.includes('VOLTRA_LUANTI_ADMIN_READY') || !/Server for gameid="minetest" listening on/.test(text)) return false;
  if (await c.state() !== 'running') return false;
  await ctx.artifact('luanti-startup.log', text);
  return { startedAt: container.state.StartedAt, nativeListening: true, ownedWorldmodLoaded: ctx.luanti.mod };
}
export async function settings(ctx, c) {
  await proof(ctx, 'empty');
  await c.power('stop');
  await wait(ctx, async () => await c.state() === 'offline', 'Luanti settings stop');
  await clean(ctx, c);
  const url = '/api/client/servers/' + owned(ctx).uuid + '/game-settings';
  const before = (await h.api(url + '?file=' + encodeURIComponent(file))).attributes;
  await h.api(url, 'PUT', { file, revision: before.revision, settings: values });
  await ctx.artifact('luanti-edited.conf', await c.read(file));
  ctx.startRequestedAt = Date.now(); await c.power('start');
  await wait(ctx, () => ready(ctx, c), 'Luanti edited readiness');
  const readback = await proof(ctx, 'settings');
  await proof(ctx, 'empty');
  const write = await proof(ctx, 'write');
  ctx.luanti.identity = await c.read(world + '/world.mt');
  if (!/^gameid\s*=\s*minetest\s*$/m.test(ctx.luanti.identity)) throw Error('Unexpected Luanti game identity');
  return { file, settings: values, readback, write, marker: ctx.luanti.marker };
}
export async function saved(ctx, c) {
  const state = await clean(ctx, c), uuid = owned(ctx).uuid, files = [];
  if (!ctx.luanti?.identity || await c.read(world + '/world.mt') !== ctx.luanti.identity) throw Error('Luanti world identity changed before save');
  for (const name of ['map.sqlite', 'mod_storage.sqlite']) {
    const path = '/data/volumes/' + uuid + world + '/' + name;
    const sha256 = (await docker(['exec', 'voltra-validator-monitor', 'sha256sum', path], ctx.signal)).trim().split(/\s+/)[0];
    const bytes = Number((await docker(['exec', 'voltra-validator-monitor', 'stat', '-c', '%s', path], ctx.signal)).trim());
    if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(bytes) || bytes < 4096) throw Error('Missing meaningful Luanti database: ' + name);
    files.push({ file: world + '/' + name, sha256, bytes });
  }
  return { files, identity: ctx.luanti.identity, marker: ctx.luanti.marker, mod: ctx.luanti.mod, exitCode: state.ExitCode };
}
export async function loaded(ctx, c, saved) {
  if (saved.marker !== ctx.luanti?.marker || saved.mod !== ctx.luanti.mod || await c.read(world + '/world.mt') !== saved.identity) throw Error('Reload selected different Luanti fixture');
  return { native: await proof(ctx, 'read'), settings: await proof(ctx, 'settings'), empty: await proof(ctx, 'empty'), sameWorld: true, marker: saved.marker, priorDiskSave: saved.files };
}
