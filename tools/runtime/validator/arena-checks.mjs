import dgram from 'node:dgram';
import { createHash, randomUUID } from 'node:crypto';
import { campaign as h } from './campaign-session.mjs';
import { native, logs, command, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';
export async function prerequisites() { return { required: false }; }
const hash = text => createHash('sha256').update(text).digest('hex');
const specs = {
  xonotic: { ready: /Xonotic native UDP server ready/, file: '/.xonotic/data/server.cfg', settings: { sv_taunt: false, g_friendlyfire: '0.25', g_warmup_limit: '60', g_maplist_shuffle: false } },
  teeworlds: { ready: /Voltra native console ready/, file: '/autoexec.cfg', settings: { sv_name: 'Validator retained Teeworlds', sv_max_clients: '12' } },
  cs2d: { ready: /----- Server started -----/, file: '/cs2d/sys/server.cfg', settings: { mp_freezetime: '4', sv_friendlyfire: true } },
  openarena: { ready: /OpenArena native UDP server ready/, file: '/openarena/userdata/baseoa/server.cfg', settings: { fraglimit: '42' } },
};
export async function ready(ctx, c) {
  const container = await native(ctx);
  if (!container?.state.Running) {
    if (container && Date.parse(container.state.StartedAt) >= ctx.startRequestedAt && container.state.ExitCode !== 0) {
      await ctx.artifact('startup-failure.log', await logs(ctx));
      throw Error('Native startup exited ' + container.state.ExitCode);
    }
    return false;
  }
  const text = await logs(ctx), pattern = specs[ctx.game.family].ready;
  if (!pattern.test(text)) return false;
  await c.state();
  await ctx.artifact('startup.log', text);
  return { startedAt: container.state.StartedAt, nativeReady: text.split('\n').filter(x => pattern.test(x)).slice(-2) };
}
async function quake(ctx, kind) {
  const challenge = randomUUID().replaceAll('-', '');
  const socket = dgram.createSocket('udp4');
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Native UDP query timed out')), 3000);
    socket.once('error', reject);
    socket.on('message', (data, peer) => { if (peer.address === '127.0.0.1' && peer.port === ctx.fixture.ports[0]) { clearTimeout(timer); resolve(data); } });
    socket.send(Buffer.concat([Buffer.from([255, 255, 255, 255]), Buffer.from(kind + ' ' + challenge + '\n')]), ctx.fixture.ports[0], '127.0.0.1');
  }).finally(() => socket.close());
  const text = response.subarray(4).toString('utf8');
  if (!response.subarray(0, 4).equals(Buffer.from([255, 255, 255, 255])) || !text.startsWith(kind === 'getstatus' ? 'statusResponse\n' : 'infoResponse\n')) throw Error('Invalid native UDP reply');
  const parts = text.split('\n')[1].split('\\').slice(1), fields = {};
  for (let i = 0; i + 1 < parts.length; i += 2) fields[parts[i]] = parts[i + 1];
  if ((kind === 'getinfo' || ctx.game.family === 'xonotic') && fields.challenge !== challenge) throw Error('Native challenge mismatch');
  return fields;
}
async function readback(ctx) {
  if (ctx.game.family === 'xonotic') {
    const status = await quake(ctx, 'getstatus');
    if (status.gamename !== 'Xonotic' || !status.mapname) throw Error('Wrong native game reply');
    const values = {};
    for (const [key, value] of Object.entries({ sv_taunt: '0', g_friendlyfire: '0.25', g_warmup_limit: '60', g_maplist_shuffle: '0' })) {
      values[key] = await command(ctx, key, new RegExp('"' + key + '" is "' + value.replace('.', '\\.') + '"'));
    }
    return { game: status.gamename, map: status.mapname, challengeVerified: true, values };
  }
  if (ctx.game.family === 'teeworlds') return {
    name: await command(ctx, 'sv_name', /Validator retained Teeworlds/),
    capacity: await command(ctx, 'sv_max_clients', /(?:Value:|sv_max_clients[^\n]*(?:is|=|:))\s*"?12\b/i),
  };
  if (ctx.game.family === 'cs2d') return command(ctx, 'lua "print(\'CS2D_TYPED_NATIVE\',game(\'mp_freezetime\'),game(\'sv_friendlyfire\'))"', /CS2D_TYPED_NATIVE[\t ]+4[\t ]+1/);
  const status = await quake(ctx, 'getstatus'), info = await quake(ctx, 'getinfo');
  if (status.fraglimit !== '42' || info.mapname !== 'aggressor') throw Error('Native arena settings mismatch');
  return { fraglimit: status.fraglimit, map: info.mapname, challengeVerified: true };
}
export async function settings(ctx, c) {
  const spec = specs[ctx.game.family];
  await c.power('stop');
  await wait(ctx, async () => await c.state() === 'offline', 'settings stop');
  const url = '/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent(spec.file);
  const view = (await h.api(url)).attributes;
  await h.api(url, 'PUT', { revision: view.revision, settings: spec.settings });
  ctx.marker = randomUUID();
  await c.write('/validator-persistence.txt', ctx.marker);
  ctx.startRequestedAt = Date.now();
  await c.power('start'); await wait(ctx, () => ready(ctx, c), 'settings readiness');
  return { file: spec.file, settings: spec.settings, native: await readback(ctx) };
}
export async function saved(ctx, c) {
  const state = (await native(ctx))?.state;
  if (state?.Running || state?.ExitCode !== 0 || state?.OOMKilled) throw Error('Native stop not clean');
  const marker = await c.read('/validator-persistence.txt');
  if (marker !== ctx.marker) throw Error('Persistent marker changed');
  return { worldSave: 'N/A: empty arena map service', markerHash: hash(marker), configHash: hash(await c.read(specs[ctx.game.family].file)), exitCode: state.ExitCode };
}
export async function loaded(ctx, c, saved) {
  if (hash(await c.read('/validator-persistence.txt')) !== saved.markerHash) throw Error('Restart lost persistent file');
  return { native: await readback(ctx), markerRetained: true, worldSave: saved.worldSave, configHashAfterRestart: hash(await c.read(specs[ctx.game.family].file)) };
}
