#!/usr/bin/env node
/** Canonical Clone Hero/CryoFall/Tachyon/Waterfall/Travertine/VIAaaS/Waterdog setup and offline presentation coordinator. Importing never opens a session.
 * Root reviews source and supplies a manifest before explicit --run execution.
 * Failed/ambiguous provisioning is preserved, including locks if proof is incomplete.
 * No start, reinstall, Docker update, egg edit, or fixture deletion is permitted.
 */
import { readFile, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { runQueue, hash } from './runner.mjs';
import { materializeDefaults } from './canonical-request.mjs';
import { campaign as h, receipt, settings, docker } from './campaign-session.mjs';

const ROOT = resolve('C:/Users/Veky/.t3/worktrees/pteroclone/t3-6837dde7/ptero-go');
const CAMPAIGN_ROOT = resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go');
const RECIPES = Object.freeze({ puck: 'puck/egg-puck.json', clonehero: 'clone_hero/egg-clone-hero.json', cryofall: 'cryofall/egg-cryo-fall.json', tachyon: 'ftl_tachyon/egg-tachyon.json', waterfall: 'minecraft/proxy/java/waterfall/egg-waterfall.json', travertine: 'minecraft/proxy/java/travertine/egg-travertine.json', viaaas: 'minecraft/proxy/java/viaaas/egg-v-i-aaa-s.json', waterdog: 'minecraft/proxy/bedrock/waterdog_pe/egg-waterdog-p-e.json', 'waterdog-duplicate': 'minecraft/proxy/bedrock/waterdog_pe/egg-waterdog-pe.json' });
const WATERDOG_B802_BUILD = 'c86a1b2a87fb7ec733c10caa2ff8e56ce3464b8eefd49fe5c0dfd73d49c2f0a4';
const WATERDOG_B802_IDS = Object.freeze({ 'waterdog-canonical-b802': 'waterdog', 'waterdog-duplicate-canonical-b802': 'waterdog-duplicate' });
function spec(ctx) {
  const family = WATERDOG_B802_IDS[ctx.game.id] ?? ctx.game.id.replace(/-canonical$/, '');
  if (!Object.hasOwn(RECIPES, family) || (!Object.hasOwn(WATERDOG_B802_IDS, ctx.game.id) && ctx.game.id !== family + '-canonical')) throw Error('Family not allowed');
  const recipe = RECIPES[family], template = hash(recipe).slice(0, 16);
  return { family, recipe, template, name: 'validator-' + ctx.game.id,
    prefix: '/api/client/game-library/templates/' + template, memory: family === 'viaaas' ? 2048 : 1024 };
}
const attrs = value => value?.attributes ?? value;
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value ?? '');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const sorted = object => Array.isArray(object) ? object.map(sorted) : object && typeof object === 'object'
  ? Object.fromEntries(Object.keys(object).sort().map(key => [key, sorted(object[key])])) : object;
const goJSON = value => JSON.stringify(value).replaceAll('&', '\\u0026').replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
export function canonicalEggUUID(ctx, profile) {
  // Mirror gameTemplateOverrideDigest's struct order and omitempty semantics.
  // Unknown fields require source review rather than silently changing identity.
  const ignored = new Set(['settings_documents', 'setup_validation', 'verification', 'detail', 'setup_steps']);
  const order = ['setup_unavailable_reason', 'agreements', 'upstream_sha256', 'revision', 'defaults', 'egg', 'platforms', 'required_ports', 'consecutive_ports', 'consecutive_ports_count', 'consecutive_primary_offset', 'primary_port_env', 'port_rules'];
  const body = {};
  for (const key of Object.keys(profile)) if (!ignored.has(key) && !order.includes(key)) throw Error('Unreviewed override field: ' + key);
  const struct = (value, keys, required = []) => {
    for (const key of Object.keys(value)) if (!keys.includes(key)) throw Error('Unreviewed canonical metadata field: ' + key);
    return Object.fromEntries(keys.filter(key => required.includes(key) || value[key] && (!Array.isArray(value[key]) || value[key].length)).map(key => [key, value[key] ?? '']));
  };
  for (const key of order) {
    const value = profile[key];
    if (!['upstream_sha256', 'revision', 'defaults', 'egg'].includes(key) && (!value || Array.isArray(value) && !value.length)) continue;
    body[key] = key === 'agreements' ? value.map(a => struct(a, ['environment', 'title', 'text', 'effective_date', 'reviewed_date', 'accept_value'], ['environment', 'title', 'text', 'effective_date', 'accept_value']))
      : key === 'port_rules' ? value.map(p => struct({ value: '', minimum: 0, maximum: 0, count: 0, ...p }, ['environment', 'value', 'minimum', 'maximum', 'count', 'offsets', 'condition', 'allocated_value', 'allocated_offsets', 'exclude_primary', 'exclude_offsets', 'exclude_ports', 'auto_allocate', 'when_environment', 'when_value'], ['environment', 'value', 'minimum', 'maximum', 'count']))
      : sorted(value ?? null);
  }
  const hex = hash(spec(ctx).recipe + ':' + hash(goJSON(body))).slice(0, 32);
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}
export function validateDefaults(variables, environment) {
  for (const variable of variables) {
    const value = environment[variable.env_variable];
    if (typeof value !== 'string' || value.includes('\0')) throw Error('Invalid canonical variable default');
    let rules = variable.rules.match(/(?:not_)?regex:\/(?:\\.|[^/])*\/|[^|]+/gi) ?? [];
    // Backend splitEggRules skips empty boundary separators.
    if (rules.join('|') !== variable.rules.replace(/^\|+|\|+$/g, '')) throw Error('Malformed canonical variable rules');
    rules = rules.map(rule => rule.replace(/^[^:]+/, name => name.trim().toLowerCase()));
    if (!value && rules.includes('nullable')) continue;
    for (const rule of rules) {
      if (rule === 'string' || rule === 'nullable') continue;
      if (rule === 'boolean' && ['0', '1', 'true', 'false'].includes(value)) continue;
      if (rule === 'integer' && /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value))) continue;
      if (rule.startsWith('not_regex:/') && rule.endsWith('/') && !new RegExp(rule.slice(11, -1)).test(value)) continue;
      // eggs.go eggSizeRational uses numeric size only for numeric/integer rules;
      // otherwise string bounds count Unicode characters.
      const size = rules.some(r => r === 'numeric' || r === 'integer') ? Number(value) : [...value].length;
      if (rule.startsWith('between:')) {
        const bounds = rule.slice(8).split(',');
        if (bounds.length === 2 && bounds.every(b => /^-?\d+(\.\d+)?$/.test(b))
          && Number.isFinite(size) && size >= Number(bounds[0]) && size <= Number(bounds[1])) continue;
      }
      if (rule === 'required' && value.length || rule.startsWith('max:') && size <= Number(rule.slice(4))
        || rule.startsWith('in:') && rule.slice(3).split(',').includes(value)
        || rule === 'integer' && /^-?\d+$/.test(value) || rule.startsWith('min:') && size >= Number(rule.slice(4))
        || rule === 'numeric' && /^-?\d+(\.\d+)?$/.test(value)) continue;
      if (rule.startsWith('regex:/') && rule.endsWith('/')) {
        if (new RegExp(rule.slice(7, -1)).test(value)) continue;
      }
      throw Error('Canonical variable constraint requires review: ' + variable.env_variable + ' ' + rule);
    }
  }
}

async function api(ctx, path, method = 'GET', body, raw = false) {
  ctx.signal.throwIfAborted();
  const response = await fetch('http://127.0.0.1:18099' + path, {
    method, redirect: 'error', signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(30000)]),
    headers: { 'Content-Type': raw ? 'text/plain' : 'application/json' },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = new Error(`${method} ${path.split('?')[0]} returned HTTP ${response.status}`);
    error.status = response.status; throw error;
  }
  if (response.status === 204) return null;
  return raw ? response.text() : response.json();
}
async function until(ctx, fn, label, timeout = 600000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    ctx.signal.throwIfAborted();
    const value = await fn();
    if (value) return value;
    await sleep(250);
  }
  throw Error('Timeout: ' + label + '; preserve fixture and locks');
}
async function lock(ctx, name) {
  const file = resolve(ctx.output, name);
  const handle = await open(file, 'wx'); // Never reclaim a prior process's lock.
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, game: ctx.game.id, request_id: ctx.fixture.intent.request.request_id })); }
  finally { await handle.close(); }
  (ctx.locks ??= []).push(file);
}
async function release(ctx) {
  for (const file of [...(ctx.locks ?? [])].reverse()) await unlink(file);
  ctx.locks = [];
}
function followLogs(ctx, id) {
  const child = spawn('docker', ['--context', 'desktop-linux', 'logs', '--follow', id], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal: ctx.signal });
  let serial = Promise.resolve(), sequence = 0, artifactError;
  const files = [];
  // Each chunk goes through the runner's redactor, including partial failures.
  const capture = chunk => {
    const name = 'installer-follow-' + String(sequence++).padStart(6, '0') + '.log';
    serial = serial.then(async () => { files.push(await ctx.artifact(name, chunk)); }).catch(error => { artifactError = error; });
  };
  const pending = { stdout: '', stderr: '' };
  for (const stream of ['stdout', 'stderr']) {
    child[stream].setEncoding('utf8');
    child[stream].on('data', chunk => {
      pending[stream] += chunk;
      const end = pending[stream].lastIndexOf('\n');
      if (end >= 0) { capture(pending[stream].slice(0, end + 1)); pending[stream] = pending[stream].slice(end + 1); }
    });
  }
  return new Promise((done, reject) => {
    let failure;
    child.on('error', error => { failure = error; });
    child.on('close', async code => {
      for (const text of Object.values(pending)) if (text) capture(text);
      await serial;
      if (artifactError || failure || code !== 0) reject(artifactError ?? failure ?? new Error('Docker logs follow exited ' + code));
      else done({ files, exit: code });
    });
  });
}
async function containers(ctx) {
  const s = ctx.fixture?.server;
  if (!s) return [];
  const ids = (await docker(['ps', '-aq', '--filter', 'name=' + s.uuid], ctx.signal)).trim().split(/\s+/).filter(Boolean);
  const rows = [];
  for (const id of ids) {
    const value = JSON.parse(await docker(['inspect', '--format', '{"id":{{json .Id}},"name":{{json .Name}},"state":{{json .State}},"memory":{{json .HostConfig.Memory}},"image":{{json .Config.Image}},"type":{{json (index .Config.Labels "ContainerType")}},"mounts":{{json .Mounts}}}', id], ctx.signal));
    if (value.name !== '/' + s.uuid && value.name !== '/' + s.uuid + '_installer') throw Error('Unexpected matching container; inspect ownership');
    rows.push(value);
  }
  return rows;
}
function requestDigest(ctx, request) {
  request = materializeDefaults(h.profileFromRuntime(spec(ctx).recipe, receipt).egg.variables, request);
  // Go encoding/json sorts map keys. This is the exact automatic-port digest.
  const value = { template: spec(ctx).template, name: request.name, memory: request.memory, disk: request.disk,
    image: request.image, environment: request.environment, primary: 0, additional: [], automatic_ports: true, node_id: request.node_id };
  // Go JSON HTML escaping also applies to string values.
  return hash(goJSON(sorted(value)));
}
async function identity(ctx, server) {
  const intent = ctx.fixture.intent, r = intent.request;
  if (!Number.isSafeInteger(server.id) || !uuid(server.uuid) || server.name !== spec(ctx).name
    || Number(server.user) !== intent.ownerId || Number(server.node) !== r.node_id
    || server.external_id !== intent.externalId || Number(server.limits?.memory) !== (ctx.fixture.diagnosticMemory?.confirmed === true ? 0 : spec(ctx).memory)
    || Number(server.limits?.disk) !== 10240) throw Error('Canonical fixture identity/resource mismatch');
  const egg = attrs(await api(ctx, '/api/admin/eggs/' + server.egg));
  const catalog = JSON.parse(await readFile(resolve(receipt.snapshot, 'internal/panel/game_library/upstream/catalog.json'), 'utf8'));
  const entry = catalog.entries.find(e => e.path === spec(ctx).recipe);
  const profile = h.profileFromRuntime(spec(ctx).recipe, receipt);
  if (!entry || profile.upstream_sha256 !== entry.sha256 || egg.uuid !== canonicalEggUUID(ctx, profile)
    || egg.script_install !== profile.egg.scripts.installation.script) {
    throw Error('Canonical egg UUID differs from active source recipe');
  }
  if (['waterfall', 'travertine', 'viaaas', 'waterdog', 'waterdog-duplicate'].includes(spec(ctx).family)) {
  // Frozen eggs.go imports voltra.java_config; lifecycle.createServer calls
  // javaPrepare -> javaResolve. An automatic managed runtime replaces the POST
  // image with the exact enabled catalog runtime for the egg's preferred major.
  const ec = profile.egg.voltra?.java_config ?? {};
  const normalized = Object.keys(ec).length ? { enabled: true, required_major: 0, required_distribution: '',
    memory_mode: 'command', args_file: 'user_jvm_args.txt', jvm_args: '', ...ec } : {};
  if (JSON.stringify(sorted(egg.java_config ?? {})) !== JSON.stringify(sorted(normalized))
    || Object.keys(server.java_config ?? {}).length) throw Error('Canonical Java configuration changed');
  let effectiveImage = r.image;
  if (ec.enabled === true) {
    const major = ec.default_major || ec.required_major || 17;
    const runtimes = (await api(ctx, '/api/admin/java/runtimes')).data.map(attrs);
    const runtime = runtimes.find(v => v.enabled === true && Number(v.major) === major
      && (!ec.required_distribution || v.distribution === ec.required_distribution));
    if (!runtime) throw Error('Exact canonical automatic Java runtime missing');
    effectiveImage = runtime.image;
  }
  if (server.container?.image !== effectiveImage) throw Error('Canonical effective image mismatch');
  } else if (server.container?.image !== r.image || Object.keys(server.java_config ?? {}).length) throw Error('Canonical runtime image/config mismatch');
  if (ctx.fixture.server && (server.id !== ctx.fixture.server.id || server.uuid !== ctx.fixture.server.uuid)) throw Error('Preserved server identity changed');
  return server;
}
async function reconcile(ctx) {
  const response = await api(ctx, '/api/application/servers?per_page=1000');
  if (response.meta?.pagination?.total_pages > 1) throw Error('Reconciliation must cover every server');
  const prefix = `catalog:${ctx.fixture.intent.ownerId}:${ctx.fixture.intent.request.request_id}:`;
  const matches = response.data.map(attrs).filter(s => String(s.external_id ?? '').startsWith(prefix));
  if (matches.length > 1) throw Error('Multiple request identities; preserve all resources');
  if (!matches.length) return null;
  const server = await identity(ctx, matches[0]);
  ctx.fixture.server = { id: server.id, uuid: server.uuid, name: server.name };
  const egg = attrs(await api(ctx, '/api/admin/eggs/' + server.egg));
  ctx.fixture.egg = { id: egg.id, uuid: egg.uuid };
  await ctx.own(ctx.fixture);
  return server;
}

export async function verify(ctx) {
  spec(ctx);
  if (resolve(settings.campaignRoot) !== CAMPAIGN_ROOT) throw Error('Campaign root mismatch');
  if (!Number.isFinite(ctx.game.installPeakMiB) || !(ctx.game.installerDefaultMiB > 0)
    || ctx.game.installPeakMiB < Math.max(spec(ctx).memory, ctx.game.installerDefaultMiB)) throw Error('Reserve reviewed Wings installer peak before creation');
  if (!h || receipt?.binary_sha256 !== ctx.build || settings.build !== ctx.build) throw Error('Verified campaign session/build required');
  if (settings.maxInstallers < 1 || settings.maxInstallers > 4
    || resolve(ctx.output) !== resolve(ROOT, '.local/validator-campaign')) throw Error('Use the shared campaign output and exclusive installer policy');
  if (!Number.isSafeInteger(ctx.game.ownerId) || ctx.game.ownerId < 1) throw Error('Reviewed ownerId required');
  if (Object.hasOwn(WATERDOG_B802_IDS, ctx.game.id) && ctx.build !== WATERDOG_B802_BUILD) throw Error('New b802 Waterdog fixtures require exact candidate17');
  const gate = ctx.game.reconciliation ?? settings.reconciliation;
  if (gate?.id !== 'mainvalidator-20261103-smallgames-canonical' || !gate.path || !/^[a-f0-9]{64}$/.test(gate.sha256 ?? '')) throw Error('Reviewed exact evidence gate required');
  const bytes = await readFile(resolve(gate.path), 'utf8');
  if (hash(bytes) !== gate.sha256) throw Error('Evidence gate hash changed');
  const rows = JSON.parse(bytes).games?.filter(row => row.game === spec(ctx).family);
  if (rows?.length !== 1) throw Error('Exact family gate missing');
  const row = rows[0], pin = row.native;
  const names = { puck: 'wave417-puck-current/report.json', clonehero: 'clonehero-wave4-native.json', cryofall: 'cryofall-wave4-native-final.json', tachyon: 'tachyon-wave6-native-final.json', waterfall: '../waterfall-proxy-live-acceptance.json', travertine: '../travertine-proxy-live-acceptance.json', viaaas: '../viaaas-proxy-live-acceptance.json', waterdog: '../waterdog-proxy-live-acceptance.json', 'waterdog-duplicate': '../waterdog-duplicate-proxy-live-acceptance.json' };
  const expectedPath = resolve(CAMPAIGN_ROOT, 'artifacts/game-parity-20261029', names[spec(ctx).family]);
  if (!pin?.path || resolve(pin.path) !== expectedPath || !/^[a-f0-9]{64}$/.test(pin.sha256 ?? '')) throw Error('Exact historical report pin required');
  const raw = await readFile(expectedPath, 'utf8'), report = JSON.parse(raw);
  if (hash(raw) !== pin.sha256 || report.recipe !== spec(ctx).recipe) throw Error('Historical native evidence changed');
  const family = spec(ctx).family;
  if (family === 'clonehero' && !(report.installation?.success === true && report.installation.installer_native_exit === 0 && report.gates && report.evidence?.installer_log)
    || family === 'cryofall' && !(report.completion?.startsWith('partial native acceptance') && report.five_gates?.console && report.fixture?.uuid)
    || family === 'tachyon' && !(report.status === 'native-reviewed-with-explicit-boundaries' && report.complete === false && Array.isArray(report.five_gates) && Array.isArray(report.remaining))) throw Error('Historical native report shape changed');
  if (['waterfall', 'travertine'].includes(family)) {
    const count = family === 'waterfall' ? 13 : 12, q = report.query?.java_status;
    if (!uuid(report.uuid) || !report.native_version || report.query?.recipe !== spec(ctx).recipe || report.query.phase !== 'restored' || report.protected_files !== count
      || report.preservation?.uuid !== report.uuid || report.preservation.files?.length !== count
      || report.preservation.files.some(v => v.preserved !== true || v.metadata_preserved !== true
        || JSON.stringify(v.metadata_checked) !== JSON.stringify(['mode', 'uid', 'gid']))
      || q?.status?.version?.protocol !== 754 || q.status.players?.max !== 12 || q.nonce_echo !== true || q.player_login_sent !== false
      || JSON.stringify(q.status.description) !== JSON.stringify({ extra: [{ text: 'Voltra "Proxy" $ + 517077' }], text: '' })
      || report.configuration_reload !== 'native greload; changed listener values proved without process restart'
      || [report.first_stop, report.final_stop].some(v => v?.state?.Running !== false || v.state.ExitCode !== 0 || v.state.OOMKilled !== false)
      || !Array.isArray(report.limitations) || !report.limitations.length) throw Error('Historical proxy native report shape changed');
  }
  if (['viaaas', 'waterdog', 'waterdog-duplicate'].includes(family)) {
    const count = { viaaas: 10, waterdog: 6, 'waterdog-duplicate': 8 }[family], q = report.query;
    if (!uuid(report.uuid) || q?.recipe !== spec(ctx).recipe || q.phase !== 'restored' || report.protected_files !== count
      || report.preservation?.uuid !== report.uuid || report.preservation.files?.length !== count
      || report.preservation.files.some(v => v.preserved !== true || v.metadata_preserved !== true
        || JSON.stringify(v.metadata_checked) !== JSON.stringify(['mode', 'uid', 'gid']))
      || [report.first_stop, report.final_stop].some(v => v?.state?.Running !== false || v.state.ExitCode !== 0 || v.state.OOMKilled !== false)
      || !Array.isArray(report.limitations) || !report.limitations.length) throw Error('Historical proxy retention/stop report shape changed');
    if (family === 'viaaas') {
      if (q.https?.status !== 200 || q.https.content_type !== 'text/html; charset=UTF-8' || !(q.https.response_bytes > 0)
        || q.https.self_signed_tls_allowed_only_for_acceptance !== true || q.https.authenticated_login !== false
        || q.java_status?.status?.version?.protocol !== 754 || q.java_status.status.version.name !== 'VIAaaS'
        || q.java_status.status.players?.max !== 12 || q.java_status.nonce_echo !== true || q.java_status.player_login_sent !== false
        || !q.java_status.status.description?.text?.startsWith('\u00a7cStacklessException: Missing parts in hostname #')) throw Error('Historical VIAaaS native boundary changed');
    } else {
      if (q.raknet?.native_raknet_pong !== true || q.raknet.nonce_echo !== true || q.raknet.motd !== 'Voltra "Proxy" $ + 517077'
        || q.raknet.protocol !== '2225' || q.raknet.game_version !== '1.26.60' || q.raknet.max_players !== 12 || q.raknet.player_login_sent !== false
        || q.builtin_http?.status !== 404 || q.builtin_http.authenticated_connection !== false) throw Error('Historical Waterdog native boundary changed');
      if (family === 'waterdog-duplicate' && (report.native_version !== 'WaterdogPE2.0.4 (publisher latest asset reports Development Build:true)'
        || report.configuration_reload !== 'native restart required; changed listener values proved after restart'
        || q.nethernet_advertisement?.method !== 'GET' || q.nethernet_advertisement.path !== '/v1/join'
        || q.nethernet_advertisement.status !== 200 || q.nethernet_advertisement.offer_sent !== false
        || q.nethernet_advertisement.player_connected !== false)) throw Error('Historical distinct Waterdog advertisement boundary changed');
    }
  }
  if (family === 'puck') {
    if (pin.sha256 !== 'dea6490231d5f994ac52181103312d04b43751a417c2a8297242e79cfbe0a191'
      || report.actual?.install?.raw_exit?.exit !== '0' || report.actual?.install?.callback?.success !== true
      || report.actual?.reinstall?.raw_exit?.exit !== '0' || report.actual?.reinstall?.retention?.all_preserved !== true
      || report.actual?.reinstall?.retention?.rows !== 22 || report.actual?.lifecycle?.final_stop?.ExitCode !== 0
      || report.actual?.console?.command_semantic_response !== false) throw Error('Puck historical lifecycle boundary differs');
    const followupPath = resolve(CAMPAIGN_ROOT, 'artifacts/game-parity-20261029/wave434-puck-flag-native/report.json');
    const followupBytes = await readFile(followupPath, 'utf8');
    if (hash(followupBytes) !== 'e50feb56b8bbb167febfd6c66df22f2d7b8db9945dc1fca10000463392f87a3c'
      || JSON.parse(followupBytes).status !== 'native_config_load_passed') throw Error('Puck native flag receipt differs');
    if (ctx.game.diagnosticRequired || row.presentation?.consoleInputSupported !== false
      || !Array.isArray(row.presentation?.fields) || row.presentation.fields.length) throw Error('Puck scope is offline console capability only');
    await ctx.artifact('puck-reused-boundary.json', { nativeLifecycle: pin, nativeFlag: { path: followupPath, sha256: hash(followupBytes) },
      signalStop: 'Prior actual native clean stop reused. No power/signal or launcher changes in this checker.',
      nativeTerminalCommands: 'No reviewed stock terminal command interface; retain chat-command and custom-launcher distinction',
      scope: 'Canonical create/install plus served logs-only capability, not repeated gameplay/settings/lifecycle acceptance' });
  }
  const profile = h.profileFromRuntime(spec(ctx).recipe, receipt);
  if (!/^[a-f0-9]{64}$/.test(row.frozen?.profileSHA256 ?? '') || !/^[a-f0-9]{64}$/.test(row.frozen?.scriptSHA256 ?? '')
    || hash(JSON.stringify(sorted(profile))) !== row.frozen.profileSHA256 || hash(profile.egg.scripts.installation.script) !== row.frozen.scriptSHA256) throw Error('Frozen reviewed family source differs from served build');
  if (!Array.isArray(row.presentation?.fields) || family !== 'puck' && !row.presentation.fields.length || typeof row.presentation.consoleInputSupported !== 'boolean') throw Error('Reviewed typed fields and console capability required');
  if (['waterfall', 'travertine'].includes(family)) {
    const required = [{ key: '/listeners', type: 'list' }, { key: '/online_mode', type: 'boolean' },
      { key: '/ip_forward', type: 'boolean' }, { key: '/player_limit', type: 'number' }, { key: '/connection_throttle', type: 'number' }];
    if (row.presentation.consoleInputSupported !== true || required.some(expected => !row.presentation.fields.some(field =>
      field.key === expected.key && field.type === expected.type))) throw Error('Reviewed proxy fields/capability differ from frozen parser');
  }
  if (['viaaas', 'waterdog', 'waterdog-duplicate'].includes(family)) {
    const required = family === 'viaaas' ? [{ key: '/bind-addresses', type: 'list' }, { key: '/max-players', type: 'number' },
      { key: '/force-online-mode', type: 'boolean' }] : [{ key: '/listener/motd', type: 'text' },
      { key: '/listener/max_players', type: 'number' }, { key: '/nethernet/signaling/stun_discovery', type: 'boolean' }];
    if (row.presentation.consoleInputSupported !== true || required.some(expected => !row.presentation.fields.some(field =>
      field.key === expected.key && field.type === expected.type))) throw Error('Reviewed proxy fields/capability differ from frozen parser');
  }
  await ctx.artifact('prior-native-pin.json', { reused: true, historicalOnly: Object.hasOwn(WATERDOG_B802_IDS, ctx.game.id), currentJarNativeAcceptance: Object.hasOwn(WATERDOG_B802_IDS, ctx.game.id) ? false : undefined, pin, boundary: report.boundary ?? report.completion ?? report.remaining,
    browser: 'Historical browser evidence remains historical; this run records served API only', crashDiagnostics: 'Root separate diagnostic remains open', scope: 'No repeated native lifecycle or player acceptance' });
  const account = attrs(await api(ctx, '/api/client/account'));
  if (Number(account.id) !== ctx.game.ownerId || account.root_admin !== true) throw Error('Canonical POST actor differs from reviewed admin owner');
  if (ctx.fixture) {
    const f = ctx.fixture;
    if (f.name !== spec(ctx).name || f.recipe !== spec(ctx).recipe || f.template !== spec(ctx).template || f.intent?.build !== ctx.build
      || f.intent.ownerId !== ctx.game.ownerId || !uuid(f.intent.request?.request_id)
      || f.intent.externalId !== `catalog:${f.intent.ownerId}:${f.intent.request.request_id}:${requestDigest(ctx, f.intent.request)}`) throw Error('Preserved intent identity mismatch');
    const request = f.intent.request, profile = h.profileFromRuntime(spec(ctx).recipe, receipt);
    if (request.name !== spec(ctx).name || request.memory !== spec(ctx).memory || request.disk !== 10240 || request.automatic_ports !== true
      || !Number.isSafeInteger(request.node_id) || request.node_id < 1 || !Object.values(profile.egg.docker_images).includes(request.image)
      || f.intent.scriptHash !== hash(profile.egg.scripts.installation.script)) throw Error('Preserved canonical request changed');
    validateDefaults(profile.egg.variables, materializeDefaults(profile.egg.variables, request).environment);
    if (f.server) await identity(ctx, attrs(await api(ctx, '/api/application/servers/' + f.server.id)));
  }
}

async function prepare(ctx) {
  const profile = h.profileFromRuntime(spec(ctx).recipe, receipt);
  const options = attrs(await api(ctx, spec(ctx).prefix));
  const catalog = JSON.parse(await readFile(resolve(receipt.snapshot, 'internal/panel/game_library/upstream/catalog.json'), 'utf8'));
  if (options.id !== spec(ctx).template || hash(spec(ctx).recipe).slice(0, 16) !== spec(ctx).template || options.available !== true
    || options.source !== `${catalog.repository}/blob/${catalog.revision}/${spec(ctx).recipe}` || options.profile !== profile.revision
    || options.automatic_ports !== true || !Array.isArray(options.variables)) throw Error('Served canonical options differ from active snapshot');
  const eligible = options.nodes.filter(n => n.setup_available === true && Number(n.available_memory) >= spec(ctx).memory && Number(n.available_disk) >= 10240);
  const node = ctx.game.nodeId ? eligible.find(n => Number(n.id) === ctx.game.nodeId) : eligible.length === 1 ? eligible[0] : null;
  if (!node) throw Error('Select an eligible reviewed nodeId');
  await ctx.artifact('settings-declarations.json', { recipe: spec(ctx).recipe, declaredDocuments: profile.settings_documents ?? [], scope: 'Frozen canonical declaration; served document checked after installation' });
  const image = ctx.game.image ?? options.images[0]?.value;
  if (!options.images.some(i => i.value === image) || !Object.values(profile.egg.docker_images).includes(image)) throw Error('Runtime image is not canonical');
  const environment = Object.fromEntries(options.variables.map(v => {
    if (!v.env_variable || typeof v.rules !== 'string' || v.default_value == null) throw Error('Incomplete variable metadata');
    return [v.env_variable, String(v.default_value)];
  }));
  if (JSON.stringify(options.variables.map(v => [v.env_variable, v.default_value, v.rules])) !== JSON.stringify(profile.egg.variables.map(v => [v.env_variable, v.default_value, v.rules]))) throw Error('Served variables differ from active family recipe');
  if (options.agreements?.length) throw Error('Unreviewed publisher agreement');
  validateDefaults(options.variables, environment);
  // Defaults and constraints are recorded verbatim; the canonical endpoint performs
  // authoritative variable validation before any allocation or server mutation.
  const request = { request_id: randomUUID(), name: spec(ctx).name, memory: spec(ctx).memory, disk: 10240, image,
    environment, automatic_ports: true, node_id: Number(node.id) };
  const intent = { request, ownerId: ctx.game.ownerId, build: ctx.build, template: spec(ctx).template,
    at: new Date().toISOString(), optionsHash: hash(JSON.stringify(options)), source: options.source,
    profile: options.profile, scriptHash: hash(profile.egg.scripts.installation.script),
    externalId: `catalog:${ctx.game.ownerId}:${request.request_id}:${requestDigest(ctx, request)}`,
    resourceReview: { serverMiB: spec(ctx).memory, installerDefaultMiB: ctx.game.installerDefaultMiB, reservedPeakMiB: ctx.game.installPeakMiB, rule: 'Wings max(server memory, installer default); no post-creation resource update' },
    noAutostart: 'gameTemplateInstall calls createServer start_on_completion=false' };
  await ctx.artifact('options.json', options);
  await ctx.own({ name: spec(ctx).name, recipe: spec(ctx).recipe, template: spec(ctx).template, intent });
  await ctx.artifact('intent.json', intent);
}

async function observeInstaller(ctx) {
  const f = ctx.fixture;
  const installer = await until(ctx, async () => (await containers(ctx)).find(c => c.name === '/' + f.server.uuid + '_installer'), 'native installer appearance', 90000);
  if (installer.type !== 'server_installer' || !installer.mounts.some(m => m.Destination === '/mnt/server' && m.Source.endsWith('/' + f.server.uuid))) throw Error('Installer mount/label identity mismatch');
  f.installerId = installer.id;
  // Attach immediately, before callback polling or artifact writes. allSettled
  // installs rejection handlers now, including when the other observation fails.
  const observations = Promise.allSettled([
    docker(['wait', installer.id], ctx.signal, 900000),
    followLogs(ctx, installer.id),
  ]);
  await ctx.own(f);
  // Creation is serialized, but independent observed installers may run together.
  const provision = resolve(ctx.output, 'provision.lock');
  if (ctx.locks?.includes(provision)) {
    await unlink(provision);
    ctx.locks = ctx.locks.filter(file => file !== provision);
  }
  const limits = { id: installer.id, memory: installer.memory, state: installer.state, at: new Date().toISOString() };
  await ctx.artifact('installer-resources.json', limits);
  f.installerResources = limits; await ctx.own(f);
  const memoryValid = Number.isSafeInteger(installer.memory) && installer.memory >= Math.max(spec(ctx).memory, ctx.game.installerDefaultMiB) * 1048576
    && installer.memory <= ctx.game.installPeakMiB * 1048576;
  const callbackResult = await Promise.allSettled([until(ctx, async () => {
    const server = await identity(ctx, attrs(await api(ctx, '/api/application/servers/' + f.server.id)));
    return h.classifyInstallOutcome(server);
  }, 'installer callback')]);
  const callback = callbackResult[0].status === 'fulfilled' ? callbackResult[0].value : null;
  const [raw, logs] = await observations;
  const logPath = await ctx.artifact('installer-follow-index.json', logs.status === 'fulfilled' ? logs.value : { error: String(logs.reason), partialChunksPreserved: true });
  f.install = { rawExit: raw.status === 'fulfilled' ? raw.value.trim() : null, rawError: raw.status === 'rejected' ? String(raw.reason) : null,
    callback, callbackError: callback ? null : String(callbackResult[0].reason), logPath, logsFollowed: logs.status === 'fulfilled', memoryValid, scriptHash: f.intent.scriptHash };
  await ctx.own(f);
  await until(ctx, async () => !(await containers(ctx)).some(c => c.id === installer.id), 'installer removal', 30000);
  f.install.removed = true; await ctx.own(f);
  // A failed native exit is valid evidence and can release the slot. Missing
  // exit/log/callback/removal evidence cannot, even if the panel looks finished.
  if (!/^\d+$/.test(f.install.rawExit ?? '') || !f.install.logsFollowed || !callback) throw Error('Incomplete raw installer observations');
  await release(ctx);
  if (!memoryValid) throw Error('Actual installer memory differs from reviewed server/default/reserved peak');
  if (f.install.rawExit !== '0' || !callback.success) throw Error('Native canonical installation failed; preserved fixture and logs');
  return f.install;
}

async function offline(ctx) {
  if (!ctx.fixture?.server) {
    if (ctx.fixture?.postAttempted) throw Error('Unresolved POST; cannot prove offline, retain locks');
    return { offline: true, noServerRequested: true, preserved: true };
  }
  await identity(ctx, attrs(await api(ctx, '/api/application/servers/' + ctx.fixture.server.id)));
  const native = await containers(ctx);
  if (native.some(c => c.state.Running || c.name.endsWith('_installer'))) throw Error('Fixture or installer active; preserve resources and locks for root');
  if (!ctx.fixture.install?.callback?.success) {
    const server = attrs(await api(ctx, '/api/application/servers/' + ctx.fixture.server.id));
    if (server.status === 'install_failed' && Number(server.container?.installed) === 0)
      return { offline: true, installationFailed: true, preserved: true, native: native.map(c => ({ id: c.id, state: c.state })) };
    throw Error('Install outcome unresolved; preserve fixture and locks');
  }
  const resources = attrs(await api(ctx, '/api/client/servers/' + ctx.fixture.server.uuid + '/resources'));
  if (resources.current_state !== 'offline') throw Error('Owned fixture is not offline');
  return { offline: true, preserved: true, native: native.map(c => ({ id: c.id, state: c.state })) };
}

export async function run(ctx) {
  if (!ctx.fixture) await ctx.check('canonical-options-and-intent', async () => { await prepare(ctx); return ctx.fixture.intent; });
  let f = ctx.fixture;
  if (!f.install) {
    await ctx.reserve(Math.max(spec(ctx).memory, ctx.game.installPeakMiB));
    await until(ctx, async () => {
      try { await lock(ctx, 'provision.lock'); return true; }
      catch (error) { if (error.code !== 'EEXIST') throw error; return false; }
    }, 'canonical creation slot', 120000);
    let acquired = false;
    for (let slot = 0; slot < settings.maxInstallers; slot++) {
      try { await lock(ctx, 'installer-' + slot + '.lock'); acquired = true; break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (!acquired) throw Error('All reviewed installer slots occupied');
    // Reconcile before every retry. A server found by request correlation is
    // adopted only after full owner/node/recipe/resource identity validation.
    let server = await reconcile(ctx);
    if (!server) {
      if (f.postAttempted) {
        await ctx.artifact('reconciliation-' + Date.now() + '.json', { request_id: f.intent.request.request_id, found: false, at: new Date().toISOString() });
      }
      f.postAttempted = true; await ctx.own(f); // durable before network ambiguity
      try {
        const result = attrs(await api(ctx, spec(ctx).prefix + '/install', 'POST', materializeDefaults(h.profileFromRuntime(spec(ctx).recipe, receipt).egg.variables, f.intent.request)));
        f.returnedIdentifier = result.identifier; await ctx.own(f);
      } catch (error) {
        f.postError = error.message; await ctx.own(f);
        server = await reconcile(ctx);
        if (!server) throw Error('Ambiguous canonical POST; retained request intent. Root reconciles before explicit retry with the same request_id');
      }
      server ??= await reconcile(ctx);
      if (!server || (f.returnedIdentifier && server.identifier !== f.returnedIdentifier)) throw Error('POST result did not resolve to exact correlated server');
    }
    await ctx.check('canonical-native-install', () => observeInstaller(ctx));
  } else {
    if (f.install.rawExit !== '0' || !f.install.callback?.success || !f.install.memoryValid || !f.install.removed || !f.install.logsFollowed) throw Error('Preserved installation did not pass; root must recover exact observations');
    await ctx.check('retained-canonical-install', async () => ({ ...f.install, reused: true }));
  }

  // ctx.own replaces the durable fixture object during reconciliation/install.
  f = ctx.fixture;
  await ctx.check('post-callback-resources', async () => {
    const allocations = (await api(ctx, '/api/client/servers/' + f.server.uuid + '/network/allocations')).data.map(attrs);
    f.ports = allocations.map(a => a.port); f.allocation = allocations.find(a => a.is_default);
    if (!f.allocation) throw Error('Missing default allocation after callback');
    await ctx.own(f);
    return { allocations, resources: attrs(await api(ctx, '/api/client/servers/' + f.server.uuid + '/resources')) };
  });
  if (ctx.game.diagnosticRequired) {
    const { runDiagnostic } = await import('./smallgames-diagnostic-check.mjs');
    await ctx.check('native-crash-diagnostic', () => runDiagnostic(ctx));
  }
  await ctx.check('offline-before-presentation', () => offline(ctx));
  const route = '/api/client/servers/' + f.server.uuid;
  const gate = JSON.parse(await readFile(resolve((ctx.game.reconciliation ?? settings.reconciliation).path), 'utf8')).games.find(row => row.game === spec(ctx).family);
  const files = { clonehero: '/clone/settings.ini', cryofall: '/Data/SettingsServer.xml', tachyon: '/tachyon/config.cfg', waterfall: '/config.yml', travertine: '/config.yml', viaaas: '/config/viaaas.yml', waterdog: '/config.yml', 'waterdog-duplicate': '/config.yml' };
  const file = files[spec(ctx).family];
  if (spec(ctx).family !== 'puck') await ctx.check('served-offline-game-settings', async () => {
    let original;
    try { original = await api(ctx, route + '/files/contents?file=' + encodeURIComponent(file), 'GET', undefined, true); }
    catch (error) {
      await ctx.artifact('cold-config-boundary.json', { file, status: error.status, scope: 'Cold canonical installer did not expose a readable publisher config; no game start or synthetic config permitted', nativeConsumption: false });
      throw Error('Cold publisher config unavailable; offline presentation remains unproved');
    }
    await ctx.artifact('publisher-config.log', original);
    const response = await api(ctx, route + '/game-settings?file=' + encodeURIComponent(file)), body = attrs(response);
    await ctx.artifact('game-settings.json', response);
    if (!Array.isArray(body.fields)) throw Error('Typed fields absent');
    for (const expected of gate.presentation.fields) {
      if (!expected.key || !expected.type) throw Error('Incomplete reviewed field');
      const found = body.fields.filter(field => field.key === expected.key);
      if (found.length !== 1 || Object.entries(expected).some(([key, value]) => JSON.stringify(found[0][key]) !== JSON.stringify(value))) throw Error('Reviewed typed field differs: ' + expected.key);
    }
    if (original !== await api(ctx, route + '/files/contents?file=' + encodeURIComponent(file), 'GET', undefined, true)) throw Error('Read-only presentation changed publisher config');
    return { file, sha256: hash(original), fields: body.fields, nativeConsumption: false, scope: 'Served offline API only' };
  });
  await ctx.check('served-console-capability', async () => {
    const response = await api(ctx, route), body = attrs(response);
    await ctx.artifact('client-server.json', response);
    if (body.uuid !== f.server.uuid || body.console_input_supported !== gate.presentation.consoleInputSupported) throw Error('Reviewed console input capability differs');
    return { console_input_supported: body.console_input_supported, scope: 'API exposure only; no console command, game start or crash diagnostic exercised' };
  });
  await ctx.check('recipe-startup-metadata', async () => {
    const response = await api(ctx, route + '/startup');
    await ctx.artifact('startup.json', response);
    const variables = response.data.map(attrs), profile = h.profileFromRuntime(spec(ctx).recipe, receipt);
    for (const expected of profile.egg.variables.filter(v => v.user_viewable)) {
      const found = variables.filter(v => v.env_variable === expected.env_variable);
      if (found.length !== 1 || found[0].name !== expected.name || found[0].description !== expected.description || found[0].rules !== expected.rules || found[0].default_value !== expected.default_value
        || Boolean(found[0].is_editable) !== Boolean(expected.user_editable)) throw Error('Recipe startup metadata mismatch: ' + expected.env_variable);
    }
    return { recipe: spec(ctx).recipe, variables, nativeSettingsClaim: false };
  });
  await ctx.check('preserved-offline', () => offline(ctx));
}

export async function park(ctx) {
  // Never stop an unobserved installer or manufacture successful cancellation.
  // Preserve failed installation and unknown POST resources for root review.
  const evidence = await offline(ctx);
  if (!ctx.fixture?.postAttempted || ctx.fixture?.install?.removed && /^\d+$/.test(ctx.fixture.install.rawExit ?? '') && ctx.fixture.install.logsFollowed && ctx.fixture.install.callback) await release(ctx);
  if (ctx.locks?.length) throw Error('Incomplete installer evidence; locks retained for root recovery');
  return evidence;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [flag, manifest, ...extra] = process.argv.slice(2);
  if (flag !== '--run' || !manifest || extra.some(arg => arg !== '--retry')) throw Error('Usage: node smallgames-canonical-check.mjs --run reviewed-manifest.json [--retry]');
  const config = JSON.parse(await readFile(resolve(manifest), 'utf8'));
  const adapter = resolve(process.argv[1]);
  if (!config.games?.length || config.games.length > 8 || new Set(config.games.map(g => g.id)).size !== config.games.length
    || !(/^[a-f0-9]{64}$/.test(config.build ?? '')) || resolve(config.campaignRoot) !== CAMPAIGN_ROOT
    || !Number.isInteger(config.maxInstallers) || config.maxInstallers < 1 || config.maxInstallers > 4
    || resolve(config.output) !== resolve(ROOT, '.local/validator-campaign')
    || !(config.policy?.reserveMiB >= 8192) || !(config.policy?.reserveDiskMiB >= 32768)
    || !Number.isInteger(config.policy.maxParallel) || config.policy.maxParallel < 1 || config.policy.maxParallel > 4
    || resolve(config.session) !== resolve(ROOT, 'tools/runtime/validator/campaign-session.mjs')
    || resolve(config.monitor) !== resolve(config.session)) throw Error('Reviewed shared-session manifest required');
  for (const game of config.games) {
    const selected = spec({ game });
    if (!Number.isSafeInteger(game.ownerId) || game.ownerId < 1 || resolve(game.adapter) !== adapter
      || !(game.installerDefaultMiB > 0) || !(game.installPeakMiB >= Math.max(selected.memory, game.installerDefaultMiB)) || !(game.peakMiB >= game.installPeakMiB) || !(game.diskMiB >= 10240)) throw Error('Reviewed installer peak/resources required');
    game.scope = 'Canonical creation/defaults/install and offline presentation only; no new native settings, gameplay or world claim';
  }
  const results = await runQueue(config, { retry: extra.includes('--retry') ? config.games.map(g => g.id) : [] });
  console.log(JSON.stringify(results.map(({ game, status, code }) => ({ game, status, code }))));
  process.exitCode = results.some(result => result.status !== 'PASS') ? 1 : 0;
}
