#!/usr/bin/env node
/** Canonical Minecraft setup/presentation coordinator for the six reconciled families. Importing never opens a session.
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
const BUILD = '4737b2a7a77a0a30f5efe11639cda0c28e223362b7025a999862a9d35835df56';
const GLOWSTONE_BUILD = '248f83a9ae1acc2db8248993823d07e427ff26954e2549c89143c1470dacd0e7';
const SPIGOT_BUILD = '32aefb21d6016f5f17a8e6437a319ec67d8cde92500fae1b3a6968ba26b0e034';
const SPIGOT_SNAPSHOT = resolve(CAMPAIGN_ROOT, 'artifacts/game-parity-20261029/validator-build-20261103-16/build-input-1793670457807');
const RECIPES = Object.freeze({
  glowstone: 'minecraft/java/glowstone/egg-glowstone.json',
  spigot: 'minecraft/java/spigot/egg-spigot.json',
  fabric: 'minecraft/java/fabric/egg-fabric.json', forge: 'minecraft/java/forge/egg-forge-enhanced.json',
  neoforge: 'minecraft/java/neoforge/egg-neoforge.json', quilt: 'minecraft/java/quilt/egg-quilt.json',
  vanillacord: 'minecraft/java/vanillacord/egg-vanilla-cord.json', arclight: 'minecraft/java/arclight/egg-arclight.json',
});
const specName = (id, family) => id === 'glowstone-clean-canonical' ? 'validator-glowstone-clean-canonical' : 'validator-' + family + '-canonical';
function spec(ctx) {
  const family = ctx.game.id === 'glowstone-clean-canonical' ? 'glowstone' : ctx.game.id.replace(/-canonical$/, '');
  if (!Object.hasOwn(RECIPES, family) || (ctx.game.id !== family + '-canonical' && ctx.game.id !== 'glowstone-clean-canonical')) throw Error('Family not allowed');
  const recipe = RECIPES[family], template = hash(recipe).slice(0, 16);
  return { family, recipe, template, name: specName(ctx.game.id, family),
    prefix: '/api/client/game-library/templates/' + template, memory: ['forge', 'neoforge', 'arclight'].includes(family) ? 3072 : 2048 };
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
      : key === 'port_rules' ? value.map(p => struct(p, ['environment', 'value', 'minimum', 'maximum', 'count', 'offsets', 'condition', 'allocated_value', 'allocated_offsets', 'exclude_primary', 'exclude_offsets', 'exclude_ports', 'auto_allocate', 'when_environment', 'when_value']))
      : sorted(value ?? null);
  }
  const hex = hash(spec(ctx).recipe + ':' + hash(goJSON(body))).slice(0, 32);
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}
function validateDefaults(variables, environment) {
  for (const variable of variables) {
    const value = environment[variable.env_variable];
    if (typeof value !== 'string' || value.includes('\0')) throw Error('Invalid canonical variable default');
    const rules = variable.rules.split('|');
    if (!value && rules.includes('nullable')) continue;
    for (const rule of rules) {
      if (rule === 'string' || rule === 'nullable') continue;
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
        || rule === 'numeric' && /^-?\d+(\.\d+)?$/.test(value)) continue;
      if (rule.startsWith('regex:/') && rule.endsWith('/')) {
        if (new RegExp(rule.slice(7, -1)).test(value)) continue;
      }
      throw Error('Canonical variable constraint requires review: ' + variable.env_variable + ' ' + rule);
    }
  }
}

function preCreationValidation(detail) {
  // Candidate19: these exact validations return before createServer/tx.Commit.
  // Generic SQL validation and unknown/provider failures are NOT classified.
  return new Set(['Enter a server name of at most 100 characters.','A valid installation request ID is required.','Choose valid memory and storage limits.','Choose a listed runtime image.','Game settings must be an object.','Choose an available node.','The node has insufficient available memory.','The node has insufficient available disk.','Select a valid active owner.','Select a valid egg.']).has(detail)
    || /^Variable [A-Z0-9_]{1,191} (?:is not user editable|is required|does not satisfy [a-z_]+|must be a string|has an invalid format)\.?$/.test(detail);
}
async function boundedAPIErrors(response,request) {
  const reader=response.body?.getReader();let bytes=new Uint8Array(0),truncated=false;
  if(reader)while(true){const item=await reader.read();if(item.done)break;if(bytes.length+item.value.length>8192){truncated=true;await reader.cancel();break}const next=new Uint8Array(bytes.length+item.value.length);next.set(bytes);next.set(item.value,bytes.length);bytes=next;}
  let parsed;try{if(!truncated)parsed=JSON.parse(new TextDecoder().decode(bytes));}catch{}
  if(Array.isArray(parsed?.errors)&&parsed.errors.length>3)truncated=true;
  const values=Object.entries(request?.environment??{}).filter(([key,value])=>/(token|password|secret|api.?key|auth)/i.test(key)&&typeof value==='string'&&value.length).map(([,value])=>value);
  const errors=(Array.isArray(parsed?.errors)?parsed.errors:[]).slice(0,3).map(item=>{
    const original=typeof item.detail==='string'?item.detail:'';let detail=original.slice(0,512).replace(/[\r\n\t]/g,' ');
    for(const value of values)detail=detail.split(value).join('[REDACTED]');
    detail=detail.replace(/(?:https?:\/\/)[^\s]+/g,'[URL]').replace(/(?:Bearer|Basic)\s+\S+/gi,'[REDACTED]').replace(/"[^"\r\n]*"|'[^'\r\n]*'|`[^`\r\n]*`/g,'[REDACTED]').replace(/\b[A-Za-z0-9_+\/=.-]{32,}\b/g,'[OPAQUE]');
    const code=typeof item.code==='string'&&/^[A-Za-z0-9_]{1,80}$/.test(item.code)?item.code:'UnspecifiedError';
    return {code,detail:detail||'No bounded diagnostic detail returned',beforeCreate:code==='ValidationException'&&preCreationValidation(original)};
  });
  return {errors,truncated};
}
async function api(ctx, path, method = 'GET', body, raw = false) {
  ctx.signal.throwIfAborted();
  const response = await fetch('http://127.0.0.1:18099' + path, {
    method, redirect: 'error', signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(30000)]),
    headers: { 'Content-Type': raw ? 'text/plain' : 'application/json' },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    const diagnostic=await boundedAPIErrors(response,body);
    const summary=diagnostic.errors.map(item=>item.code+': '+item.detail).join('; ');
    const error = new Error(`${method} ${path.split('?')[0]} returned HTTP ${response.status}`+(summary?' '+summary:''));
    error.status=response.status;error.apiErrors=diagnostic.errors;error.diagnosticTruncated=diagnostic.truncated;
    error.preCreationValidation=response.status===422&&!diagnostic.truncated&&diagnostic.errors.length>0&&diagnostic.errors.every(item=>item.beforeCreate);throw error;
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
function canonicalRequest(ctx, request) {
  // Reports intentionally redact credentials. Glowstone uses frozen defaults
  // only, so rebuild them before hashing, validation, or replaying a POST.
  return spec(ctx).family === 'glowstone' ? materializeDefaults(h.profileFromRuntime(spec(ctx).recipe, receipt).egg.variables, request) : request;
}
function requestDigest(ctx, request) {
  request = canonicalRequest(ctx, request);
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
    || server.external_id !== intent.externalId || Number(server.limits?.memory) !== spec(ctx).memory
    || Number(server.limits?.disk) !== 10240) throw Error('Canonical fixture identity/resource mismatch');
  const egg = attrs(await api(ctx, '/api/admin/eggs/' + server.egg));
  const catalog = JSON.parse(await readFile(resolve(receipt.snapshot, 'internal/panel/game_library/upstream/catalog.json'), 'utf8'));
  const entry = catalog.entries.find(e => e.path === spec(ctx).recipe);
  const profile = h.profileFromRuntime(spec(ctx).recipe, receipt);
  if (!entry || profile.upstream_sha256 !== entry.sha256 || egg.uuid !== canonicalEggUUID(ctx, profile)
    || egg.script_install !== profile.egg.scripts.installation.script) {
    throw Error('Canonical egg UUID differs from active source recipe');
  }
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
  if (ctx.build !== (spec(ctx).family === 'glowstone' ? GLOWSTONE_BUILD : spec(ctx).family === 'spigot' ? SPIGOT_BUILD : BUILD) || settings.maxInstallers < 1 || settings.maxInstallers > 4
    || resolve(ctx.output) !== resolve(ROOT, '.local/validator-campaign')) throw Error('Use the shared campaign output and exclusive installer policy');
  if (!Number.isSafeInteger(ctx.game.ownerId) || ctx.game.ownerId < 1) throw Error('Reviewed ownerId required');
  const gate = ['spigot','glowstone'].includes(spec(ctx).family) ? (ctx.game.reconciliation ?? settings.reconciliation) : settings.reconciliation;
  if (spec(ctx).family === 'glowstone') {
    const { verifyGlowstoneReview } = await import('./glowstone-canonical-check.mjs');
    await verifyGlowstoneReview(ctx, gate);
  } else if (spec(ctx).family === 'spigot') {
    if (gate?.id !== 'mainvalidator-20261103-spigot-canonical' || !gate.path || !/^[a-f0-9]{64}$/.test(gate.sha256 ?? '') || resolve(receipt.snapshot) !== SPIGOT_SNAPSHOT) throw Error('Reviewed candidate16 Spigot canonical gate required');
    const raw = await readFile(resolve(gate.path), 'utf8');
    if (hash(raw) !== gate.sha256) throw Error('Spigot review gate changed');
    const rows = JSON.parse(raw).games?.filter(row => row.game === 'spigot');
    if (rows?.length !== 1) throw Error('Exact Spigot gate row required');
    const profile = h.profileFromRuntime(spec(ctx).recipe, receipt);
    if (profile.egg.variables.find(v => v.env_variable === 'DL_VERSION')?.default_value !== '26.3' || profile.egg.variables.find(v => v.env_variable === 'DL_PATH')?.default_value !== '' || profile.egg.variables.find(v => v.env_variable === 'DOWNLOAD_SHA256')?.default_value !== '' || rows[0].frozen?.profileSHA256 !== hash(JSON.stringify(sorted(profile))) || rows[0].frozen?.scriptSHA256 !== hash(profile.egg.scripts.installation.script)) throw Error('Spigot official BuildTools defaults/frozen authority changed');
    for (const kind of ['native', 'retention']) {
      const pin = rows[0][kind], expected = resolve(CAMPAIGN_ROOT, 'artifacts/game-parity-20261029/validator-20261103-spigot', kind === 'native' ? 'lifecycle.json' : 'report.json');
      if (!pin?.path || resolve(pin.path) !== expected || !/^[a-f0-9]{64}$/.test(pin.sha256 ?? '')) throw Error('Spigot exact prior report pin missing');
      const bytes = await readFile(expected, 'utf8'), report = JSON.parse(bytes);
      if (hash(bytes) !== pin.sha256 || report.game !== 'spigot' || report.build !== SPIGOT_BUILD || report.status !== 'PASS' || report.fixture?.recipe !== spec(ctx).recipe || !Array.isArray(report.checks) || report.checks.some(c => c.status !== 'PASS') || report.fixture.install?.canonicalScriptSha256 !== hash(profile.egg.scripts.installation.script) || report.fixture.install.rawExit !== '0' || report.fixture.install.callback?.success !== true) throw Error('Spigot prior native/installer evidence changed');
      const required = kind === 'native' ? ['start-ready', 'settings', 'saved', 'reload'] : ['canonical-reinstall', 'reinstall-retained-bytes', 'reinstall-native-reload'];
      if (required.some(name => report.checks.filter(c => c.name === name).length !== 1)) throw Error('Spigot prior check shape differs');
      if (kind === 'native' && (report.checks.find(c => c.name === 'saved').evidence?.exitCode !== 0 || !report.checks.find(c => c.name === 'reload').evidence?.sameSeed)) throw Error('Spigot native save/reload boundary missing');
      if (kind === 'retention') {
        const retained = report.checks.find(c => c.name === 'reinstall-retained-bytes').evidence;
        if (retained?.identical !== true || retained.ownershipAndModes !== true || !(retained.files > 0)) throw Error('Spigot strict retention evidence missing');
      }
    }
    await ctx.artifact('spigot-prior-native-retention-pins.json', { gate: rows[0], reused: true, scope: 'Native lifecycle/reinstall only; this canonical fixture must run its own unchanged installer. No cross-fixture cache/payload copy.' });
  } else {
  if (gate?.id !== 'mainvalidator-20261102-minecraft-reconciliation'
    || resolve(gate.path) !== resolve(ROOT, '.local/validator-campaign/progress-reconciled.json')) throw Error('Reviewed reconciliation gate required');
  const bytes = await readFile(gate.path, 'utf8');
  if (hash(bytes) !== gate.sha256) throw Error('Reconciliation receipt hash changed');
  const rows = JSON.parse(bytes).newNativeAndReinstallEvidence;
  const prior = rows?.filter(row => row.game === spec(ctx).family);
  if (prior?.length !== 1 || prior[0].status !== 'PASS' || !prior[0].offline
    || prior[0].remaining !== 'Canonical recipe-specific setup/UI acceptance') throw Error('Family is not an open canonical settings gate');
  const retained = await readFile(resolve(ctx.output, spec(ctx).family + '.json'), 'utf8');
  if (hash(retained) !== prior[0].sha256 || JSON.parse(retained).status !== 'PASS') throw Error('Prior native/retention receipt differs from reconciliation');
  }
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
    validateDefaults(profile.egg.variables, canonicalRequest(ctx, request).environment);
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
  const image = ctx.game.image ?? options.images[0]?.value;
  if (!options.images.some(i => i.value === image) || !Object.values(profile.egg.docker_images).includes(image)) throw Error('Runtime image is not canonical');
  const environment = Object.fromEntries(options.variables.map(v => {
    if (!v.env_variable || typeof v.rules !== 'string' || v.default_value == null) throw Error('Incomplete variable metadata');
    return [v.env_variable, String(v.default_value)];
  }));
  if (JSON.stringify(options.variables.map(v => [v.env_variable, v.default_value, v.rules])) !== JSON.stringify(profile.egg.variables.map(v => [v.env_variable, v.default_value, v.rules]))) throw Error('Served variables differ from active family recipe');
  for (const agreement of options.agreements ?? []) {
    if (agreement.environment !== 'EULA_ACCEPTED' || agreement.accept_value !== 'true' || !/minecraft/i.test(agreement.title)) throw Error('Unapproved publisher agreement');
    environment[agreement.environment] = agreement.accept_value;
  }
  if (options.variables.some(v => v.env_variable === 'EULA_ACCEPTED')) environment.EULA_ACCEPTED = 'true';
  validateDefaults(options.variables, environment);
  // Defaults and constraints are recorded verbatim; the canonical endpoint performs
  // authoritative variable validation before any allocation or server mutation.
  const request = { request_id: randomUUID(), name: spec(ctx).name, memory: spec(ctx).memory, disk: 10240, image,
    environment, automatic_ports: true, node_id: Number(node.id) };
  const intent = { request, ownerId: ctx.game.ownerId, build: ctx.build, template: spec(ctx).template,
    at: new Date().toISOString(), optionsHash: hash(JSON.stringify(options)), source: options.source,
    profile: options.profile, scriptHash: hash(profile.egg.scripts.installation.script),
    externalId: `catalog:${ctx.game.ownerId}:${request.request_id}:${requestDigest(ctx, request)}`,
    eula: { url: 'https://www.minecraft.net/eula', accepted: true, at: new Date().toISOString(),
      authority: 'User explicitly authorized Minecraft EULA acceptance', method: environment.EULA_ACCEPTED === 'true'
        ? 'Canonical install POST environment.EULA_ACCEPTED=true' : 'Durable consent before canonical catalog POST; recipe exposes no EULA environment control' },
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
    if(ctx.fixture?.preCreationRejection?.confirmed===true)return{offline:true,noServerCreated:true,preserved:true,preCreationValidation:ctx.fixture.preCreationRejection,boundary:'Port/egg side effects may remain; no fixture deletion'};
    if (ctx.fixture?.postAttempted) throw Error('Unresolved POST; cannot prove offline, retain locks');
    return { offline: true, noServerRequested: true, preserved: true };
  }
  await identity(ctx, attrs(await api(ctx, '/api/application/servers/' + ctx.fixture.server.id)));
  const native = await containers(ctx);
  if (native.some(c => c.state.Running || c.name.endsWith('_installer'))) throw Error('Fixture or installer active; preserve resources and locks for root');
  if (!ctx.fixture.install?.callback?.success) throw Error('Successful callback not proved; preserve fixture and locks without client resource request');
  const resources = attrs(await api(ctx, '/api/client/servers/' + ctx.fixture.server.uuid + '/resources'));
  if (resources.current_state !== 'offline') throw Error('Owned fixture is not offline');
  return { offline: true, preserved: true, native: native.map(c => ({ id: c.id, state: c.state })) };
}

async function recoveredPresentation(ctx) {
  const f = ctx.fixture, base = resolve(ctx.output, 'neoforge-canonical');
  const reviewBytes = await readFile(resolve(base, 'recovery-review.json'), 'utf8');
  if (ctx.game.id !== 'neoforge-canonical' || f.server.id !== 241
    || f.server.uuid !== '5d981f45-5a7a-4a47-a2ea-3e3070c9831e'
    || hash(reviewBytes) !== 'bfe5412eb75090d6898422ec7b68b8c77376dabd24a0b4344962395ae0353232') throw Error('Unreviewed recovered fixture');
  const review = JSON.parse(reviewBytes);
  const eventsBytes = await readFile(resolve(base, 'recovery-docker-events.json'), 'utf8');
  const log = await readFile(resolve(base, 'recovery-install.log'), 'utf8');
  const before = await readFile(resolve(base, 'recovery-failed-report.json'), 'utf8');
  const events = JSON.parse(eventsBytes), original = JSON.parse(before);
  const installer = f.install.installerId;
  if (hash(eventsBytes) !== review.eventsSha256 || hash(log) !== review.logSha256 || hash(before) !== review.reportBeforeSha256
    || review.server.id !== f.server.id || review.server.uuid !== f.server.uuid || review.server.externalId !== f.intent.externalId
    || original.fixture?.intent?.externalId !== f.intent.externalId || !review.offline || !review.installerAbsent
    || !/^[0-9a-f]{64}$/.test(installer ?? '') || !log.trim()
    || f.install.rawExit !== '0' || !f.install.callback?.success || !f.install.removed || !f.install.logsRecovered
    || !events.some(e => e.Action === 'die' && e.Actor?.ID === installer && e.Actor.Attributes?.exitCode === '0'
      && e.Actor.Attributes?.name === f.server.uuid + '_installer' && e.Actor.Attributes?.ContainerType === 'server_installer')) throw Error('Recovered fixture proof incomplete');
  return { recoveredForPresentationOnly: true, rawExit: '0', eventsSha256: review.eventsSha256,
    logSha256: review.logSha256, installerMemoryProved: false, scope: review.scope };
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
      delete f.preCreationRejection;f.postDiagnostic=null;f.postError=null;
      f.postAttempted = true; await ctx.own(f); // durable before network ambiguity
      try {
        const result = attrs(await api(ctx, spec(ctx).prefix + '/install', 'POST', canonicalRequest(ctx, f.intent.request)));
        f.returnedIdentifier = result.identifier; await ctx.own(f);
      } catch (error) {
        f.postError = error.message;f.postDiagnostic={status:error.status??null,errors:error.apiErrors??[],truncated:error.diagnosticTruncated??false};await ctx.own(f);
        server = await reconcile(ctx);
        if(!server&&error.preCreationValidation&&spec(ctx).family==='glowstone'&&ctx.build===GLOWSTONE_BUILD){
          f=ctx.fixture;f.preCreationRejection={confirmed:true,status:422,diagnostic:f.postDiagnostic,request_id:f.intent.request.request_id,noCorrelatedServer:true,at:new Date().toISOString(),source:'Candidate19 game_templates.go validation before createServer; unknown/SQL errors excluded',boundary:'No server/native create; allocated rows or catalog egg side effects are not excluded'};
          await ctx.own(f);await ctx.artifact('canonical-precreation-validation.json',f.preCreationRejection);await release(ctx);throw error;
        }
        if (!server) throw Error('Ambiguous canonical POST; retained request intent. Root reconciles before explicit retry with the same request_id. '+error.message);
      }
      server ??= await reconcile(ctx);
      if (!server || (f.returnedIdentifier && server.identifier !== f.returnedIdentifier)) throw Error('POST result did not resolve to exact correlated server');
    }
    await ctx.check('canonical-native-install', () => observeInstaller(ctx));
  } else {
    if (f.install.recoveredForPresentationOnly) {
      await ctx.check('recovered-canonical-install-presentation-only', () => recoveredPresentation(ctx));
    } else {
      if (f.install.rawExit !== '0' || !f.install.callback?.success || !f.install.memoryValid || !f.install.removed || !f.install.logsFollowed) throw Error('Preserved installation did not pass; root must recover exact observations');
      await ctx.check('retained-canonical-install', async () => ({ ...f.install, reused: true }));
    }
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
  await ctx.check('offline-before-presentation', () => offline(ctx));
  const route = '/api/client/servers/' + f.server.uuid;
  if (spec(ctx).family === 'glowstone') {
    const { runGlowstoneCanonical } = await import('./glowstone-canonical-check.mjs');
    await runGlowstoneCanonical(ctx,api);
    await ctx.check('preserved-offline',()=>offline(ctx));
    return;
  }
  await ctx.check('presentation-properties', async () => {
    let text;
    try { text = await api(ctx, route + '/files/contents?file=%2Fserver.properties', 'GET', undefined, true); }
    catch (error) { if (error.status !== 404) throw error; text = ''; }
    const original = text;
    await ctx.artifact('properties-before.log', original);
    if (!/^\s*max-players\s*[=:]/m.test(text)) {
      text += (text && !text.endsWith('\n') ? '\n' : '') + '# Validator presentation only; no game start or loaded-world claim\nmax-players=20\n';
      f.presentationFixture = { beforeSHA256: hash(original), afterSHA256: hash(text), nativeSettingsClaim: false };
      await ctx.own(f); await offline(ctx);
      await api(ctx, route + '/files/write?file=%2Fserver.properties', 'POST', text, true);
      if (await api(ctx, route + '/files/contents?file=%2Fserver.properties', 'GET', undefined, true) !== text) throw Error('Properties readback mismatch');
    }
    return { beforeHash: hash(original), hash: hash(text), scope: 'Offline presentation only' };
  });
  const url = route + '/game-settings?file=%2Fserver.properties';
  for (const suffix of ['/quick-setup', '/game-settings?file=%2Fserver.properties']) {
    await ctx.check(suffix.startsWith('/quick') ? 'served-quick-setup' : 'served-game-settings', async () => {
      const response = await api(ctx, route + suffix), body = attrs(response);
      await ctx.artifact(suffix.startsWith('/quick') ? 'quick-setup.json' : 'game-settings.json', response);
      const fields = body.fields?.filter(field => field.key === 'max-players');
      if (fields?.length !== 1 || fields[0].type !== 'number' || fields[0].read_only === true || fields[0].readonly === true
        || body.read_only === true || body.readonly === true) throw Error('Writable numeric max-players field missing');
      return { field: fields[0], scope: 'Served presentation only' };
    });
  }
  await ctx.check('presentation-edit-readback', async () => {
    await offline(ctx);
    const before = attrs(await api(ctx, url));
    const field = before.fields.find(f => f.key === 'max-players');
    const value = String(field.value) === '7' ? '8' : '7';
    const original = await api(ctx, route + '/files/contents?file=%2Fserver.properties', 'GET', undefined, true);
    await api(ctx, url, 'PUT', { revision: before.revision, settings: { 'max-players': value } });
    const after = attrs(await api(ctx, url));
    const edited = await api(ctx, route + '/files/contents?file=%2Fserver.properties', 'GET', undefined, true);
    const unrelated = text => text.split(/\r?\n/).filter(line => !/^\s*max-players\s*[=:]/.test(line)).join('\n');
    if (String(after.fields.find(f => f.key === 'max-players')?.value) !== value || unrelated(original) !== unrelated(edited)) throw Error('Typed edit/readback or unrelated property preservation failed');
    await ctx.artifact('properties-edited.log', edited);
    return { value, beforeRevision: before.revision, revision: after.revision, nativeSettingsClaim: false };
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
  if (!ctx.fixture?.postAttempted || ctx.fixture?.preCreationRejection?.confirmed===true || ctx.fixture?.install?.removed && /^\d+$/.test(ctx.fixture.install.rawExit ?? '') && ctx.fixture.install.logsFollowed && ctx.fixture.install.callback) await release(ctx);
  if (ctx.locks?.length) throw Error('Incomplete installer evidence; locks retained for root recovery');
  return evidence;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [flag, manifest, ...extra] = process.argv.slice(2);
  if (flag !== '--run' || !manifest || extra.some(arg => arg !== '--retry')) throw Error('Usage: node minecraft-canonical-check.mjs --run reviewed-manifest.json [--retry]');
  const config = JSON.parse(await readFile(resolve(manifest), 'utf8'));
  const adapter = resolve(process.argv[1]);
  if (!config.games?.length || config.games.length > 6 || new Set(config.games.map(g => g.id)).size !== config.games.length
    || (config.build !== BUILD && !(config.build === GLOWSTONE_BUILD && config.games.every(game=>['glowstone-canonical','glowstone-clean-canonical'].includes(game.id)))) || resolve(config.campaignRoot) !== CAMPAIGN_ROOT
    || !Number.isInteger(config.maxInstallers) || config.maxInstallers < 1 || config.maxInstallers > 4
    || resolve(config.output) !== resolve(ROOT, '.local/validator-campaign')
    || !(config.policy?.reserveMiB >= 8192) || !(config.policy?.reserveDiskMiB >= 32768)
    || !Number.isInteger(config.policy.maxParallel) || config.policy.maxParallel < 1 || config.policy.maxParallel > 4
    || resolve(config.session) !== resolve(ROOT, 'tools/runtime/validator/campaign-session.mjs')
    || resolve(config.monitor) !== resolve(config.session)) throw Error('Reviewed candidate8 shared-session manifest required');
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
