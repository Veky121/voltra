/** Adopt only an immutable reviewed canonical PASS, then run native checks on
 * that same fixture. Importing opens no session. No installer/provision path.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { campaign as h, receipt } from './campaign-session.mjs';
import { hash } from './runner.mjs';
import * as api from './api-adapter.mjs';
const build = 'c86a1b2a87fb7ec733c10caa2ff8e56ce3464b8eefd49fe5c0dfd73d49c2f0a4';
const main = resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go');
const root = resolve('C:/Users/Veky/.t3/worktrees/pteroclone/t3-6837dde7/ptero-go');
const families = { 'waterdog-canonical-b802': 'waterdog', 'waterdog-duplicate-canonical-b802': 'waterdog-duplicate' };
const recipes = { waterdog: 'minecraft/proxy/bedrock/waterdog_pe/egg-waterdog-p-e.json', 'waterdog-duplicate': 'minecraft/proxy/bedrock/waterdog_pe/egg-waterdog-pe.json' };
const attrs = x => x?.attributes ?? x;
const java = { enabled: true, required_major: 0, required_distribution: '', runtime_id: 'auto', xms_mib: 128, xmx_mib: 2048, extra_args: '' };
const same = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort(([a], [b]) => a.localeCompare(b))) === JSON.stringify(Object.entries(b ?? {}).sort(([a], [b]) => a.localeCompare(b)));
async function identity(ctx) {
  const f = ctx.fixture, r = f.intent.request, server = attrs(await h.api('/api/application/servers/' + f.server.id));
  if (server.uuid !== f.server.uuid || server.name !== f.name || server.name !== 'validator-' + ctx.game.id || Number(server.user) !== f.intent.ownerId || Number(server.node) !== r.node_id || server.egg !== f.egg.id || server.external_id !== f.intent.externalId || Number(server.limits?.disk) !== r.disk || Number(server.limits.memory) !== (f.diagnosticMemory?.confirmed === true ? 0 : r.memory)) throw Error('Same canonical Waterdog fixture identity/resources changed');
  if (!same(server.java_config, f.diagnosticMemory?.confirmed === true ? java : {})) throw Error('Waterdog exact reviewed native heap authority changed');
  return server;
}
export async function verify(ctx) {
  const family = families[ctx.game.id], pin = ctx.game.canonicalPass;
  if (!family || ctx.game.family !== family || ctx.game.recipe !== recipes[family] || ctx.build !== build || receipt?.binary_sha256 !== build || ctx.game.testStartup || resolve(ctx.game.checksModule) !== resolve(root, 'tools/runtime/validator/waterdog-checks.mjs')) throw Error('Exact candidate17 Waterdog native followup required');
  const expected = resolve(main, 'artifacts/game-parity-20261029/validator-20261103-' + family + '-b802/canonical.json');
  if (!pin?.path || resolve(pin.path) !== expected || !/^[a-f0-9]{64}$/.test(pin.sha256 ?? '')) throw Error('Root must archive and hash the exact new canonical PASS first');
  const raw = await readFile(expected, 'utf8'), report = JSON.parse(raw), f = report.fixture;
  if (hash(raw) !== pin.sha256 || report.status !== 'PASS' || report.game !== ctx.game.id || report.build !== build || !Array.isArray(report.checks) || report.checks.some(c => c.status !== 'PASS') || f?.recipe !== ctx.game.recipe || f.name !== 'validator-' + ctx.game.id || f.intent?.build !== build || f.intent.ownerId !== ctx.game.ownerId || f.intent.request.memory !== 1024 || f.intent.request.automatic_ports !== true || f.install?.rawExit !== '0' || !f.install.callback?.success || !f.install.removed || !f.install.logsFollowed || !f.install.memoryValid) throw Error('Canonical Waterdog PASS/install proof differs');
  const profile = h.profileFromRuntime(ctx.game.recipe, receipt);
  if (f.intent.scriptHash !== hash(profile.egg.scripts.installation.script) || f.ports?.length !== 2 || !f.allocation?.is_default || f.ports[0] !== f.allocation.port) throw Error('Canonical Waterdog source/allocation proof changed');
  if (ctx.fixture && (ctx.fixture.server?.uuid !== f.server.uuid || ctx.fixture.server.id !== f.server.id || ctx.fixture.intent?.externalId !== f.intent.externalId)) throw Error('Existing followup fixture differs; preserve both');
  await ctx.own(ctx.fixture ?? f);
  Object.assign(ctx.game, { base: 'http://127.0.0.1:18099', serverId: f.server.id, serverUUID: f.server.uuid, nodeId: f.intent.request.node_id, expectedName: f.name });
  await identity(ctx);
  await api.verify({ ...ctx, fixture: { uuid: f.server.uuid }, own: async () => {} });
  await ctx.artifact('canonical-pass-reused.json', { pin, fixture: f.server.uuid, rawInstallerExit: '0', scope: 'Exact candidate17 canonical installation reused on the same fixture; historical f64fca native receipts are not current native evidence' });
}
export async function run(ctx) {
  const c = api.client(ctx), f = ctx.fixture;
  if (await c.state() !== 'offline') throw Error('Native followup requires parked canonical fixture');
  const server = await identity(ctx), variables = server.container?.environment;
  if (variables?.WEBRTC_PORT !== String(f.ports[1]) || variables.WATERDOG_TRANSPORT !== 'both') throw Error('Canonical second media allocation not consumed by startup; root reviews planning before native start');
  if (!f.diagnosticMemory?.confirmed) {
    const before = server.limits;
    await ctx.own({ ...f, diagnosticMemoryHistory: [...(f.diagnosticMemoryHistory ?? []), ...(f.diagnosticMemory ? [f.diagnosticMemory] : [])], diagnosticMemory: { confirmed: false, intent: { fixture: f.server.uuid, before, beforeJava: server.java_config, requested: { memory: 0, java_config: java }, reason: 'Atomic supported build authority: native 2048MiB maximum heap plus unlimited test container; canonical defaults remain archived', at: new Date().toISOString() } } });
    await h.api('/api/application/servers/' + f.server.id + '/build', 'PATCH', { memory: 0, java_config: java });
    const readback = attrs(await h.api('/api/application/servers/' + f.server.id)), after = readback.limits;
    if (Number(after?.memory) !== 0 || Object.keys(before).some(k => k !== 'memory' && JSON.stringify(before[k]) !== JSON.stringify(after[k])) || !same(readback.java_config, java) || readback.container.image !== server.container.image || readback.container.startup_command !== server.container.startup_command || JSON.stringify(readback.container.environment) !== JSON.stringify(server.container.environment)) throw Error('Waterdog memory0/explicit heap readback mismatch');
    await ctx.artifact('waterdog-native-memory-release.json', { before, after, java: readback.java_config, scope: 'Test runtime only; installer/canonical defaults and admission unchanged' });
    await ctx.own({ ...ctx.fixture, diagnosticMemory: { ...ctx.fixture.diagnosticMemory, confirmed: true, after, java: readback.java_config } });
  }
  await identity(ctx);
  await ctx.reserve(ctx.game.peakMiB);
  await api.run(ctx); // installed-state check only; no provisioning or reinstall
}
export async function park(ctx) {
  if (!ctx.fixture?.server) return { preserved: true, noAdoptedFixture: true };
  await identity(ctx);
  return api.park(ctx);
}
