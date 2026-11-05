import { open, unlink, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { campaign as h, receipt, docker, settings } from './campaign-session.mjs';
const apiAdapterURL = new URL('./api-adapter.mjs', import.meta.url);
const sourceVersion = new URL(import.meta.url).searchParams.get('v');
if (sourceVersion !== null) apiAdapterURL.searchParams.set('v', sourceVersion);
const apiAdapter = await import(apiAdapterURL.href);
import { Blocked } from './runner.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const attrs = x => x?.attributes ?? x;
const runtimeFor = ctx => {
  const s = ctx.fixture?.server;
  if (s) Object.assign(ctx.game, { base: 'http://127.0.0.1:18099', serverId: s.id, serverUUID: s.uuid, nodeId: 1, expectedName: s.name });
};
export async function verify(ctx) {
  if (!h || receipt.binary_sha256 !== ctx.build) throw Error('Campaign session not verified');
  if (ctx.fixture?.server) { runtimeFor(ctx); await apiAdapter.verify({ ...ctx, fixture: { uuid: ctx.fixture.server.uuid }, own: async () => {} }); }
  else if (ctx.fixture) {
    if (ctx.fixture.recipe !== ctx.game.recipe || ctx.fixture.name !== 'validator-' + ctx.game.id) throw Error('Partial fixture ownership mismatch');
    for (const kind of ['nest', 'egg']) if (ctx.fixture[kind]) {
      const actual = attrs(await h.api('/api/admin/' + kind + 's/' + ctx.fixture[kind].id));
      if (actual.uuid !== ctx.fixture[kind].uuid) throw Error('Partial ' + kind + ' identity changed');
    }
  }
}
async function acquire(ctx) {
  while (true) {
    ctx.signal.throwIfAborted();
    for (let slot = 0; slot < (settings.maxInstallers ?? 1); slot++) {
    const file = resolve(ctx.output, 'installer-' + slot + '.lock');
    try {
      const lock = await open(file, 'wx');
      await lock.writeFile(JSON.stringify({ game: ctx.game.id, pid: process.pid })); await lock.close();
      ctx.installerLock = file;
      await ctx.reserve(ctx.game.installPeakMiB ?? ctx.game.peakMiB);
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner; try { owner = JSON.parse(await readFile(file, 'utf8')); } catch { await sleep(250); continue; }
      if (owner.pid !== process.pid) throw Error('Installer slot belongs to another process; inspect before recovery');
    }
    }
    await sleep(250);
  }
}
async function release(ctx) {
  if (ctx.provisionLock) { await unlink(ctx.provisionLock); ctx.provisionLock = null; }
  if (ctx.installerLock) { await unlink(ctx.installerLock); ctx.installerLock = null; }
}
async function acquireProvision(ctx) {
  const file = resolve(ctx.output, 'provision.lock');
  while (true) {
    ctx.signal.throwIfAborted();
    try {
      const lock = await open(file, 'wx');
      await lock.writeFile(JSON.stringify({ pid: process.pid, game: ctx.game.id })); await lock.close();
      ctx.provisionLock = file; return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner; try { owner = JSON.parse(await readFile(file, 'utf8')); } catch { await sleep(250); continue; }
      if (owner.pid !== process.pid) throw Error('Provision lock requires recovery');
      await sleep(250);
    }
  }
}
async function inspect(uuid) {
  const ids = (await docker(['ps', '-aq', '--filter', 'name=' + uuid])).trim().split(/\s+/).filter(Boolean);
  const result = [];
  for (const id of ids) {
    try { result.push(JSON.parse(await docker(['inspect', '--format', '{"id":{{json .Id}},"name":{{json .Name}},"state":{{json .State}},"memory":{{json .HostConfig.Memory}},"cpu":{{json .HostConfig.NanoCpus}}}', id]))); }
    catch (error) { if (!error.message.includes('No such object: ' + id)) throw error; }
  }
  return result;
}
export async function wait(ctx, fn, label, ms = 180000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { ctx.signal.throwIfAborted(); const result = await fn(); if (result) return result; await sleep(1000); }
  throw Error('Timeout: ' + label);
}
async function install(ctx, profile) {
  let s = ctx.fixture;
  const installer = await wait(ctx, async () => (await inspect(s.server.uuid)).find(c => c.name.includes('installer') && c.state.Running), 'gated installer', 90000);
  s.installerId = installer.id; await ctx.own(s);
  // Wings clamps an unlimited server's installer to its small default. Change
  // only this verified, gated, owned installer before allowing script execution.
  // Docker update treats memory=0 as "leave unchanged", so use the VM ceiling
  // for this temporary installer. It is a safety cap, never a reservation.
  const vmMemory = Number((await docker(['info', '--format', '{{.MemTotal}}'], ctx.signal)).trim());
  if (!Number.isSafeInteger(vmMemory) || vmMemory < 1048576) throw Error('Invalid VM memory ceiling');
  const capMiB = ctx.game.installerMaxMiB;
  if (capMiB !== undefined && (!Number.isSafeInteger(capMiB) || capMiB < ctx.game.installPeakMiB)) throw Error('Invalid reviewed installer cache cap');
  const installerMemory = capMiB === undefined ? vmMemory : Math.min(vmMemory, capMiB * 1048576);
  await docker(['update', '--memory', String(installerMemory), '--memory-swap', String(installerMemory), '--cpu-quota', '-1', installer.id], ctx.signal);
  const limits = JSON.parse(await docker(['inspect', '--format', '{"memory":{{.HostConfig.Memory}},"swap":{{.HostConfig.MemorySwap}},"cpuQuota":{{.HostConfig.CpuQuota}},"oomDisabled":{{json .HostConfig.OomKillDisable}}}', installer.id], ctx.signal));
  if (limits.memory !== installerMemory || limits.cpuQuota !== -1 || limits.oomDisabled === true) throw Error('Installer resource update not confirmed');
  await ctx.artifact('installer-resources-' + Date.now() + '.json', limits);
  if (ctx.game.cacheSha256) {
    const sha = ctx.game.cacheSha256;
    if (!/^[a-f0-9]{64}$/.test(sha) || !/^[a-f0-9-]{36}$/.test(s.server.uuid)) throw Error('Invalid cache identity');
    const script = `set -eu; test "$(sha256sum /cache/${sha} | cut -d ' ' -f 1)" = '${sha}'; mkdir -p /game/.voltra/public-cache; cp /cache/${sha} /game/.voltra/public-cache/${sha}; chown $(stat -c '%u:%g' /game) /game/.voltra/public-cache/${sha}; sha256sum /game/.voltra/public-cache/${sha}`;
    const proof = await docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--memory', '64m', '--memory-swap', '64m', '--cpus', '1', '--mount', 'type=bind,source=/var/lib/voltra-batch-20261023/cache/sha256,target=/cache,readonly', '--mount', `type=bind,source=/var/lib/voltra-parity-20261029/volumes/${s.server.uuid},target=/game`, 'alpine:3.22', 'sh', '-c', script], ctx.signal);
    await ctx.artifact('cache-reuse.json', { sha256: sha, proof, scope: 'Verified cached installer input; not a cold download claim' });
  }
  if (ctx.game.family === 'astroneer' && ctx.game.astroneerBootstrap && !s.astroneerBootstrap) {
    const { restoreAstroneerCache } = await import('./astroneer-bootstrap.mjs');
    await restoreAstroneerCache(ctx, installer);
    s = ctx.fixture;
  }
  // Attach both observations before releasing the canonical installer.
  const waitResult = docker(['wait', installer.id], ctx.signal, ctx.game.installTimeoutMs ?? 900000);
  const logs = docker(['logs', '-f', installer.id], ctx.signal, ctx.game.installTimeoutMs ?? 900000);
  const observed = Promise.allSettled([waitResult, logs]);
  await sleep(500);
  await docker(['exec', installer.id, 'touch', '/mnt/server/.campaign-release-' + s.gateId], ctx.signal);
  const outcome = await wait(ctx, async () => {
    const server = attrs(await h.api('/api/application/servers/' + s.server.id));
    if (server.uuid !== s.server.uuid) throw Error('Install identity changed');
    return h.classifyInstallOutcome(server);
  }, 'installer callback', ctx.game.installTimeoutMs ?? 900000);
  const [raw, log] = await observed;
  const logText = log.status === 'fulfilled' ? log.value : String(log.reason);
  const logPath = await ctx.artifact('install-' + Date.now() + '.log', logText);
  const exit = raw.status === 'fulfilled' ? raw.value.trim() : 'unobserved';
  s.install = { rawExit: exit, callback: outcome, logPath, canonicalScriptSha256: h.digest(profile.egg.scripts.installation.script), scriptHash: h.digest(profile.egg.scripts.installation.script), logsFollowed: log.status === 'fulfilled', memoryValid: true };
  s.installerResources = { id: installer.id, memory: installerMemory, at: new Date().toISOString(), verifiedLimits: limits };
  if (ctx.game.family === 'astroneer') {
    const current = attrs(await h.api('/api/application/servers/' + s.server.id));
    const mode = current.container?.environment?.INSTALL_MODE;
    if (!['operator_files', 'steam'].includes(mode) || mode !== ctx.game.environment.INSTALL_MODE) throw Error('Astroneer actual installer mode differs from reviewed request');
    s.install.sourceMode = mode; s.install.cacheValidationOnly = mode === 'operator_files';
  }
  await ctx.own(s);
  // Wings removes the installer; keep the slot until disappearance is observed.
  await wait(ctx, async () => !(await inspect(s.server.uuid)).some(c => c.id === installer.id), 'installer removal', 30000);
  s.install.removed = true; await ctx.own(s);
  await release(ctx);
  if (log.status !== 'fulfilled') throw Error('Complete installer logs were not observed; preserve raw exit and callback evidence');
  if (exit !== '0' || !outcome.success) {
    if (/Invalid Password|Account Logon Denied|No subscription|license required|API.?key.*required/i.test(logText)) throw new Blocked('INSTALL_CREDENTIAL', 'Supply the required publisher credential/license; retained installer log: ' + logPath);
    throw Error('Canonical installer failed; raw exit ' + exit + '; log ' + logPath);
  }
  return s.install;
}
async function provision(ctx) {
  await acquire(ctx);
  const profile = h.profileFromRuntime(ctx.game.recipe, receipt);
  for (const image of new Set([profile.egg.scripts.installation.container, Object.values(profile.egg.docker_images)[0]])) {
    try { await docker(['image', 'inspect', '--format', '{{.Id}}', image], ctx.signal); }
    catch { await docker(['pull', image], ctx.signal, 600000); }
  }
  await acquireProvision(ctx);
  const rows = (await h.api('/api/application/nodes/1/allocations?per_page=1000')).data.map(attrs);
  const used = new Set(rows.map(a => a.port));
  const count = ctx.game.ports ?? 2;
  let ports = ctx.fixture?.ports;
  if (!ports)
  for (let p = 29100; p + count <= 30000; p += count) {
    const trial = Array.from({ length: count }, (_, i) => p + i);
    if (!trial.some(x => used.has(x))) { h.assertPortsFree(trial); ports = trial; break; }
  }
  if (!ports) throw Error('No owned test ports available');
  const s = ctx.fixture ?? { recipe: ctx.game.recipe, gateId: randomUUID(), ports, name: 'validator-' + ctx.game.id };
  await ctx.own(s);
  if (!s.nest) { const n = attrs(await h.api('/api/admin/nests', 'POST', { name: s.name, author: 'validator@localhost', description: 'Preserved validator fixture' })); s.nest = { id: n.id, uuid: n.uuid }; await ctx.own(s); }
  const egg = structuredClone(profile.egg); egg.uuid = randomUUID();
  egg.scripts.installation.script = h.installerGate(egg.scripts.installation.script, s.gateId);
  if (!s.egg) { const e = attrs(await h.api('/api/admin/eggs/import', 'POST', { nest_id: s.nest.id, egg })); s.egg = { id: e.id, uuid: e.uuid }; await ctx.own(s); }
  if (!s.allocations) await h.api('/api/application/nodes/1/allocations', 'POST', { ip: '127.0.0.1', ports: ports.map(String) });
  s.allocations = (await h.api('/api/application/nodes/1/allocations?per_page=1000')).data.map(attrs).filter(a => ports.includes(a.port)); await ctx.own(s);
  if (s.allocations.length !== ports.length || s.allocations.some(a => a.server_id != null)) throw Error('Allocation conflict');
  const options = attrs(await h.api('/api/client/game-library/templates/' + h.digest(ctx.game.recipe).slice(0, 16)));
  const environment = { ...Object.fromEntries(options.variables.map(v => [v.env_variable, v.default_value])), ...ctx.game.environment };
  if (ctx.game.family === 'jc3mp') Object.assign(environment,{QUERY_PORT:String(ports[1]),STEAM_PORT:String(ports[2]),HTTP_PORT:String(ports[3])});
  if (ctx.game.family === 'wurm') environment.QUERY_PORT=String(ports[1]);
  if (ctx.game.family === 'ksp_dmp') environment.STATUS_PORT = String(ports[1]);
  if (ctx.game.family === 'stk') environment.DISCOVERY_PORT = String(ports[1]);
  if (ctx.game.family === 'minecraft' && options.variables.some(v => v.env_variable === 'EULA_ACCEPTED')) {
    environment.EULA_ACCEPTED = 'true';
    await ctx.artifact('installer-eula.json', { accepted: true, terms: 'https://www.minecraft.net/eula', at: new Date().toISOString(), authority: 'User authorized game-server EULA acceptance', method: 'Owned installer EULA_ACCEPTED=true' });
  }
  s.server = attrs(await h.api('/api/application/servers', 'POST', {
    name: s.name, user: 1, egg: s.egg.id, node_id: 1,
    docker_image: Object.values(profile.egg.docker_images)[0], startup: ctx.game.testStartup ?? profile.egg.startup,
    allocation: { default: s.allocations.find(a => a.port === ports[0]).id, additional: ports.slice(1).map(p => s.allocations.find(a => a.port === p).id) },
    limits: { memory: ctx.game.hardMemoryMiB ?? 0, disk: 0, swap: 0, cpu: 0, io: 500 }, oom_disabled: false,
    ...(ctx.game.family === 'minecraft' ? { java_config: { xmx_mib: 2048, xms_mib: 128 } } : {}),
    feature_limits: { databases: 0, backups: 2, allocations: ports.length - 1 }, environment, start_on_completion: false,
  }));
  // Store only ownership, never the returned environment or credentials.
  s.server = { id: s.server.id, uuid: s.server.uuid, name: s.name }; await ctx.own(s);
  await unlink(ctx.provisionLock); ctx.provisionLock = null;
  runtimeFor(ctx);
  await ctx.check('canonical-install', () => install(ctx, profile));
}
export async function run(ctx) {
  if (ctx.game.retentionOnly) return retention(ctx);
  if (!ctx.fixture?.server) await provision(ctx);
  else if (ctx.fixture.install?.rawExit !== '0' || ctx.game.refreshInstaller === true
    && ctx.fixture.install.canonicalScriptSha256 !== h.digest(h.profileFromRuntime(ctx.game.recipe, receipt).egg.scripts.installation.script)) {
    await acquire(ctx);
    const profile = h.profileFromRuntime(ctx.game.recipe, receipt);
    if (ctx.fixture.install?.rawExit === '0') await ctx.artifact('installer-refresh-intent-' + Date.now() + '.json', {
      previous: ctx.fixture.install, nextScriptSHA256: h.digest(profile.egg.scripts.installation.script),
      reason: 'Explicit reviewed installer refresh for changed served source; prior successful installation remains evidence',
    });
    if (ctx.game.family === 'minecraft' && profile.egg.variables.some(v => v.env_variable === 'EULA_ACCEPTED')) {
      await ctx.artifact('installer-eula-' + Date.now() + '.json', { accepted: true, terms: 'https://www.minecraft.net/eula', at: new Date().toISOString(), authority: 'User authorized game-server EULA acceptance', method: 'Owned Startup EULA_ACCEPTED=true before reinstall' });
      await h.api('/api/application/servers/' + ctx.fixture.server.id + '/startup', 'PATCH', { environment: { EULA_ACCEPTED: 'true' } });
    }
    ctx.fixture.gateId = randomUUID(); await ctx.own(ctx.fixture);
    await h.api('/api/admin/eggs/' + ctx.fixture.egg.id, 'PATCH', { script_install: h.installerGate(profile.egg.scripts.installation.script, ctx.fixture.gateId) });
    await h.api('/api/application/servers/' + ctx.fixture.server.id + '/reinstall', 'POST');
    await ctx.check('canonical-install-retry', () => install(ctx, profile));
  }
  else if (ctx.fixture.install?.rawExit === '0') await ctx.check('canonical-install-retained', async () => ({ ...ctx.fixture.install, reused: true }));
  runtimeFor(ctx);
  if (!ctx.fixture.install || ctx.fixture.install.rawExit !== '0') throw Error('Retained failed installation requires installer repair/reinstall');
  if (ctx.game.installationOnly === true) {
    await ctx.check('installation-only-scope', async () => ({ installed: true, nativeLifecycleTested: false, scope: 'Observed canonical installation only; no readiness, settings, save, reload or full acceptance claim' }));
    return;
  }
  await ctx.reserve(ctx.game.peakMiB);
  if (ctx.fixture.retentionBaseline) { delete ctx.fixture.retentionBaseline; await ctx.own(ctx.fixture); }
  await apiAdapter.run(ctx);
}
export async function park(ctx) {
  if (ctx.fixture?.server) {
    runtimeFor(ctx);
    const containers = await inspect(ctx.fixture.server.uuid);
    for (const c of containers) {
      if (c.name !== '/' + ctx.fixture.server.uuid && c.id !== ctx.fixture.installerId) continue;
      try { await ctx.artifact('park-' + Date.now() + '-' + c.id.slice(0, 12) + '.log', await docker(['logs', '--tail', '1000', c.id], ctx.signal)); }
      catch { /* A disappearing completed installer must not prevent parking. */ }
    }
    for (const c of containers.filter(c => c.name.includes('installer'))) {
      // Cancellation may arrive after creation but before install() records ID.
      // Adopt only this fixture's exact, still-unreleased resource gate.
      if (!ctx.fixture.installerId && c.state.Running && c.name === '/' + ctx.fixture.server.uuid + '_installer') {
        const f = ctx.fixture, gate = f.gateId;
        if (!/^[a-f0-9-]{36}$/.test(gate ?? '')) throw Error('Missing owned installer gate');
        const server = attrs(await h.api('/api/application/servers/' + f.server.id));
        const egg = attrs(await h.api('/api/admin/eggs/' + server.egg));
        const profile = h.profileFromRuntime(f.recipe, receipt);
        const [full] = JSON.parse(await docker(['inspect', c.id], ctx.signal));
        const source = '/var/lib/voltra-parity-20261029/volumes/' + f.server.uuid;
        if (server.uuid !== f.server.uuid || server.name !== f.name || server.egg !== f.egg.id || server.node !== 1
          || egg.uuid !== f.egg.uuid || egg.script_install !== h.installerGate(profile.egg.scripts.installation.script, gate)
          || full.Id !== c.id || full.Name !== c.name || !full.State.Running
          || full.Mounts.filter(m => m.Destination === '/mnt/server' && m.Source === source).length !== 1
          || (await docker(['logs', c.id], ctx.signal)).trim() !== 'CAMPAIGN_RESOURCE_GATE') throw Error('Unobserved installer ownership is ambiguous');
        const absent = await docker(['exec', c.id, 'sh', '-c', 'test ! -e /mnt/server/.campaign-release-' + gate + ' && echo gated'], ctx.signal);
        if (absent.trim() !== 'gated') throw Error('Unobserved installer gate was released');
        await ctx.artifact('cancel-unobserved-gated-installer.json', { uuid: server.uuid, installer: c.id, gate, source, scope: 'Exact owned gate, no publisher script released; cancellation only' });
        f.installerId = c.id; await ctx.own(f);
      }
      if (c.id !== ctx.fixture.installerId) throw Error('Unowned installer; retain slot');
      if (c.state.Running) await docker(['stop', '--time', '15', c.id], ctx.signal);
      await wait(ctx, async () => !(await inspect(ctx.fixture.server.uuid)).some(x => x.id === c.id), 'cancelled installer removal', 30000);
    }
    const existing = (await inspect(ctx.fixture.server.uuid)).find(c => c.name === '/' + ctx.fixture.server.uuid);
    if (!existing?.state.Running) { await release(ctx); return { offline: true, preserved: true, native: existing?.state ?? { absent: true }, installation: ctx.fixture.install }; }
    const parked = await apiAdapter.park(ctx);
    const native = (await inspect(ctx.fixture.server.uuid)).find(c => c.name === '/' + ctx.fixture.server.uuid);
    if (native?.state.Running) throw Error('Panel offline but native process still running');
    await release(ctx);
    return { ...parked, native: native?.state ?? { absent: true }, preserved: true };
  }
  await release(ctx); return { offline: true, preserved: true, partial: Boolean(ctx.fixture) };
}
async function retention(ctx) {
  if (!ctx.fixture?.server || ctx.fixture.install?.rawExit !== '0') throw Error('Retention requires an installed preserved fixture');
  let saved = ctx.fixture.retentionBaseline ?? ctx.previous?.checks?.find(x => x.name === 'saved' && x.status === 'PASS')?.evidence;
  const l4d = ['l4d', 'l4d2'].includes(ctx.game.family);
  const waterdog = ['waterdog', 'waterdog-duplicate'].includes(ctx.game.family);
  const arena = ctx.game.family === 'xonotic';
  const luanti = ctx.game.family === 'luanti';
  const barotrauma = ctx.game.family === 'barotrauma';
  if(ctx.game.family==='jc3mp')(await import('./jc3mp-checks.mjs')).diagnosticGate('retention admission');
  const legacy = ['wurm','onset','trackmania','nuclear','lac', 'crossplay', 'clusterio', 'l4d', 'l4d2', 'etlegacy', 'assaultcube', 'quakelive', 'barotrauma', 'soldat', 'ddnet', 'ss14', 'hl2dm', 'openra', 'stk', 'unturned', 'crewlink', 'impostor', 'valheim', 'zandronum', 'sven', 'gtac', 'fof', 'cs2', 'rehlds', 'ksp_dmp', 'ksp_lmp', 'nukkit', 'pocketmine', 'gomint', 'astroneer', 'vintagestory', 'veloren', 'waterdog', 'waterdog-duplicate', 'pnx', 'bedrock_vanilla', 'rising-legacy', 'glowstone', 'rimworld_together', 'rimworld_openworld'].includes(ctx.game.family);
  if (ctx.game.family==='wurm' ? !saved?.observation?.manifest || !saved.stop?.direct || saved.stop.engineExitProven!==true || saved.stop.engineNumericExit!==0 : ctx.game.family==='onset' ? !saved?.baseline?.manifest || !saved.stop?.process?.direct || saved.stop.engineExitProven!==true || saved.stop.engineNumericExit!==0 : ctx.game.family==='trackmania' ? !saved?.baseline?.manifest || !saved.engine?.direct || saved.engineExitProven!==true || saved.engineNumericExit!==0 : ctx.game.family==='nuclear' ? !saved?.baseline?.manifest || !saved.stop?.process?.direct || saved.stop.engineExitProven!==true || saved.stop.engineNumericExit!==0 : ctx.game.family==='lac' ? !saved?.baseline?.manifest || !saved.processProof?.engine?.direct || saved.engineExitProven!==true || saved.engineNumericExit!==0 : ctx.game.family === 'crossplay' ? !Number.isInteger(saved?.marker) || !/^-?[0-9]+$/.test(saved?.seed ?? '') || saved.baseline?.world?.seed !== saved.seed || !saved.baseline?.files || !saved.processProof?.engine?.direct || saved.engineExitProven !== true || saved.engineNumericExit !== 0 : ctx.game.family === 'clusterio' ? !saved?.baseline?.manifest || !saved.processProof?.engine?.direct || saved.engineExitProven !== true || saved.engineNumericExit !== 0 : l4d ? !saved?.name || !saved.baseline || !saved.processProof?.engine?.directSupervisor || saved.engineExitProven !== true || saved.engineNumericExit !== 0 : ['rimworld_together', 'rimworld_openworld'].includes(ctx.game.family) ? !saved?.baseline?.initialized || !saved.backup || !saved.engineExitProven || saved.engineNumericExit !== 0 : ctx.game.family === 'glowstone' ? !saved?.world?.seed || !saved.baseline || !saved.engineExitProven || saved.engineNumericExit !== 0 : waterdog ? !saved?.baseline || !saved.network || saved.fixture !== ctx.fixture.server.uuid || !saved.engineExitProven || saved.engineNumericExit !== 0 : ctx.game.family === 'veloren' ? !saved?.baseline?.files || !saved.configSHA256 || !saved.engineExitProven || saved.engineNumericExit !== 0 : ['nukkit', 'pocketmine', 'gomint', 'pnx', 'bedrock_vanilla'].includes(ctx.game.family) ? !saved?.baseline?.identity || !saved.hashes : ctx.game.family === 'valheim' ? !saved?.identity || !saved.fiveStageSave : barotrauma ? !saved?.save || !saved.campaign : ctx.game.family === 'gtac' ? !saved?.marker || !saved.files : legacy ? !saved?.marker || !saved.hashes : luanti ? !saved?.marker || !saved.identity : arena ? !saved?.markerHash : !saved?.seed || !saved.gamerule) throw Error('Retention requires prior native persistence identity');
  runtimeFor(ctx);
  const c = apiAdapter.client(ctx);
  const hookPath = ctx.game.family==='jc3mp'?'./jc3mp-checks.mjs':ctx.game.family==='wurm'?'./wurm-checks.mjs':ctx.game.family==='onset'?'./onset-checks.mjs':ctx.game.family==='trackmania'?'./trackmania-checks.mjs':ctx.game.family==='nuclear'?'./nuclear-checks.mjs':ctx.game.family==='lac'?'./lac-checks.mjs':ctx.game.family === 'crossplay' ? './crossplay-checks.mjs' : ctx.game.family === 'clusterio' ? './clusterio-checks.mjs' : l4d ? './l4d-checks.mjs' : ctx.game.family === 'rimworld_openworld' ? './rimworld-openworld-checks.mjs' : ctx.game.family === 'rimworld_together' ? './rimworld-together-checks.mjs' : ctx.game.family === 'glowstone' ? './glowstone-checks.mjs' : ctx.game.family === 'pnx' ? './pnx-checks.mjs' : ctx.game.family === 'bedrock_vanilla' ? './bedrock-vanilla-checks.mjs' : ctx.game.family === 'rising-legacy' ? './rising-legacy-checks.mjs' : waterdog ? './waterdog-checks.mjs' : ctx.game.family === 'veloren' ? './veloren-checks.mjs' : ctx.game.family === 'vintagestory' ? './vintagestory-checks.mjs' : ctx.game.family === 'astroneer' ? './astroneer-checks.mjs' : ctx.game.family === 'pocketmine' ? './pocketmine-checks.mjs' : ctx.game.family === 'gomint' ? './gomint-checks.mjs' : ctx.game.family === 'nukkit' ? './nukkit-checks.mjs' : ['ksp_dmp', 'ksp_lmp'].includes(ctx.game.family) ? './ksp-checks.mjs' : ctx.game.family === 'cs2' ? './cs2-checks.mjs' : ctx.game.family === 'rehlds' ? './rehlds-checks.mjs' : ctx.game.family === 'fof' ? './fof-checks.mjs' : ctx.game.family === 'gtac' ? './gtac-checks.mjs' : ctx.game.family === 'sven' ? './sven-checks.mjs' : ctx.game.family === 'zandronum' ? './zandronum-checks.mjs' : ['crewlink', 'impostor'].includes(ctx.game.family) ? './among-us-checks.mjs' : ctx.game.family === 'valheim' ? './valheim-checks.mjs' : ctx.game.family === 'unturned' ? './unturned-checks.mjs' : ctx.game.family === 'openra' ? './openra-checks.mjs' : ctx.game.family === 'stk' ? './stk-checks.mjs' : ctx.game.family === 'hl2dm' ? './hl2dm-checks.mjs' : ctx.game.family === 'soldat' ? './soldat-checks.mjs' : ctx.game.family === 'ddnet' ? './ddnet-checks.mjs' : ctx.game.family === 'ss14' ? './ss14-checks.mjs' : barotrauma ? './barotrauma-checks.mjs' : ctx.game.family === 'quakelive' ? './quake-live-checks.mjs' : legacy ? './legacy-checks.mjs' : luanti ? './luanti-checks.mjs' : arena ? './arena-checks.mjs' : './game-checks.mjs';
  const hooks = await apiAdapter.hooks(ctx, new URL(hookPath, import.meta.url));
  if(ctx.game.family==='wurm')saved=await ctx.check('wurm-current-native-stop',async()=>{const latest=[...(ctx.previous?.checks??[])].reverse().find(x=>['reload','reinstall-native-reload'].includes(x.name)&&x.status==='PASS')?.evidence?.saved??saved;hooks.restoreContext(ctx,latest);return hooks.saved(ctx,c);});
  if(ctx.game.family==='onset')await ctx.check('onset-current-native-stop',async()=>{
    const proof=[...(ctx.previous?.checks??[])].reverse().find(x=>['reload','reinstall-native-reload'].includes(x.name)&&x.status==='PASS')?.evidence?.stop??saved.stop,current=await native(ctx);
    await ctx.artifact('onset-retention-stop-boundary.json',{proof,current});
    if(!proof?.process?.direct||proof.engineNumericExit!==0||proof.engineExitProven!==true||!current||current.id!==proof.containerId||current.state.StartedAt!==proof.startedAt||current.state.FinishedAt!==proof.finishedAt||current.state.Running||current.state.ExitCode!==0||current.state.OOMKilled||current.state.Dead||await c.state()!=='offline')throw Error('Onset latest current native clean stop differs');
    saved=await hooks.retentionStop(ctx,c,{...saved,stop:proof});return saved.stop;
  });
  if(ctx.game.family==='nuclear')await ctx.check('nuclear-current-native-stop',async()=>{
    const reload=ctx.previous?.checks?.find(x=>['reload','reinstall-native-reload'].includes(x.name)&&x.status==='PASS')?.evidence,proof=reload?.stop??saved.stop,current=await native(ctx);
    if(!proof?.process?.direct||proof.engineNumericExit!==0||proof.engineExitProven!==true||!current||current.id!==proof.containerId||current.state.StartedAt!==proof.startedAt||current.state.FinishedAt!==proof.finishedAt||current.state.Running||current.state.ExitCode!==0||current.state.OOMKilled||current.state.Dead||await c.state()!=='offline')throw Error('Current Nuclear direct native stop differs from persisted reload proof');
    saved={...saved,stop:proof};hooks.restoreContext(ctx,saved);saved=await hooks.saved(ctx,c);return {containerId:current.id,startedAt:current.state.StartedAt,engineNumericExit:0,engineExitProven:true};
  });
  if(ctx.game.family==='trackmania')saved=await ctx.check('trackmania-current-native-stop',()=>hooks.retentionStop(ctx,c,saved));
  if(ctx.game.family==='lac')await ctx.check('lac-current-native-stop',async()=>{
    const reload=ctx.previous?.checks?.find(x=>['reload','reinstall-native-reload'].includes(x.name)&&x.status==='PASS')?.evidence,proof=reload?.stop??saved.processProof,current=await native(ctx);
    if(!proof?.engine?.direct||proof.engineNumericExit!==0||proof.engineExitProven!==true||!current||current.id!==proof.containerId||current.state.StartedAt!==proof.startedAt||current.state.Running||current.state.ExitCode!==0||current.state.OOMKilled||current.state.Dead||await c.state()!=='offline'||JSON.stringify(await hooks.installedSource(ctx,c))!==JSON.stringify(proof.source))throw Error('Current LAC native/source stop boundary differs');
    saved={...saved,...proof,processProof:proof};hooks.restoreContext(ctx,saved);saved=await hooks.saved(ctx,c);return {containerId:current.id,startedAt:current.state.StartedAt,engineNumericExit:0,engineExitProven:true};
  });
  if (['astroneer', 'vintagestory'].includes(ctx.game.family)) {
    const reload = ctx.previous?.checks?.find(x => ['reload', 'reinstall-native-reload'].includes(x.name) && x.status === 'PASS')?.evidence;
    const current = (await native(ctx))?.state;
    if (reload?.freshStoppedBaselineRequiredForRetention && reload.nativeStop
        && JSON.stringify(current) === JSON.stringify(reload.nativeStop)) {
      saved = { ...saved, nativeStop: reload.nativeStop,
        ...(ctx.game.family === 'astroneer' ? { nativeIdentity: reload.native } : { nativeProcessProof: reload.nativeProcessProof }) };
    } else if (!saved.nativeStop || JSON.stringify(current) !== JSON.stringify(saved.nativeStop)) throw Error('No persisted native stop matches current retention boundary');
  }
  if (ctx.game.family === 'crossplay') {
    await ctx.check('retention-crossplay-stop-identity', async () => {
      const current = await native(ctx);
      const reload = ctx.previous?.checks?.find(x => ['reload', 'reinstall-native-reload'].includes(x.name) && x.status === 'PASS')?.evidence;
      const proof = reload?.stop ?? saved.processProof;
      if (!current || current.id !== proof?.containerId || current.state.StartedAt !== proof.startedAt || current.state.Running || current.state.ExitCode !== 0 || current.state.OOMKilled || current.state.Dead || proof.engineNumericExit !== 0 || proof.engineExitProven !== true || !proof.engine?.direct || proof.engine.heapMiB !== 2048 || await c.state() !== 'offline') throw Error('Crossplay current boundary lacks matching direct Java clean stop');
      if (JSON.stringify(await hooks.installedSource(ctx, c)) !== JSON.stringify(proof.source)) throw Error('Crossplay stopped helper authority changed');
      if (!saved.baseline.world.storage || !Object.keys(saved.baseline.world.storage).length || !/^[a-f0-9]{64}$/.test(saved.baseline.world.level?.sha256 ?? '')) throw Error('Crossplay native NBT/storage identity incomplete');
      saved = { ...saved, processProof: proof };
      return { containerId: current.id, startedAt: current.state.StartedAt, engineExitProven: true, engineNumericExit: 0, heapMiB: 2048 };
    });
  }
  if (l4d) {
    await ctx.check('retention-native-stop-identity', async () => {
      const current = await native(ctx);
      const reload = ctx.previous?.checks?.find(x => ['reload', 'reinstall-native-reload'].includes(x.name) && x.status === 'PASS')?.evidence;
      const proof = reload?.stop ?? saved.processProof;
      const folder = ctx.game.family === 'l4d' ? 'left4dead' : 'left4dead2';
      const map = ctx.game.family === 'l4d' ? 'l4d_hospital01_apartment' : 'c1m1_hotel';
      for (const path of [folder + '/cfg/server.cfg', folder + '/cfg/voltra-managed.cfg', folder + '/cfg/voltra-variant.cfg', folder + '/maps/' + map + '.bsp']) {
        const meta = saved.baseline[path];
        if (!meta || !/^[a-f0-9]{64}$/.test(meta.sha256) || !Number.isInteger(meta.size) || meta.size < 0 || !['mode', 'uid', 'gid'].every(k => Number.isInteger(meta[k]) && meta[k] >= 0)) throw Error('L4D retained publisher map/config identity incomplete');
      }
      if (!current || current.id !== proof?.containerId || current.state.StartedAt !== proof.startedAt || current.state.Running || current.state.ExitCode !== 0 || current.state.OOMKilled || current.state.Dead || proof.engineNumericExit !== 0 || proof.engineExitProven !== true || !proof.engine?.directSupervisor || !proof.engine.norestart || !proof.engine.noDebug || await c.state() !== 'offline') throw Error('L4D current parked fixture lacks matching direct native quit0 proof');
      const hashes = await hooks.installedSource(ctx, c);
      if (JSON.stringify(hashes) !== JSON.stringify(proof.hashes)) throw Error('L4D stopped source chain differs from native proof');
      saved = { ...saved, processProof: proof };
      return { containerId: current.id, startedAt: current.state.StartedAt, engineNumericExit: 0, engineExitProven: true, sourceHashes: hashes };
    });
  }
  if (legacy) hooks.restoreContext(ctx, saved);
  await ctx.check('retention-offline', async () => {
    if (await c.state() !== 'offline' || (await native(ctx))?.state.Running) throw Error('Retention fixture must already be parked');
    return { offline: true };
  });
  if (hooks.helperAuthority) await hooks.helperAuthority(ctx, c);
  const uuid = ctx.fixture.server.uuid;
  if (!/^[a-f0-9-]{36}$/.test(uuid)) throw Error('Invalid fixture UUID');
  const ownedEgg = attrs(await h.api('/api/admin/eggs/' + ctx.fixture.egg.id));
  if (['wurm','trackmania'].includes(ctx.game.family)&&ownedEgg.script_install!==h.profileFromRuntime(ctx.game.recipe,receipt).egg.scripts.installation.script)throw Error('Wurm/Trackmania retained raw installer bytes differ');
  if (ownedEgg.uuid !== ctx.fixture.egg.uuid) throw Error('Retained egg identity mismatch');
  const quote = s => "'" + s.replaceAll("'", "'\"'\"'") + "'";
  const snapshot = async () => {
    const required = ctx.game.family === 'clusterio' ? 'config-' + ctx.game.clusterioRole + '.json' : waterdog ? 'config.yml' : ctx.game.family === 'veloren' ? 'userdata/server/server_config/settings.ron' : legacy ? (hooks.retentionRequiredPath ?? hooks.retentionPaths(ctx)[1]).slice(1) : luanti ? '.minetest/worlds/validator_world/map.sqlite' : arena ? '.xonotic/data/server.cfg' : 'world/level.dat';
    const paths = legacy ? hooks.retentionPaths(ctx).map(p => { if (!p.startsWith('/') || p.split('/').includes('..') || /[\r\n]/.test(p)) throw Error('Invalid retention path'); return quote(p.slice(1)); }).join(' ') : luanti ? '.minetest/minetest.conf .minetest/worlds/validator_world' : arena ? '.xonotic validator-persistence.txt' : 'world world_nether world_the_end mods plugins config server.properties eula.txt';
    const script = 'set -eu; cd /data/volumes/' + uuid + '; test -s ' + quote(required) + '; for p in ' + paths + '; do if [ -e "$p" ]; then find "$p" -type f ! -name "*.log" -exec sha256sum {} \\; -exec stat -c "META %a %u %g %n" {} \\;; fi; done | sort';
    const hashes = await docker(['exec', 'voltra-validator-monitor', 'sh', '-c', script], ctx.signal);
    if (!hashes.includes(required)) throw Error('Missing retained file snapshot');
    return hashes;
  };
  if (barotrauma || ['ss14', 'unturned', 'valheim', 'astroneer', 'vintagestory'].includes(ctx.game.family)) saved = await ctx.check('retention-current-stopped-save', () => hooks.saved(ctx, c));
  const wurmBefore=ctx.game.family==='wurm'?await hooks.offlineSnapshot(ctx,c):null;
  const before = await snapshot();
  await ctx.artifact('retention-before.sha256', before);
  ctx.fixture.retentionBaseline = saved; await ctx.own(ctx.fixture);
  if (ctx.game.family === 'astroneer') {
    if (ctx.game.environment.INSTALL_MODE !== 'steam') throw Error('Astroneer retention requires actual Steam canonical reinstall');
    await ctx.artifact('astroneer-steam-mode-intent.json', { fixture: uuid, mode: 'steam', previousCacheValidationOnly: ctx.fixture.install.cacheValidationOnly === true });
    await h.api('/api/application/servers/' + ctx.fixture.server.id + '/startup', 'PATCH', { environment: { INSTALL_MODE: 'steam' } });
    const actual = attrs(await h.api('/api/application/servers/' + ctx.fixture.server.id));
    if (actual.uuid !== uuid || actual.container?.environment?.INSTALL_MODE !== 'steam') throw Error('Astroneer Steam mode readback failed');
    await ctx.artifact('astroneer-steam-mode-readback.json', { fixture: uuid, mode: 'steam', confirmed: true });
  }
  await acquire(ctx);
  const profile = h.profileFromRuntime(ctx.game.recipe, receipt);
  ctx.fixture.gateId = randomUUID(); await ctx.own(ctx.fixture);
  await h.api('/api/admin/eggs/' + ctx.fixture.egg.id, 'PATCH', { script_install: h.installerGate(profile.egg.scripts.installation.script, ctx.fixture.gateId) });
  await h.api('/api/application/servers/' + ctx.fixture.server.id + '/reinstall', 'POST');
  await ctx.check('canonical-reinstall', () => install(ctx, profile));
  await ctx.check('reinstall-retained-bytes', async () => {
    const after = await snapshot(); await ctx.artifact('retention-after.sha256', after);
    if (after !== before) throw Error('Reinstall changed retained world/config/mod/plugin files; inspect hash artifacts');
    return { identical: true, files: before.trim().split('\n').length / 2, ownershipAndModes: true, scope: 'Existing world/config/mod/plugin files, or arena user data; logs excluded; no synthetic mod compatibility claim' };
  });
  if(ctx.game.family==='wurm')await ctx.check('wurm-strict-reinstall-retention',async()=>hooks.verifyWurmRetention(wurmBefore,await hooks.offlineSnapshot(ctx,c)));
  await ctx.reserve(ctx.game.peakMiB);
  if (legacy) hooks.restoreContext(ctx, saved);
  if (luanti) ctx.luanti = { marker: saved.marker, mod: saved.mod, identity: saved.identity };
  await ctx.check('reinstall-native-reload', async () => {
    ctx.startRequestedAt = Date.now(); await c.power('start');
    await wait(ctx, () => hooks.ready(ctx, c), 'reinstall readiness');
    const world = await hooks.loaded(ctx, c, saved);
    const capacity = arena || luanti || legacy ? { includedInNativeReadback: true } : await command(ctx, 'list', /max of 7 players/i);
    return { ...world, capacity };
  });
}
export async function native(ctx) {
  return (await inspect(ctx.fixture.server.uuid)).find(c => c.name === '/' + ctx.fixture.server.uuid);
}
export async function logs(ctx, since) {
  const c = await native(ctx);
  if (!c) return '';
  return docker(['logs', '--since', since ?? c.state.StartedAt, c.id], ctx.signal);
}
export async function command(ctx, command, pattern) {
  const since = new Date().toISOString();
  await h.api('/api/client/servers/' + ctx.fixture.server.uuid + '/command', 'POST', { command });
  return wait(ctx, async () => {
    const text = await logs(ctx, since);
    const replies = text.split('\n').filter(x => x.trim() !== command).join('\n');
    await ctx.artifact('command-' + command.split(' ')[0].replace(/[^a-z0-9-]/gi, '') + '.log', replies);
    if (/Unknown command|Incorrect argument|cannot be found|Invalid argument/i.test(replies)) throw Error('Native command rejected: ' + replies.slice(-500));
    if (pattern.test(replies)) return { command, reply: replies.slice(-3000) };
    return false;
  }, 'native command ' + command, 45000);
}
