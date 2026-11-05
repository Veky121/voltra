import { receipt, docker, campaign as h } from './campaign-session.mjs';
import { command, logs, native, wait } from './campaign-adapter.mjs';
import { Blocked } from './runner.mjs';
export async function verifyBuild() { return { build: receipt.binary_sha256, pid: receipt.pid, snapshot: receipt.source_fingerprint }; }
export async function prerequisites(ctx, c) {
  if (ctx.game.family === 'minecraft') {
    await c.write('/eula.txt', 'eula=true\n');
    const acceptance = { accepted: true, terms: 'https://www.minecraft.net/eula', at: new Date().toISOString(), authority: 'User authorized game-server EULA acceptance in this conversation', fixture: ctx.fixture.server.uuid, method: 'owned eula.txt via file API' };
    await ctx.artifact('eula.json', acceptance); return acceptance;
  }
  return { required: false };
}
export async function ready(ctx, c) {
  const container = await native(ctx);
  if (!container?.state.Running) {
    if (container && Date.parse(container.state.StartedAt) >= ctx.startRequestedAt && container.state.ExitCode !== 0) {
      const text = await logs(ctx);
      await ctx.artifact('startup-failure-' + Date.now() + '.log', text);
      if (/must provide an existing world/i.test(text)) throw new Blocked('WORLD_REQUIRED', 'Import a compatible existing world; installation and failed-start logs are preserved.');
      if (/license (?:is )?required|API key (?:is )?required|invalid API key/i.test(text)) throw new Blocked('PUBLISHER_CREDENTIAL', 'Provide the publisher license/API key; fixture and logs are preserved.');
      throw Error('Native startup exited ' + container.state.ExitCode + '; see retained startup-failure log');
    }
    return false;
  }
  const text = await logs(ctx);
  const pattern = { minecraft: /Done \([\d.]+s\)!/, openttd: /Game started|Server started|Starting dedicated|Dedicated server/i, terraria: /Listening on port/ }[ctx.game.family];
  if (!pattern?.test(text)) return false;
  await c.state();
  await ctx.artifact('startup.log', text);
  return { startedAt: container.state.StartedAt, nativeReady: text.split('\n').filter(x => pattern.test(x)).slice(-3), memoryLimitBytes: container.memory };
}
async function power(ctx, c, signal) {
  if (signal === 'start') ctx.startRequestedAt = Date.now();
  await c.power(signal);
  if (signal === 'stop') return wait(ctx, async () => await c.state() === 'offline' && { offline: true }, 'settings stop');
  return wait(ctx, () => ready(ctx, c), 'settings readiness');
}
async function typed(ctx, c, file, settings) {
  await power(ctx, c, 'stop');
  const url = '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent(file);
  const before = (await h.api(url)).attributes;
  const result = await h.api(url, 'PUT', { revision: before.revision, settings });
  await power(ctx, c, 'start');
  return { file, settings, applied: Boolean(result) };
}
export async function settings(ctx, c) {
  if (ctx.game.family === 'minecraft') {
    const edit = await typed(ctx, c, '/server.properties', { 'max-players': '7' });
    const capacity = await command(ctx, 'list', /max of 7 players/i);
    let marker;
    ctx.gamerule = 'minecraft:advance_time';
    try { marker = await command(ctx, 'gamerule ' + ctx.gamerule + ' false', /false/i); }
    catch (e) { if (!/Unknown|Incorrect|Invalid/.test(e.message)) throw e; ctx.gamerule = 'doDaylightCycle'; marker = await command(ctx, 'gamerule ' + ctx.gamerule + ' false', /false/i); }
    const seed = await command(ctx, 'seed', /Seed:/);
    ctx.world = { seed: seed.reply.match(/Seed:\s*\[?(-?\d+)/)?.[1], marker: false, gamerule: ctx.gamerule };
    if (!ctx.world.seed) throw Error('Missing native seed');
    if (!ctx.game.recipe.includes('/folia/')) await command(ctx, 'save-all flush', /Saved the game|Saved the world/i);
    return { edit, capacity, marker, ...ctx.world };
  }
  if (ctx.game.family === 'openttd') {
    const edit = await typed(ctx, c, '/openttd.cfg', { 'network/max_clients': '17' });
    const capacity = await command(ctx, 'set network.max_clients', /17/);
    const seed = await command(ctx, 'getseed', /Generation Seed:\s*\d+/);
    ctx.world = { seed: seed.reply.match(/Generation Seed:\s*(\d+)/)[1] };
    const save = await command(ctx, 'save validator-world', /Saving|saved|Save successful/i);
    return { edit, capacity, save, ...ctx.world };
  }
  if (ctx.game.family === 'terraria') {
    const config = await c.read('/serverconfig.txt');
    if (!config.includes('worldname=validator_world') || !config.includes('maxplayers=6')) throw Error('Startup-owned settings not reflected in generated config');
    const motd = await command(ctx, 'motd', /MOTD: Validator native/i);
    await command(ctx, 'save', /World saved|Saving world|Saving complete/i);
    ctx.world = { name: 'validator_world' };
    return { source: 'startup environment', configConsumed: true, motd, typedEditor: 'not claimed' };
  }
  throw Error('No settings adapter for game family');
}
async function disk(ctx, file) {
  if (!/^[a-f0-9-]{36}$/.test(ctx.fixture.server.uuid) || file.includes('..') || !/^[a-zA-Z0-9_./-]+$/.test(file)) throw Error('Invalid owned save path');
  const path = '/data/volumes/' + ctx.fixture.server.uuid + '/' + file;
  const hash = (await docker(['exec', 'voltra-validator-monitor', 'sha256sum', path], ctx.signal)).split(/\s+/)[0];
  const bytes = Number((await docker(['exec', 'voltra-validator-monitor', 'stat', '-c', '%s', path], ctx.signal)).trim());
  if (!/^[a-f0-9]{64}$/.test(hash) || bytes < 32) throw Error('Missing meaningful world save');
  return { file, sha256: hash, bytes };
}
export async function saved(ctx) {
  const c = await native(ctx);
  if (c?.state.Running || c?.state.OOMKilled || c?.state.ExitCode !== 0) throw Error('Native stop did not exit cleanly');
  const file = { minecraft: 'world/level.dat', openttd: 'save/validator-world.sav', terraria: 'saves/Worlds/validator_world.wld' }[ctx.game.family];
  return { ...ctx.world, ...await disk(ctx, file), exitCode: c.state.ExitCode };
}
export async function loaded(ctx, c, saved) {
  if (ctx.game.family === 'minecraft') {
    const seed = await command(ctx, 'seed', /Seed:/);
    const actual = seed.reply.match(/Seed:\s*\[?(-?\d+)/)?.[1];
    if (actual !== saved.seed) throw Error('Reloaded seed differs');
    const marker = await command(ctx, 'gamerule ' + saved.gamerule, /false/i);
    return { sameSeed: actual, persistedMarker: marker, save: saved.sha256 };
  }
  if (ctx.game.family === 'openttd') {
    await h.api('/api/client/servers/' + ctx.fixture.server.uuid + '/command', 'POST', { command: 'load validator-world.sav' });
    // The console may not acknowledge load; the subsequent fresh seed readback
    // is the acceptance condition, not an assumed success message.
    const seed = await command(ctx, 'getseed', /Generation Seed:\s*\d+/);
    if (seed.reply.match(/Generation Seed:\s*(\d+)/)?.[1] !== saved.seed) throw Error('Loaded OpenTTD seed differs');
    return { sameSeed: saved.seed, save: saved.sha256 };
  }
  const text = await logs(ctx);
  if (/Generating world|Creating world/i.test(text)) throw Error('Terraria generated a new world during reload');
  const config = await c.read('/serverconfig.txt');
  if (!config.includes('/validator_world.wld')) throw Error('Terraria startup selected a different world');
  return { selectedWorld: saved.name, priorSave: saved.sha256, nativeListening: /Listening on port/.test(text), configSelectsExactSave: true };
}
