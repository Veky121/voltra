#!/usr/bin/env node
import {jc3mpIdentity, recipe as jc3mpRecipe, materializeJC3MPDefaults, jc3mpEnvironment, verifyJC3MPPrior} from './jc3mp-canonical-check.mjs';
import {wurmIdentity, recipe as wurmRecipe, verifyWurmPrior, wurmCanonicalRequest, materializeWurmDefaults, canonicalExposure as wurmExposure} from './wurm-canonical-check.mjs';
import {onsetIdentity, materializeOnsetDefaults, onsetEnvironment, verifyOnsetPrior, onsetPresentation} from './onset-canonical-check.mjs';
import {trackmaniaIdentity, recipe as trackmaniaRecipe, verifyTrackmaniaPrior, canonicalExposure as trackmaniaExposure, trackmaniaSecretUI} from './trackmania-canonical-check.mjs';
import {lacIdentity, recipe as lacRecipe, verifyLACPrior, canonicalExposure as lacExposure} from './lac-canonical-check.mjs';
import {crossplayIdentity, recipe as crossplayRecipe, materializeCrossplayDefaults, crossplayExplicitRequest, verifyCrossplayPrior, verifyCrossplayInstalled, verifyCrossplayExposure, verifyCrossplayAllocation, installerSHA256 as crossplayInstallerSHA} from './crossplay-canonical-check.mjs';
/** Canonical FoF/GTAC/DMP/ReHLDS setup and offline presentation coordinator. Importing never opens a session.
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
import { pnxIdentity, verifyPNXPrior, verifyPNXExposure } from './pnx-canonical-check.mjs';
import { isRisingId, risingIdentity, isRisingBuild, verifyRisingPrior, verifyRisingAllocation, verifyRisingExposure } from './rising-canonical-check.mjs';
import { bedrockVanillaIdentity, materializeBedrockDefaults, bedrockTermsAuthorization, verifyBedrockVanillaGate, verifyBedrockVanillaInstalled, verifyBedrockVanillaExposure, verifyBedrockCacheRetry } from './bedrock-vanilla-canonical-check.mjs';
import { togetherIdentity, verifyTogetherPrior, verifyTogetherExposure, verifyTogetherConfig, verifyTogetherInstalled } from './rimworld-together-canonical-check.mjs';
import { openworldIdentity, verifyOpenWorldPrior, verifyOpenWorldExposure, verifyOpenWorldConfig, verifyOpenWorldInstalled } from './openworld-canonical-check.mjs';
import { clusterioIdentity, verifyClusterioPrior, verifyClusterioExposure, clusterioDefaultRules } from './clusterio-canonical-check.mjs';
import { l4dIdentity, verifyL4DPrior, verifyL4DMetadata, verifyL4DExposure, verifyL4DRefusal, verifyL4DInstalled, verifyL4DSourceEquivalence, l4dIntentBuildAllowed, l4dInstallerScriptAllowed } from './l4d-canonical-check.mjs';
import { nuclearIdentity, nuclearAutomaticRequest, materializeNuclearDefaults, nuclearDeferredRules, verifyNuclearPrior, verifyNuclearInstalled, verifyNuclearExposure, nuclearSecretPresence } from './nuclear-canonical-check.mjs';
import { materializeDefaults } from './canonical-request.mjs';
import { campaign as h, receipt, settings, docker } from './campaign-session.mjs';

const ROOT = resolve('C:/Users/Veky/.t3/worktrees/pteroclone/t3-6837dde7/ptero-go');
const CAMPAIGN_ROOT = resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go');
const BUILDS = new Set(['32aefb21d6016f5f17a8e6437a319ec67d8cde92500fae1b3a6968ba26b0e034', '2163b02c95bb62f8728e37d5ff2f1c4104cd921028badf6c608c2167c5f5e693', '22f1ffaf57e9253c0df41803e8a815ae24fa34a30b71152707529d9c946bfbeb', '8461d22b6667d4158d72a7d96b8462b7ce3856101592e8409e2077266fe1a7a2']);
const RECIPES = Object.freeze({ jc3mp:jc3mpRecipe, wurm:wurmRecipe, onset:'onset/egg-onset.json', trackmania:trackmaniaRecipe, lac:lacRecipe, crossplay:crossplayRecipe, nuclear:'nuclear_option/egg-nuclear-option.json', l4d:'left4dead/egg-left4dead.json', l4d2:'left4dead_2/egg-left4dead_2.json', clusterio:'factorio/clusterio/egg-clusterio.json', rimworld_openworld:'rimworld/open_world/egg-rimworld-open-world.json', rimworld_together:'rimworld/together/egg-rimworld-together.json', bedrock_vanilla:'minecraft/bedrock/bedrock/egg-vanilla-bedrock.json', pnx:'minecraft/bedrock/PowerNukkitX/egg-powernukkitx.json', 'rising-legacy': 'rising_world/legacy/egg-rising-world-legacy.json', veloren: 'veloren/egg-veloren.json', vintagestory: 'vintage_story/egg-vintage-story.json', pocketmine: 'minecraft/bedrock/pocketmine_mp/egg-pocketmine-m-p.json', gomint: 'minecraft/bedrock/gomint/egg-go-mint.json', nukkit: 'minecraft/bedrock/nukkit/egg-nukkit.json', fof: 'fof/egg-fof.json', gtac: 'gta/gtac/egg-grand-theft-auto-connected.json', ksp_dmp: 'ksp/DMP/egg-k-s-p-d-m-p.json', ksp_lmp: 'ksp/LMP/egg-k-s-p--l-m-p.json', rehlds: 'counter_strike/counter_strike_1.6_rehlds/egg-cs 1.6-rehlds.json' });
function spec(ctx) {
  const family = ['clusterio-canonical','clusterio-host-canonical'].includes(ctx.game.id) ? 'clusterio' : isRisingId(ctx.game.id) ? 'rising-legacy' : ctx.game.id.replace(/-canonical$/, '');
  if (!Object.hasOwn(RECIPES, family) || (ctx.game.id !== family + '-canonical' && !isRisingId(ctx.game.id) && !clusterioIdentity(ctx.game.id,ctx.build))) throw Error('Family not allowed');
  const recipe = RECIPES[family], template = hash(recipe).slice(0, 16);
  return { family, recipe, template, name: 'validator-' + ctx.game.id,
    prefix: '/api/client/game-library/templates/' + template, disk: ['jc3mp','wurm','onset'].includes(family)?8192:family==='trackmania'?4096:family==='crossplay'?8192:family==='nuclear'?12288:family==='l4d'?16384:family==='l4d2'?32768:10240, memory: ['wurm','crossplay'].includes(family)?4096:['trackmania','lac','l4d','l4d2'].includes(family)?1536:['nuclear','bedrock_vanilla','clusterio'].includes(family) ? 2048 : 1024 };
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
  // native_acceptance is source evidence metadata absent from the frozen Go struct.
  const ignored = new Set(['settings_documents', 'setup_validation', 'verification', 'detail', 'setup_steps', 'native_acceptance']);
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
function canonicalDefaults(ctx,variables,request) { if(spec(ctx).family==='jc3mp')return materializeJC3MPDefaults(variables,request); if(spec(ctx).family==='wurm')return materializeWurmDefaults(variables,request); if(spec(ctx).family==='onset')return materializeOnsetDefaults(variables,request); if(spec(ctx).family==='crossplay')return materializeCrossplayDefaults(variables,request); if(spec(ctx).family==='nuclear')return materializeNuclearDefaults(variables,request); return spec(ctx).family === 'bedrock_vanilla' ? materializeBedrockDefaults(variables,request) : materializeDefaults(variables,request); }
function validateFamilyDefaults(ctx,variables,environment){return validateDefaults(spec(ctx).family==='nuclear'?nuclearDeferredRules(variables,environment):spec(ctx).family==='clusterio'?clusterioDefaultRules(variables,environment):variables,environment);}
export function validateDefaults(variables, environment) {
  for (const variable of variables) {
    const value = environment[variable.env_variable];
    if (typeof value !== 'string' || value.includes('\0')) throw Error('Invalid canonical variable default');
    let rules = variable.rules.match(/(?:not_)?regex:\/(?:\\.|[^/])*\/|[^|]+/gi) ?? [];
    // Backend splitEggRules skips empty boundary separators.
    if (rules.join('|') !== variable.rules.replace(/^\|+|\|+$/g, '')) throw Error('Malformed canonical variable rules');
    // Match eggs.go eggCanonicalRuleName aliases before applying type/size rules.
    rules = rules.map(rule => rule.replace(/^[^:]+/, name => {const key=name.trim().toLowerCase();return key==='int'?'integer':key==='bool'?'boolean':key;}));
    if (!value && rules.includes('nullable')) continue;
    for (const rule of rules) {
      if (rule === 'string' || rule === 'nullable') continue;
      if (rule.startsWith('different:environment.')) {
        const other = rule.slice('different:environment.'.length);
        if (/^[A-Z][A-Z0-9_]*$/.test(other) && Object.hasOwn(environment, other)
          && typeof environment[other] === 'string' && value !== environment[other]) continue;
      }
      if (rule === 'url') {
        try {
          const url = new URL(value);
          if (value === value.trim() && /^https?:\/\//.test(value) && url.hostname && !url.username && !url.password) continue;
        } catch { /* Keep malformed defaults refused. */ }
      }
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
  request = canonicalDefaults(ctx, h.profileFromRuntime(spec(ctx).recipe, receipt).egg.variables, request);
  // Go encoding/json sorts map keys. This is the exact automatic-port digest.
  const value = { template: spec(ctx).template, name: request.name, memory: request.memory, disk: request.disk,
    image: request.image, environment: request.environment, primary: 0, additional: [], automatic_ports: true, node_id: request.node_id };
  if(['wurm','crossplay'].includes(spec(ctx).family)){value.primary=request.allocation_id;value.additional=request.allocation_additional;delete value.automatic_ports;delete value.node_id;}
  // Go JSON HTML escaping also applies to string values.
  return hash(goJSON(sorted(value)));
}
async function identity(ctx, server) {
  const intent = ctx.fixture.intent, r = intent.request;
  if (!Number.isSafeInteger(server.id) || !uuid(server.uuid) || server.name !== spec(ctx).name
    || Number(server.user) !== intent.ownerId || Number(server.node) !== r.node_id
    || server.external_id !== intent.externalId || Number(server.limits?.memory) !== (['jc3mp', 'wurm', 'onset', 'ksp_dmp', 'ksp_lmp', 'nukkit', 'pocketmine', 'gomint', 'vintagestory', 'veloren', 'rising-legacy', 'pnx'].includes(spec(ctx).family) && ctx.fixture.diagnosticMemory?.confirmed === true ? 0 : spec(ctx).memory)
    || Number(server.limits?.disk) !== spec(ctx).disk) throw Error('Canonical fixture identity/resource mismatch');
  const egg = attrs(await api(ctx, '/api/admin/eggs/' + server.egg));
  const catalog = JSON.parse(await readFile(resolve(receipt.snapshot, 'internal/panel/game_library/upstream/catalog.json'), 'utf8'));
  const entry = catalog.entries.find(e => e.path === spec(ctx).recipe);
  const profile = h.profileFromRuntime(spec(ctx).recipe, receipt);
  if (!entry || profile.upstream_sha256 !== entry.sha256 || egg.uuid !== canonicalEggUUID(ctx, profile)
    || (['l4d','l4d2'].includes(spec(ctx).family) ? !l4dInstallerScriptAllowed(ctx,profile.egg.scripts.installation.script,egg.script_install) : egg.script_install !== profile.egg.scripts.installation.script)) {
    throw Error('Canonical egg UUID differs from active source recipe');
  }
  if (server.container?.image !== r.image || Object.keys(server.java_config ?? {}).length) throw Error('Canonical runtime image/config mismatch');
  if (ctx.fixture.server && (server.id !== ctx.fixture.server.id || server.uuid !== ctx.fixture.server.uuid)) throw Error('Preserved server identity changed');
  return server;
}
export async function canonicalServerInventory(get) {
  const rows=[],ids=new Set();let total,pages;
  for(let page=1;page<=(pages??1);page++){
    const response=await get('/api/application/servers?per_page=100&page='+page),p=response.meta?.pagination;
    if(!p||!Number.isInteger(p.total)||p.total<0||!Number.isInteger(p.total_pages)||p.total_pages<1||p.total_pages>1000||p.current_page!==page||!Array.isArray(response.data))throw Error('Invalid canonical inventory pagination');
    if(page===1){total=p.total;pages=p.total_pages;}else if(p.total!==total||p.total_pages!==pages)throw Error('Canonical inventory changed during reconciliation');
    for(const item of response.data){const s=attrs(item);if(!Number.isInteger(s.id)||ids.has(s.id))throw Error('Duplicate/invalid canonical inventory server');ids.add(s.id);rows.push(s);}
  }
  if(rows.length!==total)throw Error('Incomplete canonical inventory');return rows;
}
async function reconcile(ctx) {
  const rows = await canonicalServerInventory(path=>api(ctx,path));
  const prefix = `catalog:${ctx.fixture.intent.ownerId}:${ctx.fixture.intent.request.request_id}:`;
  const matches = rows.filter(s => String(s.external_id ?? '').startsWith(prefix));
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
  if(spec(ctx).family==='jc3mp'&&(!jc3mpIdentity(ctx.game.id,ctx.build)||ctx.game.nodeId!==1||ctx.game.ownerId!==1||ctx.game.canonicalBootRequired!==true))throw Error('JC3MP exact22 owned canonical diagnostic required');
  if(spec(ctx).family==='wurm'&&(!wurmIdentity(ctx.game.id,ctx.build)||ctx.game.nodeId!==1||ctx.game.ownerId!==1||ctx.game.canonicalBootRequired!==true))throw Error('Wurm exact22 isolated canonical bootstrap required');
  if(spec(ctx).family==='onset'&&(!onsetIdentity(ctx.game.id,ctx.build)||ctx.game.nodeId!==1||ctx.game.canonicalBootRequired!==true))throw Error('Onset exact22 isolated canonical bootstrap required');
  if(spec(ctx).family==='trackmania'&&(!trackmaniaIdentity(ctx.game.id,ctx.build)||ctx.game.nodeId!==1||ctx.game.ownerId!==1||ctx.game.canonicalBootRequired!==true))throw Error('Trackmania exact22 isolated canonical defaults/bootstrap required');
  if(spec(ctx).family==='lac'&&(!lacIdentity(ctx.game.id,ctx.build)||ctx.game.nodeId!==1||ctx.game.canonicalBootRequired!==true))throw Error('LAC exact22 isolated canonical defaults/bootstrap required');

  if(spec(ctx).family==='crossplay'&&(!crossplayIdentity(ctx.game.id,ctx.build)||ctx.game.nodeId!==1||ctx.game.canonicalBootRequired!==false||ctx.game.crossplayAllocations?.length!==3))throw Error('Crossplay exact22 explicit isolated ports and install-only canonical scope required');
  if(spec(ctx).family==='nuclear'&&(!nuclearIdentity(ctx.game.id,ctx.build)||ctx.game.nodeId===202||ctx.game.canonicalBootRequired!==true||ctx.game.queryPortChoice!=='automatic-additional'))throw Error('Nuclear exact22 isolated declared automatic second allocation required');
  if (['l4d','l4d2'].includes(spec(ctx).family)&&(!l4dIdentity(ctx.game.id,ctx.build)||ctx.game.nodeId===202||ctx.game.canonicalBootRequired!==true))throw Error('L4D exact21 isolated LAN canonical bootstrap required');
  if (spec(ctx).family === 'clusterio' && (!clusterioIdentity(ctx.game.id,ctx.build)||ctx.game.nodeId===202||ctx.game.canonicalBootRequired!==true||ctx.game.canonicalRole!=='controller'))throw Error('Clusterio exact21 default controller bootstrap required; host graph separate');
  if (spec(ctx).family === 'rimworld_openworld' && (!openworldIdentity(ctx.game.id,ctx.build) || ctx.game.nodeId===202 || ctx.game.canonicalBootRequired!==true)) throw Error('OpenWorld exact21 isolated canonical bootstrap required');
  if (spec(ctx).family === 'rimworld_together' && (!togetherIdentity(ctx.game.id,ctx.build) || ctx.game.nodeId===202 || ctx.game.canonicalBootRequired!==true)) throw Error('Together exact21 isolated canonical bootstrap required');
  if (spec(ctx).family === 'pnx' && (!pnxIdentity(ctx.game.id,ctx.build) || ctx.game.nodeId === 202 || ctx.game.canonicalBootRequired !== true || ctx.game.canonicalBootMemoryRelease !== true)) throw Error('PNX reviewed candidate20 and isolated bootstrap required');
  if (spec(ctx).family === 'rising-legacy' && (!risingIdentity(ctx.game.id, ctx.build) || ctx.game.nodeId === 202 || ctx.game.canonicalBootRequired !== true || ctx.game.canonicalBootMemoryRelease !== true)) throw Error('Reviewed Rising candidate, isolated node and canonical bootstrap required');
  if (ctx.build === '32aefb21d6016f5f17a8e6437a319ec67d8cde92500fae1b3a6968ba26b0e034' && spec(ctx).family !== 'veloren') throw Error('Candidate16 enabled only for Veloren canonical setup');
  if (ctx.build === '2163b02c95bb62f8728e37d5ff2f1c4104cd921028badf6c608c2167c5f5e693' && !['pocketmine', 'gomint', 'vintagestory'].includes(spec(ctx).family)) throw Error('Candidate13 selected only for new Bedrock canonical families');
  if (resolve(settings.campaignRoot) !== CAMPAIGN_ROOT) throw Error('Campaign root mismatch');
  if (!Number.isFinite(ctx.game.installPeakMiB) || !(ctx.game.installerDefaultMiB > 0)
    || ctx.game.installPeakMiB < Math.max(spec(ctx).memory, ctx.game.installerDefaultMiB)) throw Error('Reserve reviewed Wings installer peak before creation');
  if (!h || receipt?.binary_sha256 !== ctx.build || settings.build !== ctx.build) throw Error('Verified campaign session/build required');
  if (!(BUILDS.has(ctx.build) || jc3mpIdentity(ctx.game.id,ctx.build) || wurmIdentity(ctx.game.id,ctx.build) || onsetIdentity(ctx.game.id,ctx.build) || trackmaniaIdentity(ctx.game.id,ctx.build) || lacIdentity(ctx.game.id,ctx.build) || crossplayIdentity(ctx.game.id,ctx.build) || bedrockVanillaIdentity(ctx.game.id,ctx.build) || togetherIdentity(ctx.game.id,ctx.build) || openworldIdentity(ctx.game.id,ctx.build) || clusterioIdentity(ctx.game.id,ctx.build) || l4dIdentity(ctx.game.id,ctx.build) || nuclearIdentity(ctx.game.id,ctx.build) || pnxIdentity(ctx.game.id,ctx.build) || spec(ctx).family === 'rising-legacy' && isRisingBuild(ctx.build)) || settings.maxInstallers < 1 || settings.maxInstallers > 4
    || resolve(ctx.output) !== resolve(ROOT, '.local/validator-campaign')) throw Error('Use the shared campaign output and exclusive installer policy');
  if (!Number.isSafeInteger(ctx.game.ownerId) || ctx.game.ownerId < 1) throw Error('Reviewed ownerId required');
  const gate = ctx.game.reconciliation ?? settings.reconciliation;
  if (gate?.id !== 'mainvalidator-20261103-source-canonical' || !gate.path || !/^[a-f0-9]{64}$/.test(gate.sha256 ?? '')) throw Error('Reviewed exact source evidence gate required');
  const bytes = await readFile(resolve(gate.path), 'utf8');
  if (hash(bytes) !== gate.sha256) throw Error('Source gate hash changed');
  const rows = JSON.parse(bytes).games?.filter(row => row.game === spec(ctx).family);
  if (rows?.length !== 1) throw Error('Exact family gate missing');
  const evidence = {};
  for (const kind of ['native', 'retention']) {
    const pin = rows[0][kind];
    if (!pin?.path || !/^[a-f0-9]{64}$/.test(pin.sha256 ?? '')) throw Error('Reviewed '+kind+' report pin required');
    const raw = await readFile(resolve(pin.path), 'utf8'), report = JSON.parse(raw);
    if(spec(ctx).family==='crossplay'){verifyCrossplayPrior(report,raw);if(rows[0].frozen?.nativeCurrentPending!==true||rows[0].frozen?.historicalSourceEquivalent!==false||rows[0].frozen.scriptSHA256!==crossplayInstallerSHA)throw Error('Crossplay current pending source gate differs');evidence[kind]=pin;continue;}
    if(spec(ctx).family==='trackmania'){verifyTrackmaniaPrior(ctx,report,raw,pin,rows[0].frozen);evidence[kind]=pin;continue;}
    if(spec(ctx).family==='wurm'){verifyWurmPrior(ctx,report,raw,pin,rows[0].frozen);evidence[kind]=pin;continue;}
    if(spec(ctx).family==='jc3mp'){verifyJC3MPPrior(ctx,report,raw,pin,rows[0].frozen);evidence[kind]=pin;continue;}
    if(spec(ctx).family==='onset'){verifyOnsetPrior(ctx,report,raw,pin,rows[0].frozen);evidence[kind]=pin;continue;}
    if(spec(ctx).family==='lac'){verifyLACPrior(ctx,report,raw,pin,rows[0].frozen);evidence[kind]=pin;continue;}
    if(spec(ctx).family==='nuclear'){verifyNuclearPrior(ctx,report,raw,pin,rows[0].frozen);evidence[kind]=pin;continue;}
    if (['l4d','l4d2'].includes(spec(ctx).family)) { verifyL4DPrior(ctx,report,raw,pin,rows[0].frozen); if(rows[0].sourceEquivalence&&!ctx.l4dSourceEquivalence)await ctx.artifact('l4d21-to22-source-equivalence.json',await verifyL4DSourceEquivalence(ctx,rows[0].sourceEquivalence)); evidence[kind]=pin; continue; }
    if (spec(ctx).family === 'clusterio') { verifyClusterioPrior(ctx,report,raw,pin,rows[0].frozen); evidence[kind]=pin; continue; }
    if (spec(ctx).family === 'rimworld_openworld') { verifyOpenWorldPrior(ctx,report,raw,pin,rows[0].frozen); evidence[kind]=pin; continue; }
    if (spec(ctx).family === 'rimworld_together') { verifyTogetherPrior(ctx,report,raw,pin,rows[0].frozen); evidence[kind]=pin; continue; }
    if (spec(ctx).family === 'bedrock_vanilla') { verifyBedrockVanillaGate(ctx,report,raw,pin,rows[0].frozen,kind); evidence[kind]=pin; continue; }
    if (spec(ctx).family === 'pnx') { verifyPNXPrior(ctx,report,raw,pin,rows[0].frozen); evidence[kind]=pin; continue; }
    if (spec(ctx).family === 'rising-legacy') {
      verifyRisingPrior(ctx, report, raw, pin, rows[0].frozen); evidence[kind] = pin; continue;
    }
    if (spec(ctx).family === 'veloren') {
      const { verifyVelorenLegacy } = await import('./veloren-canonical-check.mjs');
      verifyVelorenLegacy(ctx, report, pin, rows[0].frozen); evidence[kind]=pin; continue;
    }
    if (hash(raw) !== pin.sha256 || report.status !== 'PASS' || report.game !== spec(ctx).family) throw Error('Exact '+kind+' PASS changed');
    if (['ksp_dmp', 'ksp_lmp', 'rehlds', 'nukkit', 'pocketmine', 'gomint'].includes(spec(ctx).family)) {
      const family = spec(ctx).family, profile = h.profileFromRuntime(spec(ctx).recipe, receipt);
      if (resolve(pin.path) !== resolve(CAMPAIGN_ROOT, 'artifacts/game-parity-20261029', 'validator-20261103-' + family, kind === 'native' ? 'lifecycle.json' : 'report.json')
        || report.fixture?.recipe !== spec(ctx).recipe || report.fixture.install?.canonicalScriptSha256 !== hash(profile.egg.scripts.installation.script)
        || report.fixture.install.rawExit !== '0' || report.fixture.install.callback?.success !== true
        || !Array.isArray(report.checks) || report.checks.some(check => check.status !== 'PASS')) throw Error('Exact native recipe/installer evidence differs');
      if (!['pocketmine', 'gomint'].includes(family) && ctx.build !== '8461d22b6667d4158d72a7d96b8462b7ce3856101592e8409e2077266fe1a7a2') throw Error('DMP/LMP/ReHLDS canonical setup requires reviewed candidate12');
      const required = kind === 'native' ? ['start-ready', 'file-api', 'settings', 'saved', 'reload'] : ['canonical-reinstall', 'reinstall-retained-bytes', 'reinstall-native-reload'];
      if (required.some(name => report.checks.filter(check => check.name === name).length !== 1)) throw Error('Native evidence shape changed');
      if (kind === 'retention') {
        const retained = report.checks.find(check => check.name === 'reinstall-retained-bytes').evidence;
        if (retained?.identical !== true || retained.ownershipAndModes !== true || !(retained.files > 0)) throw Error('Native retention evidence changed');
      }
      const stop = kind === 'native' ? report.checks.find(check => check.name === 'saved').evidence
        : (() => { const e = report.checks.find(check => check.name === 'reinstall-native-reload').evidence; return e.stop ?? e.nativeStop; })();
      if (stop?.engineExitProven !== true || stop.engineNumericExit !== 0) throw Error('Historical native clean exit changed');
      if (hash(JSON.stringify(sorted(profile))) !== rows[0].frozen?.profileSHA256
        || hash(profile.egg.scripts.installation.script) !== rows[0].frozen?.scriptSHA256) throw Error('Reviewed frozen recipe changed');
    }
    if (spec(ctx).family === 'nukkit') {
      const { verifyNukkitPrior } = await import('./nukkit-canonical-check.mjs');
      verifyNukkitPrior(report, kind);
    }
    if (['pocketmine', 'gomint'].includes(spec(ctx).family)) {
      const { verifyBedrockPrior } = await import('./bedrock-canonical-check.mjs');
      if (ctx.build !== '2163b02c95bb62f8728e37d5ff2f1c4104cd921028badf6c608c2167c5f5e693') throw Error('Bedrock canonical setup requires candidate13');
      verifyBedrockPrior(report, kind, spec(ctx).family);
    }
    if (spec(ctx).family === 'vintagestory') {
      const { verifyVintagePrior } = await import('./vintagestory-canonical-check.mjs');
      verifyVintagePrior(ctx, report, kind, pin, rows[0].frozen);
    }
    evidence[kind] = pin;
  }
  await ctx.artifact('prior-native-retention-pins.json', { reused: true, evidence, scope: spec(ctx).family==='wurm'?'Historical Wurm only; normalized frozen22 pins match, fresh native/typed/reinstall pending':spec(ctx).family==='onset'?'Historical Onset SQL/plugin/retention only; current native pending, historicalSourceEquivalent=false':spec(ctx).family==='trackmania'?'Historical LAN only; current22 native and retention pending':spec(ctx).family==='lac'?'Historical LAC research only; current22 native helper/settings/retention acceptance pending':spec(ctx).family==='crossplay'?'Historical Crossplay research only; current install metadata checked separately; native world/ports/settings pending':spec(ctx).family==='nuclear'?'Historical Nuclear research only; fresh publication and current native/reinstall acceptance pending':['l4d','l4d2'].includes(spec(ctx).family) ? 'Historical native LAN research only; current21 helpers require fresh native lifecycle/retention' : spec(ctx).family === 'clusterio' ? 'Historical both-role research only; canonical21 default controller, current native and second authenticated host graph pending' : spec(ctx).family === 'rimworld_openworld' ? 'Historical OpenWorld research only; current21 helpers require fresh native and retention' : spec(ctx).family === 'rimworld_together' ? 'Historical publisher research only; current21 helper native and retention acceptance pending' : spec(ctx).family === 'bedrock_vanilla' ? 'Historical native19 PASS and known retention19 FAIL only; receipt-stability helper changed, fresh canonical21/native21/retention21 required' : spec(ctx).family === 'pnx' ? 'Historical PNX protocol/retention research only; current helper native acceptance pending' : spec(ctx).family === 'rising-legacy' ? 'Historical Java publisher evidence only; wave63 helpers changed; current native settings/stop/reinstall retention pending' : 'Prior native and reinstall results only; canonical setup checked separately' });
  const account = attrs(await api(ctx, '/api/client/account'));
  if (Number(account.id) !== ctx.game.ownerId || account.root_admin !== true) throw Error('Canonical POST actor differs from reviewed admin owner');
  if (ctx.fixture) {
    const f = ctx.fixture;
    if (f.name !== spec(ctx).name || f.recipe !== spec(ctx).recipe || f.template !== spec(ctx).template || (['l4d','l4d2'].includes(spec(ctx).family)?!l4dIntentBuildAllowed(ctx):f.intent?.build !== ctx.build)
      || f.intent.ownerId !== ctx.game.ownerId || !uuid(f.intent.request?.request_id)
      || f.intent.externalId !== `catalog:${f.intent.ownerId}:${f.intent.request.request_id}:${requestDigest(ctx, f.intent.request)}`) throw Error('Preserved intent identity mismatch');
    const request = f.intent.request, profile = h.profileFromRuntime(spec(ctx).recipe, receipt);
    if (request.name !== spec(ctx).name || request.memory !== spec(ctx).memory || request.disk !== spec(ctx).disk || request.automatic_ports !== (['wurm','crossplay'].includes(spec(ctx).family)?false:true)
      || !Number.isSafeInteger(request.node_id) || request.node_id < 1 || !Object.values(profile.egg.docker_images).includes(request.image)
      || f.intent.scriptHash !== hash(profile.egg.scripts.installation.script)) throw Error('Preserved canonical request changed');
    validateFamilyDefaults(ctx,profile.egg.variables,canonicalDefaults(ctx,profile.egg.variables,request).environment);
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
  const eligible = options.nodes.filter(n => n.setup_available === true && Number(n.available_memory) >= spec(ctx).memory && Number(n.available_disk) >= spec(ctx).disk);
  const node = ctx.game.nodeId ? eligible.find(n => Number(n.id) === ctx.game.nodeId) : eligible.length === 1 ? eligible[0] : null;
  if (['rising-legacy','pnx'].includes(spec(ctx).family) && Number(node?.id) === 202) throw Error('Protected historical node refused');
  if (!node) throw Error('Select an eligible reviewed nodeId');
  await ctx.artifact('settings-declarations.json', { recipe: spec(ctx).recipe, declaredDocuments: profile.settings_documents ?? [], scope: 'Frozen canonical declaration; served document checked after installation' });
  const image = spec(ctx).family === 'veloren' ? profile.egg.docker_images['Ubuntu 24.04'] : ['pocketmine', 'gomint', 'pnx'].includes(spec(ctx).family) ? profile.egg.docker_images['Pinned native Debian runtime'] : ctx.game.image ?? options.images[0]?.value;
  if (['pocketmine', 'gomint', 'veloren', 'pnx'].includes(spec(ctx).family) && ctx.game.image && ctx.game.image !== image) throw Error('Reviewed native x64 image required');
  if (!options.images.some(i => i.value === image) || !Object.values(profile.egg.docker_images).includes(image)) throw Error('Runtime image is not canonical');
  const environment = Object.fromEntries(options.variables.map(v => {
    if (!v.env_variable || typeof v.rules !== 'string' || v.default_value == null) throw Error('Incomplete variable metadata');
    return [v.env_variable, String(v.default_value)];
  }));
  if (JSON.stringify(options.variables.map(v => [v.env_variable, v.default_value, v.rules])) !== JSON.stringify(profile.egg.variables.map(v => [v.env_variable, v.default_value, v.rules]))) throw Error('Served variables differ from active family recipe');
  if(['l4d','l4d2'].includes(spec(ctx).family))verifyL4DMetadata(options.variables,profile.egg.variables);
  if (options.agreements?.length && spec(ctx).family !== 'bedrock_vanilla') throw Error('Unreviewed publisher agreement');
  if (spec(ctx).family === 'bedrock_vanilla') {
    // game_templates.go omits agreements when the frozen profile has none.
    // BDS binds its explicit EULA acknowledgement through the startup variable.
    const expected=profile.agreements ?? [], actual=options.agreements ?? [];
    const terms=profile.egg.variables.filter(v=>v.env_variable==='BEDROCK_TERMS_ACCEPTED');
    const served=options.variables.filter(v=>v.env_variable==='BEDROCK_TERMS_ACCEPTED');
    if (!Array.isArray(actual) || JSON.stringify(sorted(actual))!==JSON.stringify(sorted(expected))
      || expected.some(a=>a.environment!=='BEDROCK_TERMS_ACCEPTED'||a.accept_value!=='true')
      || terms.length!==1 || served.length!==1 || terms[0].default_value!=='false'
      || terms[0].rules!=='required|string|in:true,false'
      || !terms[0].description.includes('https://www.minecraft.net/eula')
      || !terms[0].description.includes('https://www.minecraft.net/usage-guidelines')
      || ['name','description','default_value','rules','user_viewable','user_editable','field_type'].some(key=>served[0][key]!==terms[0][key])) throw Error('BDS agreement metadata differs');
    environment.BEDROCK_TERMS_ACCEPTED='true';
    await ctx.artifact('bedrock-terms-authorization.json',bedrockTermsAuthorization());
  }
  if(spec(ctx).family==='jc3mp')Object.assign(environment,jc3mpEnvironment(profile));
  if(spec(ctx).family==='onset')Object.assign(environment,onsetEnvironment(profile));
  if(spec(ctx).family==='nuclear')Object.assign(environment,nuclearAutomaticRequest(profile,Number(node.id)).environment);
  const crossplayRequest=spec(ctx).family==='crossplay'?await crossplayExplicitRequest(ctx,profile,Number(node.id)):null;
  if(crossplayRequest)Object.assign(environment,crossplayRequest.environment);
  let wurmRequest=null;
  if(spec(ctx).family==='wurm'){const allocations=[];for(let page=1;page<=100;page++){const response=await api(ctx,'/api/application/nodes/'+node.id+'/allocations?per_page=100&page='+page);allocations.push(...response.data.map(x=>({...attrs(x),node_id:Number(node.id)})));const pages=Number(response.meta?.pagination?.total_pages??1);if(!Number.isInteger(pages)||pages>100)throw Error('Wurm allocation pagination unbounded');if(page>=pages)break;}const primary=allocations.find(a=>a.id===ctx.game.wurmAllocations?.primary),query=allocations.find(a=>a.id===ctx.game.wurmAllocations?.query);wurmRequest=wurmCanonicalRequest(profile,{nodeId:Number(node.id),primary,query});Object.assign(environment,wurmRequest.environment);}
  validateFamilyDefaults(ctx,options.variables,environment);
  // Defaults and constraints are recorded verbatim; the canonical endpoint performs
  // authoritative variable validation before any allocation or server mutation.
  const request = wurmRequest??crossplayRequest??(spec(ctx).family==='nuclear'?nuclearAutomaticRequest(profile,Number(node.id)):{ request_id: randomUUID(), name: spec(ctx).name, memory: spec(ctx).memory, disk: spec(ctx).disk, image,
    environment, automatic_ports: true, node_id: Number(node.id) });
  if(spec(ctx).family==='nuclear')await ctx.artifact('nuclear-explicit-choices.json',{queryPortChoice:'declared auto_allocate additional role; resolved owned port checked before bootstrap',originalQueryDefault:'7777',testPasswordChosen:true,originalPasswordDefaultOmitted:true,autoUpdateDefault:'1',lanOrUnlistedClaim:false});
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

async function offline(ctx, allowFailedInstaller = false) {
  if (!ctx.fixture?.server) {
    if (ctx.fixture?.postAttempted) throw Error('Unresolved POST; cannot prove offline, retain locks');
    return { offline: true, noServerRequested: true, preserved: true };
  }
  await identity(ctx, attrs(await api(ctx, '/api/application/servers/' + ctx.fixture.server.id)));
  const native = await containers(ctx);
  if (native.some(c => c.state.Running || c.name.endsWith('_installer'))) throw Error('Fixture or installer active; preserve resources and locks for root');
  if (!ctx.fixture.install?.callback?.success) {
    const install = ctx.fixture.install;
    if (allowFailedInstaller && install?.removed && /^\d+$/.test(install.rawExit ?? '') && install.logsFollowed && install.callback)
      return { offline: true, preserved: true, failedInstallation: true, native: native.map(c => ({ id: c.id, state: c.state })), scope: 'Raw installer outcome observed; no client resource request after failed callback' };
    throw Error('Successful callback not proved; preserve fixture and locks without client resource request');
  }
  const resources = attrs(await api(ctx, '/api/client/servers/' + ctx.fixture.server.uuid + '/resources'));
  if (resources.current_state !== 'offline') throw Error('Owned fixture is not offline');
  return { offline: true, preserved: true, native: native.map(c => ({ id: c.id, state: c.state })) };
}

export async function run(ctx) {
  if (!ctx.fixture) await ctx.check('canonical-options-and-intent', async () => { await prepare(ctx); return ctx.fixture.intent; });
  let f = ctx.fixture;
  if (f.install && f.install.rawExit !== '0' && spec(ctx).family === 'bedrock_vanilla' && ctx.game.bedrockFailedInstallCacheRetry) {
    await offline(ctx);
    await identity(ctx,attrs(await api(ctx,'/api/application/servers/'+f.server.id)));
    if ((await containers(ctx)).some(c=>c.name==='/'+f.server.uuid+'_installer')) throw Error('Prior BDS installer still exists');
    const proof=await ctx.check('reviewed-public-cache-retry',()=>verifyBedrockCacheRetry(ctx));
    await ctx.artifact('first-canonical-install-failure.json',f.install);
    await ctx.reserve(Math.max(spec(ctx).memory,ctx.game.installPeakMiB));
    await lock(ctx,'provision.lock');
    let acquired=false;
    for(let slot=0;slot<settings.maxInstallers;slot++) { try { await lock(ctx,'installer-'+slot+'.lock');acquired=true;break; } catch(error) { if(error.code!=='EEXIST')throw error; } }
    if(!acquired)throw Error('All reviewed installer slots occupied');
    f.bedrockCacheRetry={proof,originalFailure:f.install,at:new Date().toISOString(),attempted:true};
    await ctx.own(f); // durable before ambiguous API response; never repeat blindly
    await api(ctx,'/api/application/servers/'+f.server.id+'/reinstall','POST');
    await ctx.check('canonical-cache-native-reinstall',()=>observeInstaller(ctx));
    f=ctx.fixture;
  }
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
        const result = attrs(await api(ctx, spec(ctx).prefix + '/install', 'POST', canonicalDefaults(ctx, h.profileFromRuntime(spec(ctx).recipe, receipt).egg.variables, f.intent.request)));
        f.returnedIdentifier = result.identifier; await ctx.own(f);
      } catch (error) {
        f.postError = error.message;
        f.postFailure = { status: error.status ?? null, message: error.message, at: new Date().toISOString(), request_id: f.intent.request.request_id, outcome: 'Unresolved until exact request reconciliation' };
        await ctx.own(f);
        await ctx.artifact('canonical-post-error-' + Date.now() + '.json', f.postFailure);
        server = await reconcile(ctx);
        if (!server) throw Error('Canonical POST failed (' + (error.status ?? 'unknown status') + '): ' + error.message + '; exact reconciliation found no server at this observation. Preserve intent and failure receipt; root reviews before retry with the same request_id');
      }
      server ??= await reconcile(ctx);
      if (!server || (f.returnedIdentifier && server.identifier !== f.returnedIdentifier)) throw Error('POST result did not resolve to exact correlated server');
    }
    if(ctx.game.recoverUnobservedInstall===true){
      const current=ctx.fixture;
      if(current.install||current.reinstallRootRecovery||current.postRecovery?.noInstallerObservation!==true||current.postRecovery.server?.uuid!==current.server?.uuid)throw Error('Exact unobserved-install recovery required');
      await identity(ctx,attrs(await api(ctx,'/api/application/servers/'+current.server.id)));
      if(attrs(await api(ctx,'/api/client/servers/'+current.server.uuid+'/resources')).current_state!=='offline')throw Error('Recovery fixture must remain offline');
      current.reinstallRootRecovery={at:new Date().toISOString(),reason:'Original completed POST installation was not observed after pagination failure; no cold-install PASS claimed',uuid:current.server.uuid};await ctx.own(current);
      await api(ctx,'/api/application/servers/'+current.server.id+'/reinstall','POST',{});
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
    if (spec(ctx).family === 'rising-legacy') verifyRisingAllocation(allocations);
    if (spec(ctx).family === 'pnx' && (allocations.length!==1 || allocations[0].is_default!==true)) throw Error('PNX exact single canonical allocation required');
    f.ports = allocations.map(a => a.port); f.allocation = allocations.find(a => a.is_default);
    if(spec(ctx).family==='crossplay'){const served=attrs(await api(ctx,'/api/application/servers/'+f.server.id));f.ports=verifyCrossplayAllocation(ctx,allocations,served.container.environment);}
    if (!f.allocation) throw Error('Missing default allocation after callback');
    await ctx.own(f);
    return { allocations, resources: attrs(await api(ctx, '/api/client/servers/' + f.server.uuid + '/resources')) };
  });
  if (spec(ctx).family === 'bedrock_vanilla') await ctx.check('bedrock-vanilla-current-installed-source',()=>verifyBedrockVanillaInstalled(ctx));
  if (['pocketmine', 'gomint'].includes(spec(ctx).family)) {
    const { verifyBedrockInstalled } = await import('./bedrock-canonical-check.mjs');
    await ctx.check('bedrock-current-installed-source', () => verifyBedrockInstalled(ctx));
  }
  if (ctx.game.canonicalBootRequired && !ctx.fixture.canonicalBootstrap?.complete) {
    const { runCanonicalBoot } = await import('./source-canonical-boot.mjs');
    await ctx.check('canonical-first-boot', () => runCanonicalBoot(ctx));
    f = ctx.fixture;
  }
  await ctx.check('offline-before-presentation', () => offline(ctx));
  if(spec(ctx).family==='wurm'){await ctx.check('served-startup-files',()=>wurmExposure(ctx,{read:path=>api(ctx,'/api/client/servers/'+f.server.uuid+'/files/contents?file='+encodeURIComponent(path),'GET',undefined,true),api:(method,path,body)=>api(ctx,path,method,body)}));await ctx.check('preserved-offline',()=>offline(ctx));return;}
  if(spec(ctx).family==='onset'){await onsetPresentation(ctx);await ctx.check('preserved-offline',()=>offline(ctx));return;}
  if(spec(ctx).family==='crossplay')await ctx.check('crossplay-installed-source',()=>verifyCrossplayInstalled({...ctx,game:{...ctx.game,family:'crossplay',recipe:crossplayRecipe,serverUUID:f.server.uuid}},{read:path=>api(ctx,'/api/client/servers/'+f.server.uuid+'/files/contents?file='+encodeURIComponent(path),'GET',undefined,true)}));
  if(spec(ctx).family==='rimworld_openworld') await ctx.check('openworld-installed-source',()=>verifyOpenWorldInstalled(ctx));
  if(spec(ctx).family==='rimworld_together') await ctx.check('together-installed-source',()=>verifyTogetherInstalled(ctx));
  if (spec(ctx).family === 'nukkit') await ctx.check('nukkit-current-installed-source', async () => {
    const { verifyNukkitInstalled } = await import('./nukkit-canonical-check.mjs');
    return verifyNukkitInstalled(ctx);
  });
  const route = '/api/client/servers/' + f.server.uuid;
  const family = spec(ctx).family;
  const file = { crossplay:'/server.properties', nuclear:'/DedicatedServerConfig.json', l4d:'/left4dead/cfg/server.cfg', l4d2:'/left4dead2/cfg/server.cfg', clusterio:'/config-controller.json', rimworld_openworld:'/Data/Config.json', rimworld_together:'/Configs/ServerConfig.json', bedrock_vanilla:'/server.properties', pnx:'/pnx.yml', 'rising-legacy': '/server.properties', veloren: '/userdata/server/server_config/settings.ron', vintagestory: '/data/serverconfig.json', pocketmine: '/server.properties', gomint: '/server.yml', nukkit: '/server.properties', fof: '/fof/cfg/server.cfg', gtac: '/gtac/server.xml', ksp_dmp: '/Config/Settings.txt', ksp_lmp: '/LMPServer/Config/GeneralSettings.xml', rehlds: '/cstrike/server.cfg' }[family];
  if (family === 'rehlds') {
    await ctx.check('served-settings-authority-boundary', async () => {
      const inventory = attrs(await api(ctx, route + '/game-settings'));
      await ctx.artifact('settings-inventory.json', inventory);
      if (!Array.isArray(inventory.documents) || inventory.documents.length || !Array.isArray(inventory.fields) || inventory.fields.length || inventory.file !== '') throw Error('ReHLDS unexpectedly advertises typed gameplay authority');
      const response = await api(ctx, route + '/files/list?directory=' + encodeURIComponent('/cstrike'));
      if (!Array.isArray(response.data) || !response.data.some(row => attrs(row).name === 'server.cfg')) throw Error('Installed ReHLDS operator files absent');
      await ctx.artifact('operator-files.json', response);
      return { inventory, scope: 'No typed gameplay documents advertised; startup controls and operator files only' };
    });
  }
  if(family==='trackmania'){await ctx.check('served-startup-files',()=>trackmaniaExposure(ctx,{read:path=>api(ctx,route+'/files/contents?file='+encodeURIComponent(path),'GET',undefined,true),api:(method,path,body)=>api(ctx,path,method,body)}));}else if(family==='lac'){await ctx.check('served-startup-files',()=>lacExposure(ctx,{read:path=>api(ctx,route+'/files/contents?file='+encodeURIComponent(path),'GET',undefined,true),api:(method,path,body)=>api(ctx,path,method,body)}));}else{
  const contents = () => api(ctx, route + '/files/contents?file=' + encodeURIComponent(file), 'GET', undefined, true);
  await ctx.check('publisher-document-preserved', async () => {
    const original = await contents();
    await ctx.artifact('publisher-before.log', ['nuclear','rising-legacy','clusterio'].includes(family) ? JSON.stringify({sha256:hash(original),secretValuesOmitted:true}) : original);
    let text = original;
    if (family === 'fof' && !/^\s*mp_timelimit\s+/m.test(text)) {
      text += (text && !text.endsWith('\n') ? '\n' : '') + '// Validator offline presentation only; no native consumption claim\nmp_timelimit 17\n';
      await offline(ctx);
      await ctx.own({ ...ctx.fixture, presentationFixture: { beforeSHA256: hash(original), afterSHA256: hash(text), nativeSettingsClaim: false } });
      await api(ctx, route + '/files/write?file=' + encodeURIComponent(file), 'POST', text, true);
      if (await contents() !== text) throw Error('Presentation append readback mismatch');
    }
    return { file, beforeSHA256: hash(original), afterSHA256: hash(text), nativeSettingsClaim: false };
  });
  const url = route + '/game-settings?file=' + encodeURIComponent(file);
  for (const suffix of (family === 'rehlds' ? [] : ['/game-settings?file=' + encodeURIComponent(file)])) {
    await ctx.check(suffix.startsWith('/quick') ? 'served-quick-setup' : 'served-game-settings', async () => {
      const response = await api(ctx, route + suffix), body = attrs(response);
      await ctx.artifact(suffix.startsWith('/quick') ? 'quick-setup.json' : 'game-settings.json', response);
      if (!Array.isArray(body.fields)) throw Error('Exact recipe fields missing');
      const expected = family==='crossplay'?{'max-players':'number',motd:'text'}:['nuclear','l4d','l4d2','clusterio'].includes(family) ? {} : family === 'rimworld_openworld' ? {'/MaxPlayers':'number','/EnforceMods':'boolean','/UseModBlacklist':'boolean','/UseCustomDifficulty':'boolean','/UseWhitelist':'boolean','/AllowCustomScenarios':'boolean'} : family === 'rimworld_together' ? {'/MaxPlayers':'number','/Verbosity':'number','/Name':'text','/EnableServerBrowser':'boolean','/EnableServerTelemetry':'boolean'} : family === 'bedrock_vanilla' ? {'max-players':'number'} : family === 'pnx' ? {'/settings/maxPlayers':'number'} : family === 'rising-legacy' ? {server_name:'text',settings_max_players:'number'} : family === 'veloren' ? { server_name:'readonly', max_players:'readonly' } : family === 'vintagestory' ? { '/ServerName': 'text', '/ServerDescription': 'text' } : family === 'pocketmine' ? { 'max-players': 'number' } : family === 'gomint' ? { '/maxPlayers': 'number', '/motd': 'text' } : family === 'nukkit' ? {} : family === 'ksp_lmp' ? { ServerName: 'text', MaxPlayers: 'number', Cheats: 'boolean' } : family === 'ksp_dmp' ? { serverName: 'text', maxPlayers: 'number', cheats: 'boolean' } : family === 'fof' ? { mp_timelimit: 'number' } : { servername: 'readonly', game: 'readonly', maxplayers: 'readonly', serverbrowser: 'readonly', password: 'readonly', port: 'readonly', httpport: 'readonly', bindip: 'readonly' };
      for (const [key, type] of Object.entries(expected)) {
        const fields = body.fields.filter(field => field.key === key);
        if (family === 'gtac' && ['httpport', 'bindip'].includes(key) && !new RegExp('<' + key + '(?:\\s|>)').test(await contents())) continue;
        if (fields.length !== 1 || fields[0].type !== type) throw Error('Exact typed field missing: ' + key);
        const field = fields[0];
        if (family === 'vintagestory' && field.readonly === true) throw Error('Vintage name/description editable authority missing');
        if (['ksp_dmp', 'ksp_lmp'].includes(family) && (field.readonly === true || ['cheats', 'Cheats'].includes(key) && typeof field.value !== 'boolean')) throw Error('DMP typed boolean/editability mismatch');
        if (family === 'gtac' && field.readonly !== true) throw Error('Managed GTAC field must be readonly: ' + key);
        if (family === 'fof' && (field.readonly === true || field.label !== 'Map time limit (minutes)' || field.min !== 0 || field.max !== 20)) throw Error('FoF editable bounds/presentation mismatch');
      }
      if(family==='crossplay')verifyCrossplayExposure(body);
      if(family==='nuclear')verifyNuclearExposure(body);
      if (['l4d','l4d2'].includes(family)) verifyL4DExposure(body);
      if (family === 'clusterio') verifyClusterioExposure(body);
      if (family === 'rimworld_openworld') { verifyOpenWorldExposure(body); verifyOpenWorldConfig(await contents(),f.allocation.port); }
      if (family === 'rimworld_together') { verifyTogetherExposure(body); verifyTogetherConfig(await contents(),f.allocation.port); }
      if (family === 'bedrock_vanilla') verifyBedrockVanillaExposure(body,await contents());
      if (family === 'rising-legacy') verifyRisingExposure(body);
      if (family === 'pnx') verifyPNXExposure(body);
      if (family === 'nukkit') {
        const { verifyNukkitExposure } = await import('./nukkit-canonical-check.mjs');
        await verifyNukkitExposure(ctx, body, await contents());
      }
      if (family === 'veloren') { const { verifyVelorenExposure } = await import('./veloren-canonical-check.mjs'); await verifyVelorenExposure(ctx, body); }
      if (family === 'vintagestory') {
        for (const key of ['/MaxClients', '/Port']) if (body.fields.filter(field => field.key === key && field.readonly === true).length !== 1) throw Error('Vintage stock argv setting must remain readonly: ' + key);
        await ctx.artifact('vintage-canonical-authority.json', { editable: ['/ServerName', '/ServerDescription'], managed: ['/Port', '/MaxClients'], canonicalMAX_CLIENTS: '16', historicalNativeMAX_CLIENTS: 17, scope: 'Stock argv precedence retained; canonical default native capacity consumption not retested; initialized DB path/schema is not proven world seed' });
      }
      if (family === 'fof') {
        const managed = body.fields.filter(field => ['hostname', 'sv_password', 'rcon_password', 'sv_lan', 'tv_enable', 'tv_port'].includes(field.key));
        // Managed values live in separate generated files. The operator document
        // may contain none; any present value must remain readonly.
        if (managed.some(field => field.readonly !== true)) throw Error('FoF managed startup controls must remain readonly');
      }
      return { file, fields: body.fields, scope: family==='clusterio' ? 'Canonical default controller readonly presentation only; native settings and separate host graph pending' : 'Canonical offline presentation only; GTAC browser native consumption remains unproved' };
    });
  }
  if(['l4d','l4d2'].includes(family))await ctx.check('l4d-readonly-refusal',()=>verifyL4DRefusal(ctx,(path,method,body,raw)=>api(ctx,path,method,body,raw)));
  if (family === 'fof') await ctx.check('presentation-edit-readback', async () => {
    await offline(ctx);
    const before = attrs(await api(ctx, url));
    const value = String(before.fields.find(field => field.key === 'mp_timelimit').value) === '17' ? '18' : '17';
    const original = await contents();
    await api(ctx, url, 'PUT', { revision: before.revision, settings: { mp_timelimit: value } });
    const after = attrs(await api(ctx, url)), edited = await contents();
    const unrelated = text => text.split(/\r?\n/).filter(line => !/^\s*mp_timelimit\s+/.test(line)).join('\n');
    if (String(after.fields.find(field => field.key === 'mp_timelimit')?.value) !== value || unrelated(original) !== unrelated(edited)) throw Error('FoF typed string readback/preservation failed');
    await ctx.artifact('publisher-edited.log', edited);
    return { value, nativeSettingsClaim: false };
  });
  }
  await ctx.check('recipe-startup-metadata', async () => {
    const response = await api(ctx, route + '/startup');
    await ctx.artifact('startup.json', ['trackmania','nuclear','rising-legacy','lac'].includes(family) ? {sha256:hash(JSON.stringify(response)),secretValuesOmitted:true} : response);
    const variables = response.data.map(attrs), profile = h.profileFromRuntime(spec(ctx).recipe, receipt);
    const secretServer = ['trackmania','nuclear','rising-legacy','lac'].includes(family) ? attrs(await api(ctx, '/api/application/servers/' + ctx.fixture.server.id)) : null;
    for (const expected of profile.egg.variables.filter(v => v.user_viewable)) {
      const found = variables.filter(v => v.env_variable === expected.env_variable);
      const hiddenSecret = family==='trackmania'&&found.length===1&&trackmaniaSecretUI(expected,found[0],secretServer.container.environment[expected.env_variable])||family==='nuclear'&&expected.env_variable==='SERVER_PASSWORD'&&found.length===1&&secretServer.uuid===ctx.fixture.server.uuid&&nuclearSecretPresence(secretServer.container.environment.SERVER_PASSWORD,found[0])||family==='lac'&&expected.env_variable==='SERVER_PASSWORD'&&found.length===1&&secretServer.uuid===ctx.fixture.server.uuid&&secretServer.container.environment.SERVER_PASSWORD===expected.default_value&&found[0].secret===true&&found[0].secret_configured===(expected.default_value!=='')&&found[0].configured===(expected.default_value!=='')&&found[0].server_value===''&&found[0].default_value===''||family === 'rising-legacy' && expected.env_variable === 'RCON_PASSWORD' && found.length === 1
        && secretServer.uuid === ctx.fixture.server.uuid && secretServer.container.environment.RCON_PASSWORD === expected.default_value
        && found[0].secret === true && found[0].secret_configured === (expected.default_value !== '') && found[0].configured === (expected.default_value !== '')
        && found[0].server_value === '' && found[0].default_value === '';
      if (found.length !== 1 || found[0].name !== expected.name || (found[0].description ?? '') !== (expected.description ?? '') || found[0].rules !== expected.rules || !hiddenSecret && found[0].default_value !== expected.default_value
        || Boolean(found[0].is_editable) !== Boolean(expected.user_editable)) throw Error('Recipe startup metadata mismatch: ' + expected.env_variable);
    }
    return { recipe: spec(ctx).recipe, ...(family==='trackmania'?{variablesSHA256:hash(JSON.stringify(variables)),secretValuesOmitted:true}:{variables}), nativeSettingsClaim: false };
  });
  await ctx.check('preserved-offline', () => offline(ctx));
}

export async function park(ctx) {
  // Never stop an unobserved installer or manufacture successful cancellation.
  // Preserve failed installation and unknown POST resources for root review.
  const evidence = await offline(ctx, true);
  if (!ctx.fixture?.postAttempted || ctx.fixture?.install?.removed && /^\d+$/.test(ctx.fixture.install.rawExit ?? '') && ctx.fixture.install.logsFollowed && ctx.fixture.install.callback) await release(ctx);
  if (ctx.locks?.length) throw Error('Incomplete installer evidence; locks retained for root recovery');
  return evidence;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [flag, manifest, ...extra] = process.argv.slice(2);
  if (flag !== '--run' || !manifest || extra.some(arg => arg !== '--retry')) throw Error('Usage: node source-canonical-check.mjs --run reviewed-manifest.json [--retry]');
  const config = JSON.parse(await readFile(resolve(manifest), 'utf8'));
  const adapter = resolve(process.argv[1]);
  if (!config.games?.length || config.games.length > 10 || new Set(config.games.map(g => g.id)).size !== config.games.length
    || !(BUILDS.has(config.build) || config.games.every(g=>jc3mpIdentity(g.id,config.build)||wurmIdentity(g.id,config.build)||onsetIdentity(g.id,config.build)||trackmaniaIdentity(g.id,config.build)||lacIdentity(g.id,config.build)||crossplayIdentity(g.id,config.build)||risingIdentity(g.id,config.build)||pnxIdentity(g.id,config.build)||bedrockVanillaIdentity(g.id,config.build)||togetherIdentity(g.id,config.build)||openworldIdentity(g.id,config.build)||clusterioIdentity(g.id,config.build)||l4dIdentity(g.id,config.build)||nuclearIdentity(g.id,config.build))) || resolve(config.campaignRoot) !== CAMPAIGN_ROOT
    || !Number.isInteger(config.maxInstallers) || config.maxInstallers < 1 || config.maxInstallers > 4
    || resolve(config.output) !== resolve(ROOT, '.local/validator-campaign')
    || !(config.policy?.reserveMiB >= 8192) || !(config.policy?.reserveDiskMiB >= 32768)
    || !Number.isInteger(config.policy.maxParallel) || config.policy.maxParallel < 1 || config.policy.maxParallel > (config.games.every(g=>jc3mpIdentity(g.id,config.build)||wurmIdentity(g.id,config.build)||onsetIdentity(g.id,config.build)||trackmaniaIdentity(g.id,config.build)||lacIdentity(g.id,config.build)||crossplayIdentity(g.id,config.build)||risingIdentity(g.id,config.build)||pnxIdentity(g.id,config.build)||bedrockVanillaIdentity(g.id,config.build)||togetherIdentity(g.id,config.build)||openworldIdentity(g.id,config.build)||clusterioIdentity(g.id,config.build)||l4dIdentity(g.id,config.build)||nuclearIdentity(g.id,config.build)) ? 16 : 4)
    || resolve(config.session) !== resolve(ROOT, 'tools/runtime/validator/campaign-session.mjs')
    || resolve(config.monitor) !== resolve(config.session)) throw Error('Reviewed shared-session manifest required');
  for (const game of config.games) {
    const selected = spec({ game });
    if (!Number.isSafeInteger(game.ownerId) || game.ownerId < 1 || resolve(game.adapter) !== adapter
      || !(game.installerDefaultMiB > 0) || !(game.installPeakMiB >= Math.max(selected.memory, game.installerDefaultMiB)) || !(game.peakMiB >= game.installPeakMiB) || !(game.diskMiB >= selected.disk)) throw Error('Reviewed installer peak/resources required');
    game.scope = selected.family==='crossplay'?'Canonical explicit three-port choices/install and offline Java properties only; current native loop pending':'Canonical creation/defaults/install and offline presentation only; no new native settings, gameplay or world claim';
  }
  const results = await runQueue(config, { retry: extra.includes('--retry') ? config.games.map(g => g.id) : [] });
  console.log(JSON.stringify(results.map(({ game, status, code }) => ({ game, status, code }))));
  process.exitCode = results.some(result => result.status !== 'PASS') ? 1 : 0;
}
