import {runJC3MPCanonicalBoot} from './jc3mp-canonical-check.mjs';
import {runWurmCanonicalBoot} from './wurm-canonical-check.mjs';
import {runOnsetCanonicalBoot} from './onset-canonical-check.mjs';
import {trackmaniaIdentity, recipe as trackmaniaRecipe, snapshot as trackmaniaSnapshot, verifyTrackmaniaFrozen, trackmaniaSecretUI} from './trackmania-canonical-check.mjs';
/** Source-only canonical bootstrap. Importing does not contact a runtime.
 * Materializes publisher configuration once; no gameplay or retention acceptance.
 */
import {lacIdentity, recipe as lacRecipe, snapshot as lacSnapshot, verifyLACConfig} from './lac-canonical-check.mjs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { hash } from './runner.mjs';
import { pnxIdentity, PNX_SNAPSHOT, verifyPNXRelease } from './pnx-canonical-check.mjs';
import { isRisingBuild, isRisingId, risingIdentity, risingSnapshot } from './rising-canonical-check.mjs';
import { togetherIdentity, TOGETHER_SNAPSHOT, verifyTogetherConfig } from './rimworld-together-canonical-check.mjs';
import { openworldIdentity, OPENWORLD_SNAPSHOT, verifyOpenWorldConfig } from './openworld-canonical-check.mjs';
import { runClusterioCanonicalBoot } from './clusterio-canonical-check.mjs';
import { l4dIdentity, l4dSnapshot, l4dIntentBuildAllowed, l4dInstallerScriptAllowed } from './l4d-canonical-check.mjs';
import { nuclearIdentity, nuclearCanonicalSnapshot, materializeNuclearDefaults, nuclearResolvedEnvironment, nuclearSecretPresence } from './nuclear-canonical-check.mjs';
import { materializeDefaults } from './canonical-request.mjs';

const SNAPSHOTS = new Map([['32aefb21d6016f5f17a8e6437a319ec67d8cde92500fae1b3a6968ba26b0e034', resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-16/build-input-1793670457807')],['2163b02c95bb62f8728e37d5ff2f1c4104cd921028badf6c608c2167c5f5e693', resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-13/build-input-1793667111585')],['22f1ffaf57e9253c0df41803e8a815ae24fa34a30b71152707529d9c946bfbeb', resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-9/build-input-1793661350056')], ['8461d22b6667d4158d72a7d96b8462b7ce3856101592e8409e2077266fe1a7a2', resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-12/build-input-1793664990516')]]);
const recipes = { trackmania:trackmaniaRecipe, lac:lacRecipe, nuclear:'nuclear_option/egg-nuclear-option.json', l4d:'left4dead/egg-left4dead.json', l4d2:'left4dead_2/egg-left4dead_2.json', rimworld_openworld:'rimworld/open_world/egg-rimworld-open-world.json', rimworld_together:'rimworld/together/egg-rimworld-together.json', pnx:'minecraft/bedrock/PowerNukkitX/egg-powernukkitx.json', 'rising-legacy': 'rising_world/legacy/egg-rising-world-legacy.json', veloren: 'veloren/egg-veloren.json', vintagestory: 'vintage_story/egg-vintage-story.json', pocketmine: 'minecraft/bedrock/pocketmine_mp/egg-pocketmine-m-p.json', gomint: 'minecraft/bedrock/gomint/egg-go-mint.json', nukkit: 'minecraft/bedrock/nukkit/egg-nukkit.json', fof: 'fof/egg-fof.json', gtac: 'gta/gtac/egg-grand-theft-auto-connected.json', ksp_dmp: 'ksp/DMP/egg-k-s-p-d-m-p.json', ksp_lmp: 'ksp/LMP/egg-k-s-p--l-m-p.json' };
const attrs = x => x?.attributes ?? x;
const scope = 'Canonical bootstrap and parking only; no full engine, gameplay, WAN, native settings consumption or reinstall retention acceptance';

async function api(signal, path, method = 'GET', body, raw = false) {
  signal.throwIfAborted();
  const response = await fetch('http://127.0.0.1:18099' + path, {
    method, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw Error(`Canonical bootstrap ${method} ${path.split('?')[0]} HTTP ${response.status}`);
  return response.status === 204 ? null : raw ? response.text() : response.json();
}
async function until(signal, fn, label, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const value = await fn();
    if (value) return value;
    await delay(500, undefined, { signal });
  }
  throw Error('Canonical bootstrap timeout: ' + label);
}

export async function runCanonicalBoot(ctx) {
  if(ctx.game.id==='jc3mp-canonical')return runJC3MPCanonicalBoot(ctx);
  if(ctx.game.id==='wurm-canonical')return runWurmCanonicalBoot(ctx);
  if(ctx.game.id==='onset-canonical')return runOnsetCanonicalBoot(ctx);
  if(['clusterio-canonical','clusterio-host-canonical'].includes(ctx.game.id))return runClusterioCanonicalBoot(ctx);
  const family = isRisingId(ctx.game.id) ? 'rising-legacy' : ctx.game.id.replace(/-canonical$/, ''), f = ctx.fixture;
  if (!Object.hasOwn(recipes, family) || (ctx.game.id !== family + '-canonical' && !isRisingId(ctx.game.id))
    || !f?.server || f.name !== 'validator-' + ctx.game.id || f.server.name !== f.name
    || f.recipe !== recipes[family] || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(f.server.uuid)
    || !f.install?.callback?.success || f.install.rawExit !== '0' || !f.install.removed
    || !f.install.logsFollowed || !f.install.memoryValid) throw Error('Exact successfully installed canonical fixture required');
  if (family === 'pnx' && (!pnxIdentity(ctx.game.id,ctx.build) || f.intent.request.node_id === 202)) throw Error('PNX reviewed candidate20 and isolated node required');
  const SNAPSHOT = trackmaniaIdentity(ctx.game.id,ctx.build)?trackmaniaSnapshot:lacIdentity(ctx.game.id,ctx.build)?lacSnapshot:nuclearIdentity(ctx.game.id,ctx.build)?nuclearCanonicalSnapshot:l4dIdentity(ctx.game.id,ctx.build)?l4dSnapshot(ctx.build):openworldIdentity(ctx.game.id,ctx.build) ? OPENWORLD_SNAPSHOT : togetherIdentity(ctx.game.id,ctx.build) ? TOGETHER_SNAPSHOT : family === 'rising-legacy' && isRisingBuild(ctx.build) ? risingSnapshot(ctx.build) : pnxIdentity(ctx.game.id,ctx.build) ? PNX_SNAPSHOT : SNAPSHOTS.get(ctx.build);
  if (family === 'rising-legacy' && (!risingIdentity(ctx.game.id, ctx.build) || f.intent.request.node_id === 202)) throw Error('Reviewed Rising candidate and isolated node required');
  if (!SNAPSHOT || !receipt || resolve(receipt.snapshot) !== resolve(SNAPSHOT) || receipt.binary_sha256 !== ctx.build)
    throw Error('Verified reviewed frozen session required');
  const overrides = JSON.parse(await readFile(resolve(SNAPSHOT, 'internal/panel/game_library/overrides.json'), 'utf8'));
  const profile = overrides[recipes[family]], active = h.profileFromRuntime(recipes[family], receipt);
  if (!profile?.egg || hash(JSON.stringify(profile)) !== hash(JSON.stringify(active))) throw Error('Frozen profile authority differs');
  if(family==='trackmania')verifyTrackmaniaFrozen(profile);
  const egg = profile.egg, r = family==='nuclear'?materializeNuclearDefaults(egg.variables,f.intent.request):materializeDefaults(egg.variables, f.intent.request), route = '/api/client/servers/' + f.server.uuid;
  const file = { trackmania:'/UserData/Config/dedicated_cfg.txt', lac:'/.config/unity3d/MA/LAC/ServerConfig.txt', nuclear:'/DedicatedServerConfig.json', l4d:'/left4dead/cfg/server.cfg', l4d2:'/left4dead2/cfg/server.cfg', rimworld_openworld:'/Data/Config.json', rimworld_together:'/Configs/ServerConfig.json', pnx:'/pnx.yml', 'rising-legacy': '/server.properties', veloren: '/userdata/server/server_config/settings.ron', vintagestory: '/data/serverconfig.json', pocketmine: '/server.properties', gomint: '/server.yml', nukkit: '/server.properties', fof: '/fof/cfg/server.cfg', gtac: '/gtac/server.xml', ksp_dmp: '/Config/Settings.txt', ksp_lmp: '/LMPServer/Config/GeneralSettings.xml' }[family];
  const expectedStop = { trackmania:'^SIGTERM', lac:'^C', nuclear:'^SIGTERM', l4d:'quit', l4d2:'quit', rimworld_openworld:'shutdown', rimworld_together:'quit', pnx:'stop', 'rising-legacy': 'shutdown', veloren: 'shutdown graceful 5', vintagestory: '/stop', pocketmine: 'stop', gomint: 'stop', nukkit: 'stop', fof: 'quit', gtac: '^SIGINT', ksp_dmp: '/exit', ksp_lmp: '^C' }[family];
  const marker = { trackmania:'...Load succeeds', lac:'[NetworkManager] Server Started.', nuclear:'[DedicatedServerManager] Waiting for Players before loading next map', l4d:'VOLTRA_L4D_MAP_READY', l4d2:'VOLTRA_L4D_MAP_READY', rimworld_openworld:'Server Launched', rimworld_together:'Server launched', pnx:')!', 'rising-legacy': 'Steam Query Server bind to ANY (', veloren: 'Server is ready to accept connections', vintagestory: 'Dedicated Server now running on Port ', pocketmine: ')!', gomint: 'Done in ', nukkit: ')!', fof: 'Server is hibernating', gtac: 'Server is now listening on port', ksp_dmp: 'Ready!', ksp_lmp: 'All systems up and running' }[family];
  if (!r || f.intent.ownerId !== ctx.game.ownerId || (['l4d','l4d2'].includes(family)?!l4dIntentBuildAllowed(ctx):f.intent.build !== ctx.build)
    || f.intent.scriptHash !== hash(egg.scripts.installation.script)
    || egg.config.stop !== expectedStop || JSON.parse(egg.config.startup).done !== marker)
    throw Error('Canonical intent/script/native stop/readiness authority mismatch');
  const read = (signal, path) => api(signal, route + '/files/contents?file=' + encodeURIComponent(path), 'GET', undefined, true);
  async function identity(signal) {
    const server = attrs(await api(signal, '/api/application/servers/' + f.server.id));
    if (server.uuid !== f.server.uuid || server.name !== f.name || server.id !== f.server.id
      || Number(server.user) !== f.intent.ownerId || Number(server.node) !== r.node_id
      || server.external_id !== f.intent.externalId || server.egg !== f.egg.id
      || Number(server.limits?.memory) !== (['ksp_dmp', 'ksp_lmp', 'nukkit', 'pocketmine', 'gomint', 'vintagestory', 'veloren', 'rising-legacy', 'pnx'].includes(family) && ctx.fixture.diagnosticMemory?.confirmed === true ? 0 : r.memory) || Number(server.limits?.disk) !== r.disk
      || server.container?.image !== r.image || server.container?.startup_command !== egg.startup
      || !Object.values(egg.docker_images).includes(r.image)) throw Error('Canonical served identity changed');
    const servedEgg = attrs(await api(signal, '/api/admin/eggs/' + server.egg));
    if (servedEgg.uuid !== f.egg.uuid || (['l4d','l4d2'].includes(family)?!l4dInstallerScriptAllowed(ctx,egg.scripts.installation.script,servedEgg.script_install):servedEgg.script_install !== egg.scripts.installation.script)
      || servedEgg.config_stop !== expectedStop) throw Error('Canonical served egg/script/stop changed');
    return server;
  }
  async function native(signal, attempt = 0) {
    const ids = (await docker(['ps', '-aq', '--filter', 'name=' + f.server.uuid], signal, 10000)).trim().split(/\s+/).filter(Boolean);
    if (!ids.length) return null;
    if (ids.length !== 1) throw Error('Ambiguous canonical container or installer still present');
    let n;
    try { n = JSON.parse(await docker(['inspect', '--format', '{"id":{{json .Id}},"name":{{json .Name}},"state":{{json .State}},"image":{{json .Config.Image}},"type":{{json (index .Config.Labels "ContainerType")}},"mounts":{{json .Mounts}}}', ids[0]], signal, 10000));
    } catch (error) {
      if (attempt < 3 && String(error).includes('No such object:')) return native(signal, attempt + 1);
      throw error;
    }
    if (n.name !== '/' + f.server.uuid || n.type !== 'server_process' || n.image !== r.image
      || n.mounts.filter(m => m.Destination === '/home/container' && m.Source === '/var/lib/voltra-parity-20261029/volumes/' + f.server.uuid && m.RW === true).length !== 1)
      throw Error('Canonical container identity/mount mismatch');
    return n;
  }
  async function helpers(signal) {
    const proofs = [];
    for (const match of (['trackmania','lac'].includes(family)?egg.scripts.installation.script.replaceAll('\r\n','\n'):egg.scripts.installation.script).matchAll(/cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)) {
      const path = match[1];
      if (!/^\.?[A-Za-z0-9_./-]+$/.test(path) || path.includes('..') || path.startsWith('/')) throw Error('Unreviewed emitted helper path');
      const expected = hash(match[3] + '\n');
      if (proofs.some(p => p.path === path) || hash(await read(signal, '/' + path.replace(/^\.\//, ''))) !== expected) throw Error('Installed canonical helper mismatch');
      proofs.push({ path, sha256: expected });
    }
    if (!(family==='trackmania'&&proofs.some(p=>p.path==='.voltra/truck-trackmania-native.py')) && !(family==='lac'&&proofs.some(p=>p.path==='.voltra/open_world_servers.py')) && !(family === 'rising-legacy' && proofs.some(p=>p.path==='.voltra/java_games_runtime.py')) && !proofs.some(p => /(?:light_games_next_runtime|source_variant_runtime|sonic_rimworld|source_variants_wave58|gtac-runtime|ksp_runtime|bedrock_family|vintage-story-runtime|veloren-runtime)\.py$/.test(p.path))) throw Error('Frozen runtime helper emission absent');
    return proofs;
  }
  const state = async signal => attrs(await api(signal, route + '/resources')).current_state;
  const served = await identity(ctx.signal);
  const rows = (await api(ctx.signal, route + '/startup')).data.map(attrs);
  const nuclearExpected=family==='nuclear'?nuclearResolvedEnvironment(ctx,r.environment):null;
  for (const variable of egg.variables) {
    // Compare the admin value in memory and the exact secret UI contract.
    const originalDefault = String(variable.default_value), expected = family==='nuclear'?nuclearExpected[variable.env_variable]:family === 'pnx' && variable.env_variable === 'PNX_LICENSE_ACCEPTED' && ctx.fixture.pnxLicenseAcceptance?.confirmed === true ? 'true' : originalDefault, found = rows.filter(v => v.env_variable === variable.env_variable);
    const secretUI = family==='trackmania'&&found.length===1&&trackmaniaSecretUI(variable,found[0],served.container.environment[variable.env_variable])||(family==='lac'&&['SERVER_PASSWORD','ADMIN_CODE'].includes(variable.env_variable)||family === 'rising-legacy' && variable.env_variable === 'RCON_PASSWORD'||family==='nuclear'&&variable.env_variable==='SERVER_PASSWORD') && found.length === 1 && found[0].secret === true && found[0].secret_configured === (expected !== '') && found[0].configured === (expected !== '') && found[0].server_value === '';
    if ((family==='nuclear'&&variable.env_variable==='SERVER_PASSWORD'?!nuclearSecretPresence(served.container.environment.SERVER_PASSWORD,found[0]):String(served.container.environment[variable.env_variable]) !== expected)
      || variable.user_viewable && (found.length !== 1 || !secretUI && String(found[0].server_value) !== expected)
      || family!=='nuclear' && String(r.environment?.[variable.env_variable]) !== originalDefault)
      throw Error('Canonical startup default differs: ' + variable.env_variable);
  }
  if(family==='nuclear')await ctx.artifact('nuclear-secret-presence.json',{configured:true,exactAdminPlaceholder:served.container.environment.SERVER_PASSWORD==='[global integration]',configuredValueMatchesExpected:served.container.environment.SERVER_PASSWORD===nuclearExpected.SERVER_PASSWORD,secretUIContract:true,nativePasswordProofPending:true});
  if (!['trackmania','lac','nuclear','l4d','l4d2','rimworld_openworld','rimworld_together', 'ksp_dmp', 'ksp_lmp', 'nukkit', 'pocketmine', 'gomint', 'vintagestory', 'veloren', 'rising-legacy', 'pnx'].includes(family) && String(egg.variables.find(v => v.env_variable === (family === 'fof' ? 'PUBLIC_SERVER' : 'SERVERBROWSER'))?.default_value) !== (family === 'fof' ? '0' : 'false')) throw Error('Private canonical default required');
  if(family==='trackmania'&&(r.environment.MASTERSERVER_LOGIN!==''||r.environment.MASTERSERVER_PASSWORD!==''))throw Error('Explicit Trackmania LAN defaults required');
  if (['l4d','l4d2'].includes(family)&&(r.environment.PUBLIC_SERVER!=='0'||r.environment.STEAM_GSLT!==''||r.environment.RCON_PASSWORD!==''))throw Error('L4D canonical LAN/no-login defaults required');
  if (family === 'rimworld_together' && (r.environment.REGISTER_SERVER!=='false'||r.environment.SERVER_TELEMETRY!=='false')) throw Error('Together private defaults required');
  if (family === 'ksp_dmp' && String(r.environment.STATUS_PORT) !== '') throw Error('Canonical DMP status HTTP must retain disabled publisher default');
  if (family === 'ksp_lmp' && (String(r.environment.PUBLIC_LISTING) !== '0' || String(r.environment.STATUS_PORT) !== '')) throw Error('Canonical LMP requires private master registration and publisher status port default');
  if (['veloren','lac'].includes(family)) {
    try {
      const existing=await read(ctx.signal,file);
      if (!existing.trim()) throw Error('Existing publisher config is empty');if(family==='lac')verifyLACConfig(existing,f.allocation.port);
      return {skipped:true,file,reason:'Native publisher config already exists; do not generate defaults or test scalar',scope};
    } catch(error) {
      if (!/HTTP (404|502)(?:\D|$)/.test(String(error))) throw error;
      const parts=family==='lac'?['.config','unity3d','MA','LAC','ServerConfig.txt']:['userdata','server','server_config','settings.ron'],inventories=[];let directory='/';let absent=false;
      for (let i=0;i<parts.length;i++) {
        const listing=await api(ctx.signal,route+'/files/list?directory='+encodeURIComponent(directory));
        if (!Array.isArray(listing.data)||listing.data.some(row=>typeof attrs(row)?.name!=='string')) throw error;
        inventories.push({directory,listing});const matches=listing.data.map(attrs).filter(row=>row.name===parts[i]);
        if (!matches.length){absent=true;break}
        if (matches.length!==1||i===parts.length-1||matches[0].is_file!==false||matches[0].is_symlink!==false) throw error;
        directory=(directory==='/'?'':directory)+'/'+parts[i];
      }
      if (!absent) throw error;
      await ctx.artifact(family+'-cold-config-absence.json',{file,inventories,absenceProven:true,readError:String(error)});
    }
  }
  if (['pocketmine', 'gomint', 'vintagestory'].includes(family)) {
    try {
      const existing = await read(ctx.signal, file);
      const required = family === 'vintagestory' ? (() => { const value = JSON.parse(existing); return typeof value.ServerName === 'string' && typeof value.ServerDescription === 'string'; })() : family === 'pocketmine' ? /^max-players=/m.test(existing) : /^maxPlayers:/m.test(existing) && /^motd:/m.test(existing);
      if (required) return { skipped: true, file, reason: 'Publisher config already contains canonical presentation fields', scope };
    } catch (error) {
      if (family !== 'vintagestory') {
        if (!/HTTP 404/.test(String(error))) throw error;
      } else {
        // Wings can wrap ENOENT as 502. HTTP status alone never proves absence.
        // Successful parent inventories must prove the exact publisher path is
        // absent. A present file, unsafe parent or failed listing keeps the
        // original read failure unresolved and forbids first boot.
        if (!/HTTP (404|502)(?:\D|$)/.test(String(error))) throw error;
        const rootInventory = await api(ctx.signal, route + '/files/list?directory=%2F');
        if (!Array.isArray(rootInventory.data) || rootInventory.data.some(row => typeof attrs(row)?.name !== 'string')) throw error;
        const parents = rootInventory.data.map(attrs).filter(row => row.name === 'data');
        if (parents.length > 1) throw error;
        let dataInventory;
        if (parents.length) {
          if (parents[0].is_file !== false || parents[0].is_symlink !== false) throw error;
          dataInventory = await api(ctx.signal, route + '/files/list?directory=%2Fdata');
          if (!Array.isArray(dataInventory.data) || dataInventory.data.some(row => typeof attrs(row)?.name !== 'string')
            || dataInventory.data.some(row => attrs(row).name === 'serverconfig.json')) throw error;
        }
        await ctx.artifact('canonical-bootstrap-missing-config.json', { file, readError: String(error),
          rootInventory, dataInventory, parentAbsent: !parents.length, absenceProvenBySuccessfulListing: true,
          scope: 'Exact publisher config absent; arbitrary HTTP502 is never treated as missing' });
      }
    }
  }
  const authority = await helpers(ctx.signal), before = await native(ctx.signal);
  if (family === 'pnx') await ctx.artifact('pnx-installed-release-receipt.json',verifyPNXRelease(await read(ctx.signal,'/.voltra/pnx/release.json')));
  if (family === 'nukkit') {
    const { verifyNukkitInstalled } = await import('./nukkit-canonical-check.mjs');
    await verifyNukkitInstalled(ctx);
    const response = await api(ctx.signal, route + '/files/list?directory=%2F');
    if (!Array.isArray(response.data)) throw Error('Nukkit root inventory missing');
    if (response.data.some(row => attrs(row).name === 'nukkit.yml')) return { skipped: true, reason: 'Native configuration already present; bootstrap is forbidden', scope };
  }
  if (await state(ctx.signal) !== 'offline' || before?.state.Running) throw Error('Canonical bootstrap requires parked fixture');
  if (f.canonicalBootstrap) {
    if (!['ksp_dmp', 'ksp_lmp'].includes(family) || ctx.game.canonicalBootRetryReviewed !== true || f.canonicalBootstrap.complete
      || !before || before.state.Status !== 'exited' || before.state.Running || before.state.Restarting || before.state.Pid !== 0
      || !Number.isInteger(before.state.ExitCode) || !Number.isFinite(Date.parse(f.canonicalBootstrap.attemptedAt)) || !Number.isFinite(Date.parse(before.state.StartedAt))
      || Date.parse(before.state.StartedAt) < Date.parse(f.canonicalBootstrap.attemptedAt)
      || !Number.isFinite(Date.parse(before.state.FinishedAt)) || Date.parse(before.state.FinishedAt) < Date.parse(before.state.StartedAt))
      throw Error('Prior bootstrap requires reviewed retry and exact owned exited container receipt');
    const prior = { bootstrap: f.canonicalBootstrap, container: before, offline: true, reviewedRetry: true,
      logsSHA256: hash(await docker(['logs', '--since', before.state.StartedAt, before.id], ctx.signal, 10000)) };
    await ctx.artifact('canonical-bootstrap-prior-' + Date.now() + '.json', prior);
    await ctx.own({ ...ctx.fixture, canonicalBootstrapHistory: [...(ctx.fixture.canonicalBootstrapHistory ?? []), prior] });
  }
  if (['ksp_dmp', 'ksp_lmp', 'nukkit', 'pocketmine', 'gomint', 'vintagestory', 'veloren', 'rising-legacy', 'pnx'].includes(family) && ctx.game.canonicalBootMemoryRelease === true && !ctx.fixture.diagnosticMemory?.confirmed) {
    const buildRoute = '/api/application/servers/' + f.server.id;
    const beforeLimits = (await identity(ctx.signal)).limits;
    if (Number(beforeLimits.memory) !== r.memory) throw Error('Unexpected pre-release canonical memory limit');
    const intent = { before: beforeLimits, requested: { memory: 0 }, uuid: f.server.uuid, at: new Date().toISOString(),
      scope: 'Test-only native bootstrap memory release; canonical creation recommendation remains recorded' };
    await ctx.artifact('canonical-bootstrap-memory-intent.json', intent);
    await ctx.own({ ...ctx.fixture, diagnosticMemory: { intent, confirmed: false } });
    await api(ctx.signal, buildRoute + '/build', 'PATCH', { memory: 0 });
    const after = attrs(await api(ctx.signal, buildRoute)).limits;
    await ctx.artifact('canonical-bootstrap-memory-readback.json', { before: beforeLimits, after });
    if (Number(after?.memory) !== 0 || Object.keys(beforeLimits).some(key => key !== 'memory' && JSON.stringify(beforeLimits[key]) !== JSON.stringify(after[key])))
      throw Error('Bootstrap memory release readback differs');
    await ctx.own({ ...ctx.fixture, diagnosticMemory: { intent, confirmed: true, before: beforeLimits, after, at: new Date().toISOString() } });
    await identity(ctx.signal);
  }
  if (family === 'nukkit' && (r.memory !== 1024 || ctx.fixture.diagnosticMemory?.confirmed !== true)) throw Error('Nukkit canonical bootstrap requires reviewed post-install memory release and readback');
  if (family === 'pnx' && !ctx.fixture.pnxLicenseAcceptance?.confirmed) {
    await identity(ctx.signal);
    if (await state(ctx.signal)!=='offline' || (await native(ctx.signal))?.state.Running) throw Error('PNX license acceptance requires parked exact fixture');
    const intent={uuid:f.server.uuid,before:'false',after:'true',authority:'User explicitly authorized EULA acceptance on their behalf',license:'https://www.gnu.org/licenses/lgpl-3.0.html'};
    await ctx.artifact('pnx-license-acceptance-intent.json',intent);
    await ctx.own({...ctx.fixture,pnxLicenseAcceptance:{intent,confirmed:false}});
    await api(ctx.signal,'/api/application/servers/'+f.server.id+'/startup','PATCH',{environment:{PNX_LICENSE_ACCEPTED:'true'}});
    const accepted=await identity(ctx.signal);
    if(String(accepted.container?.environment?.PNX_LICENSE_ACCEPTED)!=='true'||egg.variables.some(v=>v.env_variable!=='PNX_LICENSE_ACCEPTED'&&String(accepted.container.environment[v.env_variable])!==String(v.default_value))) throw Error('PNX controlled license readback differs');
    await ctx.own({...ctx.fixture,pnxLicenseAcceptance:{intent,confirmed:true}});
  }
  await ctx.reserve(Math.max(r.memory, ctx.game.peakMiB));
  const started = Date.now();
  await ctx.own({ ...ctx.fixture, canonicalBootstrap: { attemptedAt: new Date(started).toISOString(), scope, helpers: authority } });
  let observed, nukkitProcess;
  async function park(signal) {
    await identity(signal);
    const n = await native(signal);
    if (!n || !observed || n.id !== observed.id || n.state.StartedAt !== observed.state.StartedAt) throw Error('Cannot park unobserved or replaced canonical container');
    if (n.state.Running) await api(signal, route + '/power', 'POST', { signal: 'stop' });
    const stopped = await until(signal, async () => {
      const current = await native(signal);
      if (!current || current.id !== n.id || current.state.StartedAt !== n.state.StartedAt) throw Error('Canonical container changed during parking');
      return !current.state.Running && await state(signal) === 'offline' ? current : false;
    }, 'native config stop and offline', ['nuclear','l4d','l4d2','vintagestory','veloren','rising-legacy','pnx'].includes(family) ? 90000 : 45000);
    if (stopped.state.ExitCode !== 0 || stopped.state.OOMKilled || stopped.state.Dead
      || Date.parse(stopped.state.FinishedAt) < Date.parse(stopped.state.StartedAt)) throw Error('Canonical bootstrap stop lacks clean native exit 0');
    const stoppedLogs = await docker(['logs', '--since', stopped.state.StartedAt, stopped.id], signal, 10000);
    await ctx.artifact('canonical-bootstrap-stop.log', ['nuclear','rising-legacy'].includes(family) ? JSON.stringify({sha256:hash(stoppedLogs),secretValuesOmitted:true}) : stoppedLogs);
    if (family === 'nukkit' && (!nukkitProcess?.engine?.direct || /Native process exited:|grace expired|escalating owned process/.test(stoppedLogs) || !/Stopping the server/.test(stoppedLogs) || !/Unloading level/.test(stoppedLogs))) throw Error('Nukkit direct clean native exit unproved');
    return { containerId: stopped.id, state: stopped.state, stop: expectedStop, offline: true, scope };
  }
  try {
    await api(ctx.signal, route + '/power', 'POST', { signal: 'start' });
    const ready = await until(ctx.signal, async () => {
      const n = await native(ctx.signal);
      if (!n || n.state.Status === 'created' || !Number.isFinite(Date.parse(n.state.StartedAt)) || Date.parse(n.state.StartedAt) < started) return false;
      if (observed && (observed.id !== n.id || observed.state.StartedAt !== n.state.StartedAt)) throw Error('Canonical bootstrap unexpectedly restarted');
      observed = n;
      if (!n.state.Running) throw Error('Canonical bootstrap exited before readiness');
      const text = await docker(['logs', '--since', n.state.StartedAt, n.id], ctx.signal, 10000);
      await ctx.artifact('canonical-bootstrap-fresh.log', ['nuclear','rising-legacy'].includes(family) ? JSON.stringify({sha256:hash(text),readyMarker:text.includes(marker),secretValuesOmitted:true}) : text);
      const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
      if (['pocketmine', 'gomint'].includes(family) && text.includes(marker)) { const { verifyBedrockInstalled } = await import('./bedrock-canonical-check.mjs'); await verifyBedrockInstalled(ctx, n); }
      const publisherReady = text.includes(marker) && (family !== 'pnx' || /PowerNukkitX version 3\.0\.5-SNAPSHOT .*git-9813b75/.test(plain) && /Done \([0-9.]+s\)!/.test(plain)) && (family !== 'nukkit' || /Nukkit version .*git-4841947/.test(plain) && /Done \([0-9.]+s\)!/.test(plain)) && (family !== 'gtac' || /\d+\/\d+ Resources loaded, 0 failed/.test(text));
      return publisherReady && await state(ctx.signal) === 'running' ? { containerId: n.id, startedAt: n.state.StartedAt, marker, logSHA256: hash(text) } : false;
    }, 'fresh publisher readiness and actual running', ['nuclear','l4d','l4d2','rising-legacy','pnx'].includes(family) ? 240000 : 120000);
    if (family === 'nukkit') {
      const { verifyNukkitInstalled } = await import('./nukkit-canonical-check.mjs');
      nukkitProcess = await verifyNukkitInstalled(ctx, observed);
    }
    const parking = await park(ctx.signal), contents = await read(ctx.signal, file);
    if(family==='lac')verifyLACConfig(contents,ctx.fixture.allocation.port);
    if (family === 'rimworld_openworld') verifyOpenWorldConfig(contents,ctx.fixture.allocation.port);
    if (family === 'rimworld_together') verifyTogetherConfig(contents,ctx.fixture.allocation.port);
    if (!contents.trim()) throw Error('Publisher configuration remained empty after first boot');
    await ctx.artifact('canonical-bootstrap-publisher.log', ['trackmania','lac','nuclear','rising-legacy'].includes(family) ? JSON.stringify({sha256:hash(contents),secretValuesOmitted:true}) : contents);
    const proof = { ...ctx.fixture.canonicalBootstrap, ...(family==='trackmania'?{currentNativePending:true,historicalSourceEquivalent:false}:{}), statusHTTP: family === 'ksp_dmp' ? 'Disabled canonical empty STATUS_PORT; historical native HTTP evidence used a separate explicit allocation' : family === 'ksp_lmp' ? 'Publisher empty STATUS_PORT uses primary port; no player or external master registration' : undefined, ready, parking, nukkitProcess, file, configSHA256: hash(contents), complete: true };
    await ctx.own({ ...ctx.fixture, canonicalBootstrap: proof });
    return proof;
  } catch (error) {
    // Save the originating failure before cleanup can itself fail.
    const original = { message: String(error?.message ?? error), stack: error?.stack, at: new Date().toISOString() };
    await ctx.artifact('canonical-bootstrap-original-error.json', original);
    await ctx.own({ ...ctx.fixture, canonicalBootstrap: { ...ctx.fixture.canonicalBootstrap, originalError: original } });
    try {
      const signal = AbortSignal.timeout(60000);
      if (!observed) {
        const n = await native(signal);
        if (n && n.state.Status !== 'created' && Number.isFinite(Date.parse(n.state.StartedAt)) && Date.parse(n.state.StartedAt) >= started) observed = n;
      }
      if (!observed) throw Error('Canonical bootstrap start outcome unresolved; preserve locks and fixture for root');
      const n = await native(signal);
      if (n && n.id === observed.id && n.state.StartedAt === observed.state.StartedAt && !n.state.Running && await state(signal) === 'offline') {
        // A failed native exit is a preserved failure, never a clean-stop pass.
        await ctx.artifact('canonical-bootstrap-failed-exit.json', n);
        await ctx.own({ ...ctx.fixture, canonicalBootstrap: { ...ctx.fixture.canonicalBootstrap, failedExit: n, offline: true } });
      } else {
        const parking = await park(signal);
        await ctx.own({ ...ctx.fixture, canonicalBootstrap: { ...ctx.fixture.canonicalBootstrap, failureParking: parking } });
      }
    } catch (cleanupError) {
      const cleanup = { message: String(cleanupError?.message ?? cleanupError), at: new Date().toISOString() };
      await ctx.artifact('canonical-bootstrap-cleanup-error.json', cleanup);
      await ctx.own({ ...ctx.fixture, canonicalBootstrap: { ...ctx.fixture.canonicalBootstrap, cleanupError: cleanup } });
    }
    throw error;
  }
}
