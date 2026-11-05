import dgram from 'node:dgram';
import { createHash, randomUUID } from 'node:crypto';
import { campaign as h, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';

// Frozen wave485 canonical helper; wave237 supersedes the historical exit245.
// Root owns registration/routing, allocation binding, integrity gates and live runs.
export const registration = {
  stk: { recipe: 'SuperTuxKart/egg-super-tux-kart.json', ports: 2, environment: {
    SERVER_NAME: 'Validator STK', CONFIG_NAME: 'config.xml', MODE: '0',
    DIFFICULTY: '0', MAX_PLAYERS: '8', MOTD: 'Validator idle lobby', DISCOVERY_PORT: '',
  } },
};
const markerFile = '/validator-stk-persistence.txt';
const userDir = '/.voltra/small-games-family/config/supertuxkart/config-0.10';
const userFiles = ['config.xml', 'players.xml', 'highscore.xml', 'input.xml'].map(x => userDir + '/' + x);
const hash = value => createHash('sha256').update(value).digest('hex');
const limits = {
  worldSave: 'N/A: empty LAN lobby; no continuing race world',
  playerChecks: 'Excluded by explicit user idle scope; no player or race acceptance',
  scoreWrites: 'Excluded: retained idle highscore file is not a score-write check',
  wan: 'Unverified: loopback LAN discovery only; custom discovery needs matching client configuration',
  installation: 'Historical wave237 reused verified cache; no fresh-install claim',
};
function config(ctx) {
  const name = ctx.game.environment?.CONFIG_NAME ?? 'config.xml';
  if (typeof name !== 'string' || name.length > 100 || !/^[A-Za-z0-9_.-]+\.xml$/.test(name) || name === '.xml') throw Error('Invalid STK CONFIG_NAME');
  return '/' + name;
}
function owned(ctx) {
  const s = ctx.fixture;
  if (ctx.game.family !== 'stk' || ctx.game.recipe !== registration.stk.recipe || s?.recipe !== ctx.game.recipe || s.name !== 'validator-' + ctx.game.id || s.server?.name !== s.name || !/^[a-f0-9-]{36}$/.test(s.server?.uuid ?? '')) throw Error('STK owned fixture identity mismatch');
  if (!Array.isArray(s.ports) || s.ports.length !== 2 || s.ports.some(p => !Number.isInteger(p) || p < 1 || p > 65535) || s.ports[0] === s.ports[1] || s.ports[1] === 2759) throw Error('STK requires separate valid game/discovery UDP allocations');
  return s;
}
export function retentionPaths(ctx) {
  return [markerFile, config(ctx), ...userFiles, '/stk/data/voltra-stk-network.xml', '/.voltra/stk-discovery.json'];
}
export function restoreContext(ctx, saved) {
  const s = owned(ctx);
  if (saved?.uuid !== s.server.uuid || saved.config !== config(ctx) || JSON.stringify(saved.ports) !== JSON.stringify(s.ports) || !/^[a-f0-9-]{36}$/.test(saved.marker ?? '') || typeof saved.settings?.chat !== 'boolean' || saved.settings['voting-timeout'] !== '41') throw Error('STK retained identity/settings mismatch');
  for (const file of retentionPaths(ctx)) if (!/^[a-f0-9]{64}$/.test(saved.hashes?.find(x => x.file === file)?.sha256 ?? '')) throw Error('Missing STK retention hash: ' + file);
  ctx.stk = { marker: saved.marker, settings: saved.settings };
}
async function identity(ctx) {
  const s = owned(ctx);
  const actual = (await h.api('/api/application/servers/' + s.server.id)).attributes;
  if (actual.uuid !== s.server.uuid || actual.name !== s.name || actual.egg !== s.egg.id || actual.container?.startup_command !== 'exec python3 .voltra/stk_runtime.py') throw Error('STK served fixture/helper identity changed');
  const env = JSON.parse(await docker(['inspect', '--format', '{{json .Config.Env}}', s.server.uuid], ctx.signal));
  const entries = key => env.filter(x => x.startsWith(key + '=')).map(x => x.slice(key.length + 1));
  const expected = { ...registration.stk.environment, ...ctx.game.environment, SERVER_PORT: String(s.ports[0]), DISCOVERY_PORT: String(s.ports[1]), CONFIG_NAME: config(ctx).slice(1) };
  for (const key of ['SERVER_NAME', 'CONFIG_NAME', 'MODE', 'DIFFICULTY', 'MAX_PLAYERS', 'SERVER_PORT', 'DISCOVERY_PORT']) {
    if (entries(key).length !== 1 || entries(key)[0] !== expected[key]) throw Error('STK native environment mismatch: ' + key);
  }
  return expected;
}
export async function prerequisites(ctx) {
  const s = owned(ctx); config(ctx);
  return { required: false, gamePort: s.ports[0], discoveryPort: s.ports[1],
    integration: 'Bind DISCOVERY_PORT to fixture.ports[1] before provisioning; retain canonical startup and integrity guards', ...limits };
}
async function query(ctx) {
  const s = owned(ctx), port = s.ports[1];
  ctx.signal.throwIfAborted();
  const socket = dgram.createSocket('udp4');
  const data = await new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, bytes) => {
      if (done) return; done = true; clearTimeout(timer);
      ctx.signal.removeEventListener('abort', abort); socket.close();
      error ? reject(error) : resolve(bytes);
    };
    const abort = () => finish(ctx.signal.reason ?? Error('Aborted'));
    const timer = setTimeout(() => finish(Error('STK LAN discovery timeout')), 3000);
    ctx.signal.addEventListener('abort', abort, { once: true });
    socket.once('error', finish);
    socket.on('message', (bytes, peer) => { if (peer.address === '127.0.0.1' && peer.port === port) finish(null, bytes); });
    socket.send(Buffer.from('0a73746b2d736572766572', 'hex'), port, '127.0.0.1', error => { if (error) finish(error); });
  });
  if (data.length < 9 || data.readUInt32BE(0) !== 6) throw Error('Invalid STK LAN protocol');
  const length = data[4], offset = 5 + length;
  if (!length || data.length < offset + 4) throw Error('Truncated STK LAN identity');
  const info = { protocol: 6, name: data.subarray(5, offset).toString('utf8'), maxPlayers: data[offset], players: data[offset + 1], gamePort: data.readUInt16BE(offset + 2), discoveryPort: port, hex: data.toString('hex') };
  const env = { ...registration.stk.environment, ...ctx.game.environment };
  if (info.name !== env.SERVER_NAME || info.maxPlayers !== Number(env.MAX_PLAYERS) || info.players !== 0 || info.gamePort !== s.ports[0]) throw Error('STK LAN name/capacity/gameport or empty-lobby mismatch');
  return info;
}
export async function ready(ctx, c) {
  owned(ctx);
  if (!Number.isFinite(ctx.startRequestedAt)) throw Error('Missing fresh STK start boundary');
  const container = await native(ctx);
  if (!container?.state.Running) {
    if (container && Date.parse(container.state.StartedAt) >= ctx.startRequestedAt && container.state.ExitCode !== 0) {
      await ctx.artifact('stk-startup-failure.log', await logs(ctx));
      throw Error('Native STK startup exited ' + container.state.ExitCode);
    }
    return false;
  }
  if (!(Date.parse(container.state.StartedAt) >= ctx.startRequestedAt)) return false;
  const text = await logs(ctx);
  if (!text.includes('Available command:') || !text.includes('STKHost: Listening has been started.')) return false;
  const env = await identity(ctx);
  for (const [file, expected] of Object.entries({
    '/.voltra/stk_runtime.py': 'dcffcd27a0b0aa34aaa3f7620b8112cab7c5adb15bfe6d5e7a97fdd686da7be7',
    '/.voltra/native_console.py': 'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5',
    '/.voltra/small_games_family_runtime.py': '62f428e8fdf8158b84ddc6ad9a72dc61b52168202b1563fba6562e8cff87611d',
  })) if (hash(await c.read(file)) !== expected) throw Error('STK reviewed helper integrity mismatch: ' + file);
  const argv = await docker(['top', container.id, '-eo', 'pid,args'], ctx.signal);
  const line = argv.split('\n').find(x => /(?:^|\/)supertuxkart\s/.test(x));
  if (!line || !line.includes('--server-config=/home/container' + config(ctx)) || !line.includes('--stk-config=voltra-stk-network.xml') || !line.includes('--port=' + ctx.fixture.ports[0])) throw Error('STK actual native config/process identity mismatch');
  const discovery = await query(ctx);
  await c.state(); await ctx.artifact('stk-startup-' + Date.now() + '.log', text);
  return { containerId: container.id, uuid: ctx.fixture.server.uuid, startedAt: container.state.StartedAt, nativeReady: 'Available command:; STKHost listening', argv: line, discovery, config: config(ctx), name: env.SERVER_NAME };
}
async function typed(ctx) {
  return (await h.api('/api/client/servers/' + owned(ctx).server.uuid + '/game-settings?file=' + encodeURIComponent(config(ctx)))).attributes;
}
function assertFields(doc, values) {
  for (const [key, value] of Object.entries(values)) {
    const fields = doc?.fields?.filter(x => x.key === key);
    if (fields?.length !== 1 || fields[0].value !== value || fields[0].readonly || fields[0].type !== (typeof value === 'boolean' ? 'boolean' : 'number')) throw Error('STK typed readback mismatch: ' + key);
  }
}
function masked(xml) {
  for (const key of ['chat', 'voting-timeout']) {
    let count = 0;
    xml = xml.replace(new RegExp('(<'+key+'(?=[\\s/>])[^>]*?\\bvalue\\s*=\\s*)(["\x27])([^"\x27]*)(\\2)', 'g'), (_, a, quote) => { count++; return a + quote + 'VALIDATOR_VALUE' + quote; });
    if (count !== 1) throw Error('Ambiguous STK XML setting: ' + key);
  }
  return xml;
}
export async function settings(ctx, c) {
  await identity(ctx); await query(ctx);
  await c.power('stop');
  await wait(ctx, async () => await c.state() === 'offline' && !(await native(ctx))?.state.Running, 'STK settings stop');
  const stopped = (await native(ctx))?.state;
  if (!stopped || stopped.ExitCode !== 0 || stopped.OOMKilled) throw Error('STK settings stop was not clean');
  const before = await typed(ctx), xml = await c.read(config(ctx));
  const chat = before.fields?.filter(x => x.key === 'chat');
  if (chat?.length !== 1 || typeof chat[0].value !== 'boolean') throw Error('STK typed boolean missing');
  const values = { chat: !chat[0].value, 'voting-timeout': '41' };
  await h.api('/api/client/servers/' + ctx.fixture.server.uuid + '/game-settings?file=' + encodeURIComponent(config(ctx)), 'PUT', { revision: before.revision, settings: values });
  assertFields(await typed(ctx), values);
  const patched = await c.read(config(ctx));
  if (masked(xml) !== masked(patched)) throw Error('STK typed patch changed unrelated XML');
  ctx.stk = { marker: randomUUID(), settings: values };
  await c.write(markerFile, ctx.stk.marker);
  ctx.startRequestedAt = Date.now(); await c.power('start');
  const readiness = await wait(ctx, () => ready(ctx, c), 'STK settings native readiness');
  assertFields(await typed(ctx), values);
  if (hash(await c.read(config(ctx))) !== hash(patched)) throw Error('STK consumed XML changed');
  return { file: config(ctx), settings: values, unrelatedXMLPreserved: true, native: readiness,
    consumption: 'Fresh native process explicitly loads retained XML; typed GET and bytes agree. Player effects excluded.', ...limits };
}
export async function saved(ctx, c) {
  const s = owned(ctx), state = (await native(ctx))?.state;
  if (!state || state.Running || state.ExitCode !== 0 || state.OOMKilled || !(Date.parse(state.StartedAt) >= ctx.startRequestedAt) || !(Date.parse(state.FinishedAt) >= Date.parse(state.StartedAt))) throw Error('STK native stop not fresh and clean');
  const stopLog = await logs(ctx);
  await ctx.artifact('stk-clean-stop-' + Date.now() + '.log', stopLog);
  if (!/STK native child returncode=0(?:\r?\n|$)/.test(stopLog)) throw Error('STK native child clean returncode missing');
  if (!ctx.stk?.marker || await c.read(markerFile) !== ctx.stk.marker) throw Error('STK owned marker changed');
  assertFields(await typed(ctx), ctx.stk.settings);
  const hashes = [];
  for (const file of retentionPaths(ctx)) {
    const value = await c.read(file);
    if (!value.trim()) throw Error('Missing/empty STK retained data: ' + file);
    hashes.push({ file, sha256: hash(value) });
  }
  return { uuid: s.server.uuid, ports: [...s.ports], config: config(ctx), marker: ctx.stk.marker, settings: ctx.stk.settings, hashes, exitCode: state.ExitCode, ...limits };
}
export async function loaded(ctx, c, saved) {
  restoreContext(ctx, saved);
  const readiness = await ready(ctx, c);
  if (!readiness) throw Error('Reloaded STK lacks fresh native readiness');
  for (const file of retentionPaths(ctx)) if (hash(await c.read(file)) !== saved.hashes.find(x => x.file === file).sha256) throw Error('STK retained bytes changed: ' + file);
  if (await c.read(markerFile) !== saved.marker) throw Error('Reloaded STK marker differs');
  assertFields(await typed(ctx), saved.settings);
  return { native: readiness, markerRetained: true, XMLRetained: true, userConfigRetained: true, hashes: saved.hashes, ...limits };
}
