#!/usr/bin/env node
/** Canonical Paper presentation coordinator. Importing never opens a session.
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
import { campaign as h, receipt, settings, docker } from './campaign-session.mjs';

const TEMPLATE = '230a4c12a943f40a';
const RECIPE = 'minecraft/java/paper/egg-paper.json';
const NAME = 'validator-paper-canonical';
const PREFIX = '/api/client/game-library/templates/' + TEMPLATE;
const attrs = value => value?.attributes ?? value;
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value ?? '');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const sorted = object => Array.isArray(object) ? object.map(sorted) : object && typeof object === 'object'
  ? Object.fromEntries(Object.keys(object).sort().map(key => [key, sorted(object[key])])) : object;
const goJSON = value => JSON.stringify(value).replaceAll('&', '\\u0026').replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
function canonicalEggUUID(profile) {
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
  const hex = hash(RECIPE + ':' + hash(goJSON(body))).slice(0, 32);
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
      if (rule === 'required' && value.length || rule.startsWith('max:') && value.length <= Number(rule.slice(4))
        || rule.startsWith('in:') && rule.slice(3).split(',').includes(value)
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
function requestDigest(request) {
  // Go encoding/json sorts map keys. This is the exact automatic-port digest.
  const value = { template: TEMPLATE, name: request.name, memory: request.memory, disk: request.disk,
    image: request.image, environment: request.environment, primary: 0, additional: [], automatic_ports: true, node_id: request.node_id };
  // Go JSON HTML escaping also applies to string values.
  return hash(goJSON(sorted(value)));
}
async function identity(ctx, server) {
  const intent = ctx.fixture.intent, r = intent.request;
  if (!Number.isSafeInteger(server.id) || !uuid(server.uuid) || server.name !== NAME
    || Number(server.user) !== intent.ownerId || Number(server.node) !== r.node_id
    || server.external_id !== intent.externalId || Number(server.limits?.memory) !== 2048
    || Number(server.limits?.disk) !== 10240 || server.container?.image !== r.image) throw Error('Canonical fixture identity/resource mismatch');
  const egg = attrs(await api(ctx, '/api/admin/eggs/' + server.egg));
  const catalog = JSON.parse(await readFile(resolve(receipt.snapshot, 'internal/panel/game_library/upstream/catalog.json'), 'utf8'));
  const entry = catalog.entries.find(e => e.path === RECIPE);
  const profile = h.profileFromRuntime(RECIPE, receipt);
  if (!entry || profile.upstream_sha256 !== entry.sha256 || egg.uuid !== canonicalEggUUID(profile)
    || egg.script_install !== profile.egg.scripts.installation.script) {
    throw Error('Canonical egg UUID differs from active source recipe');
  }
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
  // Client APIs are intentionally unavailable while installation is in progress.
  if (server.status === null && server.container?.installed === 1) {
  const allocations = (await api(ctx, '/api/client/servers/' + server.uuid + '/network/allocations')).data.map(attrs);
  ctx.fixture.ports = allocations.map(a => a.port);
  ctx.fixture.allocation = allocations.find(a => a.is_default) ?? allocations[0];
  }
  await ctx.own(ctx.fixture);
  return server;
}

export async function verify(ctx) {
  if (!h || receipt?.binary_sha256 !== ctx.build || settings.build !== ctx.build) throw Error('Verified campaign session/build required');
  if (ctx.game.id !== 'paper-canonical' || settings.maxInstallers !== 1
    || resolve(ctx.output) !== resolve('.local/validator-campaign')) throw Error('Use the shared campaign output and exclusive installer policy');
  if (!Number.isSafeInteger(ctx.game.ownerId) || ctx.game.ownerId < 1) throw Error('Reviewed ownerId required');
  const account = attrs(await api(ctx, '/api/client/account'));
  if (Number(account.id) !== ctx.game.ownerId || account.root_admin !== true) throw Error('Canonical POST actor differs from reviewed admin owner');
  if (ctx.fixture) {
    const f = ctx.fixture;
    if (f.name !== NAME || f.recipe !== RECIPE || f.template !== TEMPLATE || f.intent?.build !== ctx.build
      || f.intent.ownerId !== ctx.game.ownerId || !uuid(f.intent.request?.request_id)
      || f.intent.externalId !== `catalog:${f.intent.ownerId}:${f.intent.request.request_id}:${requestDigest(f.intent.request)}`) throw Error('Preserved intent identity mismatch');
    const request = f.intent.request, profile = h.profileFromRuntime(RECIPE, receipt);
    if (request.name !== NAME || request.memory !== 2048 || request.disk !== 10240 || request.automatic_ports !== true
      || !Number.isSafeInteger(request.node_id) || request.node_id < 1 || !Object.values(profile.egg.docker_images).includes(request.image)
      || f.intent.scriptHash !== hash(profile.egg.scripts.installation.script)) throw Error('Preserved canonical request changed');
    validateDefaults(profile.egg.variables, request.environment);
    if (f.server) await identity(ctx, attrs(await api(ctx, '/api/application/servers/' + f.server.id)));
  }
}

async function prepare(ctx) {
  const profile = h.profileFromRuntime(RECIPE, receipt);
  const options = attrs(await api(ctx, PREFIX));
  const catalog = JSON.parse(await readFile(resolve(receipt.snapshot, 'internal/panel/game_library/upstream/catalog.json'), 'utf8'));
  if (options.id !== TEMPLATE || hash(RECIPE).slice(0, 16) !== TEMPLATE || options.available !== true
    || options.source !== `${catalog.repository}/blob/${catalog.revision}/${RECIPE}` || options.profile !== profile.revision
    || options.automatic_ports !== true || !Array.isArray(options.variables)) throw Error('Served canonical options differ from active snapshot');
  const eligible = options.nodes.filter(n => n.setup_available === true && Number(n.available_memory) >= 2048 && Number(n.available_disk) >= 10240);
  const node = ctx.game.nodeId ? eligible.find(n => Number(n.id) === ctx.game.nodeId) : eligible.length === 1 ? eligible[0] : null;
  if (!node) throw Error('Select an eligible reviewed nodeId');
  const image = ctx.game.image ?? options.images[0]?.value;
  if (!options.images.some(i => i.value === image) || !Object.values(profile.egg.docker_images).includes(image)) throw Error('Runtime image is not canonical');
  const environment = Object.fromEntries(options.variables.map(v => {
    if (!v.env_variable || typeof v.rules !== 'string' || v.default_value == null) throw Error('Incomplete variable metadata');
    return [v.env_variable, String(v.default_value)];
  }));
  if (JSON.stringify(options.variables.map(v => [v.env_variable, v.default_value, v.rules])) !== JSON.stringify(profile.egg.variables.map(v => [v.env_variable, v.default_value, v.rules]))) throw Error('Served variables differ from active Paper recipe');
  for (const agreement of options.agreements ?? []) {
    if (agreement.environment !== 'EULA_ACCEPTED' || agreement.accept_value !== 'true' || !/minecraft/i.test(agreement.title)) throw Error('Unapproved publisher agreement');
    environment[agreement.environment] = agreement.accept_value;
  }
  if (options.variables.some(v => v.env_variable === 'EULA_ACCEPTED')) environment.EULA_ACCEPTED = 'true';
  validateDefaults(options.variables, environment);
  // Defaults and constraints are recorded verbatim; the canonical endpoint performs
  // authoritative variable validation before any allocation or server mutation.
  const request = { request_id: randomUUID(), name: NAME, memory: 2048, disk: 10240, image,
    environment, automatic_ports: true, node_id: Number(node.id) };
  const intent = { request, ownerId: ctx.game.ownerId, build: ctx.build, template: TEMPLATE,
    at: new Date().toISOString(), optionsHash: hash(JSON.stringify(options)), source: options.source,
    profile: options.profile, scriptHash: hash(profile.egg.scripts.installation.script),
    externalId: `catalog:${ctx.game.ownerId}:${request.request_id}:${requestDigest(request)}`,
    eula: { url: 'https://www.minecraft.net/eula', accepted: true, at: new Date().toISOString(),
      authority: 'User explicitly authorized Minecraft EULA acceptance', method: environment.EULA_ACCEPTED === 'true'
        ? 'Canonical install POST environment.EULA_ACCEPTED=true' : 'Durable consent before canonical catalog POST; recipe exposes no EULA environment control' },
    resourceReview: 'Canonical memory=2048 -> lifecycle build.memory_limit -> Wings max(server memory, installer default); no resource update',
    noAutostart: 'gameTemplateInstall calls createServer start_on_completion=false' };
  await ctx.artifact('options.json', options);
  await ctx.own({ name: NAME, recipe: RECIPE, template: TEMPLATE, intent });
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
  const limits = { id: installer.id, memory: installer.memory, state: installer.state, at: new Date().toISOString() };
  await ctx.artifact('installer-resources.json', limits);
  f.installerResources = limits; await ctx.own(f);
  const memoryValid = Number.isSafeInteger(installer.memory) && installer.memory >= 2048 * 1048576;
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
  if (!memoryValid) throw Error('Actual native installer memory below 2048 MiB');
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
  const resources = attrs(await api(ctx, '/api/client/servers/' + ctx.fixture.server.uuid + '/resources'));
  if (resources.current_state !== 'offline') throw Error('Owned fixture is not offline');
  return { offline: true, preserved: true, native: native.map(c => ({ id: c.id, state: c.state })) };
}

export async function run(ctx) {
  if (!ctx.fixture) await ctx.check('canonical-options-and-intent', async () => { await prepare(ctx); return ctx.fixture.intent; });
  const f = ctx.fixture;
  if (!f.install) {
    await ctx.reserve(2048);
    await lock(ctx, 'provision.lock');
    await lock(ctx, 'installer-0.lock');
    // Reconcile before every retry. A server found by request correlation is
    // adopted only after full owner/node/recipe/resource identity validation.
    let server = await reconcile(ctx);
    if (!server) {
      if (f.postAttempted) {
        await ctx.artifact('reconciliation-' + Date.now() + '.json', { request_id: f.intent.request.request_id, found: false, at: new Date().toISOString() });
      }
      f.postAttempted = true; await ctx.own(f); // durable before network ambiguity
      try {
        const result = attrs(await api(ctx, PREFIX + '/install', 'POST', f.intent.request));
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
    if (f.install.recoveredForPresentationOnly) {
      const review = JSON.parse(await readFile(resolve(ctx.output, 'paper-canonical/recovery-review.json')));
      const events = JSON.parse(await readFile(resolve(ctx.output, 'paper-canonical/recovery-docker-events.json')));
      if (review.server.uuid !== f.server.uuid || review.server.externalId !== f.intent.externalId || !review.offline || !review.installerAbsent || f.install.rawExit !== '0' || !f.install.callback?.success || !f.install.removed || !f.install.logsRecovered || !events.some(e => e.Action === 'die' && e.Actor.ID === f.install.installerId && e.Actor.Attributes.exitCode === '0')) throw Error('Recovered fixture proof incomplete');
      await ctx.check('existing-canonical-fixture', async () => ({ ...f.install, reused: true, scope: 'Presentation fixture only; original installer memory readback not claimed' }));
    } else {
      if (f.install.rawExit !== '0' || !f.install.callback?.success || !f.install.memoryValid || !f.install.removed || !f.install.logsFollowed) throw Error('Preserved native installation did not pass; no automatic reinstall');
      await ctx.check('retained-native-install', async () => ({ ...f.install, reused: true }));
    }
  }
  await ctx.check('offline-before-presentation', () => offline(ctx));
  const route = '/api/client/servers/' + f.server.uuid;
  await ctx.check('presentation-properties', async () => {
    let text;
    try { text = await api(ctx, route + '/files/contents?file=%2Fserver.properties', 'GET', undefined, true); }
    catch (error) {
      if (error.status !== 404) throw error;
      await offline(ctx);
      text = '# Validator presentation fixture only; no native install or loaded-world proof\ndifficulty=easy\n';
      f.presentationFixture = { file: '/server.properties', text, nativeInstallProof: false, at: new Date().toISOString() };
      await ctx.own(f);
      await api(ctx, route + '/files/write?file=%2Fserver.properties', 'POST', text, true);
      if (await api(ctx, route + '/files/contents?file=%2Fserver.properties', 'GET', undefined, true) !== text) throw Error('Presentation fixture readback mismatch');
    }
    if (!/^\s*difficulty\s*[=:]/m.test(text)) {
      await offline(ctx);
      const original = text;
      text += '\n# Validator presentation-only property; server has never started\ndifficulty=easy\n';
      f.presentationFixture = { file: '/server.properties', beforeSHA256: hash(original), afterSHA256: hash(text), nativeInstallProof: false, at: new Date().toISOString() };
      await ctx.own(f);
      await api(ctx, route + '/files/write?file=%2Fserver.properties', 'POST', text, true);
      if (await api(ctx, route + '/files/contents?file=%2Fserver.properties', 'GET', undefined, true) !== text) throw Error('Presentation property readback mismatch');
    }
    return { hash: hash(text), createdForPresentation: Boolean(f.presentationFixture), nativeInstallProof: false };
  });
  for (const suffix of ['/quick-setup', '/game-settings?file=%2Fserver.properties']) {
    await ctx.check(suffix.startsWith('/quick') ? 'served-quick-setup' : 'served-game-settings', async () => {
      const response = await api(ctx, route + suffix);
      await ctx.artifact(suffix.startsWith('/quick') ? 'quick-setup.json' : 'game-settings.json', response);
      const body = attrs(response), fields = body.fields?.filter(field => field.key === 'difficulty');
      if (fields?.length !== 1 || fields[0].label !== 'Difficulty for new worlds'
        || !/Existing worlds keep their saved difficulty/.test(fields[0].help ?? '')
        || !/Console/.test(fields[0].help ?? '') || !/run difficulty/i.test(fields[0].help ?? '')
        || !body.help?.some(help => /existing world unchanged/i.test(help.text ?? '') && /Run difficulty/.test(help.text ?? ''))) throw Error('Served Paper difficulty label/help assertion failed');
      return { field: fields[0], help: body.help, scope: 'Served presentation only; no native world difficulty, gameplay, WAN or full parity claim' };
    });
  }
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
  if (flag !== '--run' || !manifest || extra.some(arg => arg !== '--retry')) throw Error('Usage: node paper-canonical-check.mjs --run reviewed-manifest.json [--retry]');
  const config = JSON.parse(await readFile(resolve(manifest), 'utf8'));
  const adapter = resolve(process.argv[1]);
  if (config.games?.length !== 1 || config.games[0].id !== 'paper-canonical' || config.games[0].ownerId < 1
    || config.maxInstallers !== 1 || resolve(config.output) !== resolve('.local/validator-campaign')
    || !(config.policy?.reserveMiB >= 8192) || !(config.policy?.reserveDiskMiB >= 32768) || config.policy.maxParallel !== 1
    || !(config.games[0].peakMiB >= 2048) || !(config.games[0].diskMiB >= 10240)
    || resolve(config.session) !== resolve('tools/runtime/validator/campaign-session.mjs')
    || resolve(config.monitor) !== resolve(config.session) || resolve(config.games[0].adapter) !== adapter) throw Error('Reviewed shared-session canonical manifest required');
  config.games[0].scope = 'Canonical Paper served difficulty presentation only; root review required, no native world difficulty/gameplay/WAN/full parity claim';
  const results = await runQueue(config, { retry: extra.includes('--retry') ? ['paper-canonical'] : [] });
  console.log(JSON.stringify(results.map(({ game, status, code }) => ({ game, status, code }))));
  process.exitCode = results.some(result => result.status !== 'PASS') ? 1 : 0;
}
