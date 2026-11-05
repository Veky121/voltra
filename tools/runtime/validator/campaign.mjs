import {registration as jc3mp} from './jc3mp-checks.mjs';
import {registration as wurm} from './wurm-checks.mjs';
import {registration as onset} from './onset-checks.mjs';
import {registration as trackmania, budgets as trackmaniaBudgets} from './trackmania-checks.mjs';
import {registration as nuclear} from './nuclear-checks.mjs';
import {registration as lac, budgets as lacBudgets} from './lac-checks.mjs';
import { registration as crossplay, budgets as crossplayBudgets } from './crossplay-checks.mjs';
import { registration as l4d, budgets as l4dBudgets } from './l4d-checks.mjs';
import { registration as openworld } from './rimworld-openworld-checks.mjs';
import { registration as together } from './rimworld-together-checks.mjs';
import { registration as pnx } from './pnx-checks.mjs';
import { registration as bedrockVanilla } from './bedrock-vanilla-checks.mjs';
import { registration as vintagestory } from './vintagestory-checks.mjs';
import { registration as pocketmine } from './pocketmine-checks.mjs';
import { registration as gomint } from './gomint-checks.mjs';
import { registration as nukkit } from './nukkit-checks.mjs';
import { registration as ksp } from './ksp-checks.mjs';
import { registration as cs2 } from './cs2-checks.mjs';
import { registration as rehlds } from './rehlds-checks.mjs';
import { registration as fof } from './fof-checks.mjs';
import { registration as gtac } from './gtac-checks.mjs';
import { registration as sven } from './sven-checks.mjs';
import { registration as zandronum } from './zandronum-checks.mjs';
import { registration as amongUs } from './among-us-checks.mjs';
import { registration as valheim } from './valheim-checks.mjs';
import { registration as unturned } from './unturned-checks.mjs';
import { registration as openra } from './openra-checks.mjs';
import { registration as stk } from './stk-checks.mjs';
import { registration as hl2dm } from './hl2dm-checks.mjs';
import { registration as soldat } from './soldat-checks.mjs';
import { registration as ddnet } from './ddnet-checks.mjs';
import { registration as ss14 } from './ss14-checks.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { registration as barotrauma } from './barotrauma-checks.mjs';
import { registration as quake } from './quake-live-checks.mjs';
import { registration as legacy } from './legacy-checks.mjs';
import { runQueue } from './runner.mjs';
const args = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const root = value('--campaign-root');
if (!root) throw Error('Usage: node tools/runtime/validator/campaign.mjs --campaign-root PATH [--games openttd,terraria,paper] [--retry id,id]');
const receipt = JSON.parse(await readFile(resolve(root, 'artifacts/game-parity-20261029/root-activation.json')));
const prefix = 'tools/runtime/validator/';
const recipes = {
 jc3mp:{...jc3mp.jc3mp,family:'jc3mp'},
 wurm:{...wurm.wurm,family:'wurm'},
 onset:{...onset.onset,family:'onset'},
 nuclear:{...nuclear.nuclear,family:'nuclear'},
 trackmania:{...trackmania.trackmania,family:'trackmania',peakMiB:trackmaniaBudgets.memoryMiB,installPeakMiB:2048,diskMiB:trackmaniaBudgets.diskMiB,offlineHelperImage:'sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8'},
 lac:{...lac.lac,family:'lac',peakMiB:lacBudgets.memoryMiB,installPeakMiB:2048,diskMiB:lacBudgets.diskMiB,offlineHelperImage:'sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8'},
  crossplay: { ...crossplay.crossplay, family: 'crossplay', peakMiB: crossplayBudgets.memoryMiB, installPeakMiB: 2048, diskMiB: crossplayBudgets.diskMiB, offlineHelperImage: 'sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8' },
  ...Object.fromEntries(Object.entries(l4d).map(([id, spec]) => [id, { ...spec, family: id, peakMiB: l4dBudgets.memoryMiB, installPeakMiB: 2048, diskMiB: l4dBudgets.diskMiB, offlineHelperImage: 'sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8' }])),
  rimworld_openworld: { ...openworld.rimworld_openworld, family: 'rimworld_openworld', peakMiB: 2048, installPeakMiB: 1024, diskMiB: 2048, offlineHelperImage: 'sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8' },
  rimworld_together: { ...together.rimworld_together, family: 'rimworld_together', peakMiB: 2048, installPeakMiB: 1024, diskMiB: 2048, offlineHelperImage: 'sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8' },
  pnx: { ...pnx.pnx, family: 'pnx', peakMiB: 2304, installPeakMiB: 2048, diskMiB: 4096 },
  bedrock_vanilla: { ...bedrockVanilla.bedrock_vanilla, family: 'bedrock_vanilla' },
  vintagestory: { ...vintagestory.vintagestory, family: 'vintagestory', peakMiB: 4096, installPeakMiB: 2048, diskMiB: 8192, offlineHelperImage: 'sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8' },
  pocketmine: { ...pocketmine.pocketmine, family: 'pocketmine', peakMiB: 2048, installPeakMiB: 2048, diskMiB: 4096 },
  gomint: { ...gomint.gomint, family: 'gomint', peakMiB: 3072, installPeakMiB: 2048, diskMiB: 4096 },
  nukkit: { ...nukkit.nukkit, family: 'nukkit', peakMiB: 3072, installPeakMiB: 2048, diskMiB: 4096 },
  ksp_dmp: { ...ksp.ksp_dmp, family: 'ksp_dmp', peakMiB: 2048, installPeakMiB: 2048, diskMiB: 4096 },
  ksp_lmp: { ...ksp.ksp_lmp, family: 'ksp_lmp', peakMiB: 1024, installPeakMiB: 2048, diskMiB: 4096 },
  cs2: { ...cs2.cs2, family: 'cs2', peakMiB: 4096, installPeakMiB: 4096, installerMaxMiB: 8192, diskMiB: 81920 },
  rehlds: { ...rehlds.rehlds, family: 'rehlds', peakMiB: 1024, installPeakMiB: 2048, diskMiB: 4096 },
  ...Object.fromEntries(Object.entries({ ...legacy, ...quake, ...barotrauma, ...soldat, ...ddnet, ...ss14, ...hl2dm, ...openra, ...stk, ...unturned, ...amongUs, ...valheim, ...zandronum, ...sven, ...gtac, ...fof }).map(([id, spec]) => [id, { ...spec, family: id, peakMiB: id === 'barotrauma' ? 3072 : 1024, installPeakMiB: 2048, diskMiB: 4096 }])),
  luanti: { family: 'luanti', recipe: 'minetest/egg-minetest.json', peakMiB: 1024, installPeakMiB: 2048, diskMiB: 2048, ports: 1, environment: { WORLD_NAME: 'validator_world', SERVER_ADMIN_NAME: 'ValidatorAdmin', SERVER_ADMIN_PASSWORD: '', SERVER_PASSWORD: '', SERVER_ANNOUNCE: 'false', DEFAULT_GAME: 'minetest', BOOTSTRAP_ADMIN: '1' } },
  xonotic: { family: 'xonotic', recipe: 'xonotic/egg-xonotic.json', peakMiB: 1024, installPeakMiB: 2048, diskMiB: 4096, ports: 1, environment: { PUBLIC_SERVER: '0', MIN_PLAYERS: '0', BOT_JOIN_EMPTY: '0' } },
  teeworlds: { family: 'teeworlds', recipe: 'teeworlds/egg-teeworlds.json', peakMiB: 512, installPeakMiB: 2048, diskMiB: 1024, environment: { SERVER_NAME: 'Validator Teeworlds', SERVER_MAP: 'dm1', GAME_TYPE: 'dm', MAX_PLAYERS: '12', PUBLIC_SERVER: '0' } },
  cs2d: { family: 'cs2d', recipe: 'cs2d/egg-c-s2-d.json', peakMiB: 512, installPeakMiB: 1024, diskMiB: 1024, environment: { SERVER_NAME: 'Validator CS2D', PUBLIC_SERVER: '0', SERVER_MAP: 'de_dust2', SERVER_PLAYERS: '12', BOT_COUNT: '0', AUTO_UPDATE: '0' } },
  openarena: { family: 'openarena', recipe: 'openarena/egg-open-arena.json', peakMiB: 512, installPeakMiB: 1024, diskMiB: 1024, environment: { GAME_MAP: 'aggressor', GAME_MOD: 'baseoa', GAME_TYPE: '0', MAX_PLAYERS: '12', MIN_PLAYERS: '0', PUBLIC_SERVER: '0' } },
  openttd: { family: 'openttd', recipe: 'openttd/egg-open-t-t-d-server.json', peakMiB: 1024, diskMiB: 512 },
  terraria: { family: 'terraria', recipe: 'terraria/vanilla/egg-terraria-vanilla.json', peakMiB: 2048, diskMiB: 1024, environment: { WORLD_NAME: 'validator_world', MAX_PLAYERS: '6', SERVER_MOTD: 'Validator native' } },
  ...Object.fromEntries(['paper', 'folia', 'purpur', 'fabric', 'quilt', 'krypton', 'neoforge', 'vanillacord', 'spigot', 'magma', 'mohist', 'arclight'].map(name => [name, { family: 'minecraft', recipe: `minecraft/java/${name}/egg-${name === 'vanillacord' ? 'vanilla-cord' : name}.json`, peakMiB: 3072, diskMiB: 2048 }])),
  canvas: { family: 'minecraft', recipe: 'minecraft/java/canvas-mc/egg-canvas-mc.json', peakMiB: 3072, diskMiB: 2048 },
  forge: { family: 'minecraft', recipe: 'minecraft/java/forge/egg-forge-enhanced.json', peakMiB: 3072, diskMiB: 3072 },
  spongevanilla: { family: 'minecraft', recipe: 'minecraft/java/spongevanilla/egg-sponge-vanilla.json', peakMiB: 3072, diskMiB: 3072 },
  spongeforge: { family: 'minecraft', recipe: 'minecraft/java/spongeforge/egg-sponge-forge.json', peakMiB: 4096, diskMiB: 4096 },
};
Object.assign(recipes.krypton, { peakMiB: 3072, installPeakMiB: 6144, cacheSha256: '78188d4718c2ba92cab828c8a599bc5b11bbd31c286a4079cc67167519e68cd7' });
Object.assign(recipes.zandronum, { peakMiB: 512, installPeakMiB: 2048, diskMiB: 2048 });
Object.assign(recipes.valheim, { peakMiB: 4096, installPeakMiB: 4096, diskMiB: 6144 });
Object.assign(recipes.unturned, { peakMiB: 4096, installPeakMiB: 3072, diskMiB: 16384 });
const ids = value('--games') ? value('--games').split(',') : Object.keys(recipes);
for (const id of ids) if (!recipes[id]) throw Error('Unknown ported game: ' + id);
const inputs = ['runner.mjs', 'api-adapter.mjs', 'campaign-session.mjs', 'campaign-adapter.mjs', 'game-checks.mjs'].map(n => prefix + n);
inputs.push(...['campaign-native-20261029.mjs', 'batch-queue.mjs', 'campaign-resource-guard-20261029.mjs'].map(n => resolve(root, 'tools/runtime', n)));
const config = {
  campaignRoot: resolve(root), build: receipt.binary_sha256, output: '.local/validator-campaign', maxInstallers: 4,
  session: prefix + 'campaign-session.mjs', monitor: prefix + 'campaign-session.mjs',
  policy: { maxParallel: 16, reserveMiB: 8192, reserveDiskMiB: 32768, maxCpuBusy: 0.9, pollMs: 3000, admissionWaitMs: 60000 },
  games: ids.map(id => ({ id, admissionMiB: 64, ...recipes[id], adapter: prefix + 'campaign-adapter.mjs', checksModule: prefix + (jc3mp[id]?'jc3mp-checks.mjs':wurm[id]?'wurm-checks.mjs':onset[id]?'onset-checks.mjs':trackmania[id]?'trackmania-checks.mjs':nuclear[id]?'nuclear-checks.mjs':lac[id] ? 'lac-checks.mjs' : crossplay[id] ? 'crossplay-checks.mjs' : l4d[id] ? 'l4d-checks.mjs' : openworld[id] ? 'rimworld-openworld-checks.mjs' : together[id] ? 'rimworld-together-checks.mjs' : pnx[id] ? 'pnx-checks.mjs' : bedrockVanilla[id] ? 'bedrock-vanilla-checks.mjs' : vintagestory[id] ? 'vintagestory-checks.mjs' : pocketmine[id] ? 'pocketmine-checks.mjs' : gomint[id] ? 'gomint-checks.mjs' : nukkit[id] ? 'nukkit-checks.mjs' : ksp[id] ? 'ksp-checks.mjs' : cs2[id] ? 'cs2-checks.mjs' : rehlds[id] ? 'rehlds-checks.mjs' : fof[id] ? 'fof-checks.mjs' : gtac[id] ? 'gtac-checks.mjs' : sven[id] ? 'sven-checks.mjs' : zandronum[id] ? 'zandronum-checks.mjs' : amongUs[id] ? 'among-us-checks.mjs' : valheim[id] ? 'valheim-checks.mjs' : unturned[id] ? 'unturned-checks.mjs' : openra[id] ? 'openra-checks.mjs' : stk[id] ? 'stk-checks.mjs' : hl2dm[id] ? 'hl2dm-checks.mjs' : soldat[id] ? 'soldat-checks.mjs' : ddnet[id] ? 'ddnet-checks.mjs' : ss14[id] ? 'ss14-checks.mjs' : barotrauma[id] ? 'barotrauma-checks.mjs' : quake[id] ? 'quake-live-checks.mjs' : legacy[id] ? 'legacy-checks.mjs' : id === 'luanti' ? 'luanti-checks.mjs' : ['teeworlds', 'cs2d', 'openarena', 'xonotic'].includes(id) ? 'arena-checks.mjs' : 'game-checks.mjs'), inputs, timeoutMs: id === 'cs2' ? 7200000 : 1200000, installTimeoutMs: id === 'cs2' ? 6600000 : 600000, scope: 'Canonical install and operator API/native lifecycle; no player/WAN claim' })),
};
for (const game of config.games) game.inputs = [...new Set([...inputs, game.checksModule, ...(game.family==='jc3mp'?[prefix+'jc3mp-canonical-check.mjs']:[]), ...(game.family==='wurm'?[prefix+'wurm-canonical-check.mjs']:[]), ...(game.family==='onset'?[prefix+'onset-canonical-check.mjs']:[]), ...(game.family==='nuclear'?[prefix+'nuclear-canonical-check.mjs']:[]), ...(game.family==='trackmania'?[prefix+'trackmania-canonical-check.mjs']:[]), ...(game.family==='lac'?[prefix+'lac-canonical-check.mjs']:[]), ...(game.family === 'crossplay' ? [prefix + 'crossplay-canonical-check.mjs', prefix + 'canonical-request.mjs'] : [])])];
for (const id of value('--refresh-installers')?.split(',') ?? []) {
  const game = config.games.find(g => g.id === id);
  if (!game) throw Error('Installer refresh must name a selected game: ' + id);
  game.refreshInstaller = true;
}
for (const game of config.games.filter(g => g.family === 'zandronum')) game.inputs.push(resolve(root, 'tools/game-query/id-family.mjs'), resolve(root, 'internal/panel/game_library/scripts/zandronum-huffman.py'));
for (const game of config.games.filter(g => args.includes('--retention') || value('--retention-games')?.split(',').includes(g.id))) {
  if (!['jc3mp','wurm','onset','trackmania','nuclear','lac', 'minecraft', 'crossplay', 'l4d', 'l4d2', 'xonotic', 'luanti', 'etlegacy', 'assaultcube', 'quakelive', 'barotrauma', 'soldat', 'ddnet', 'ss14', 'hl2dm', 'openra', 'stk', 'unturned', 'crewlink', 'impostor', 'valheim', 'zandronum', 'sven', 'gtac', 'fof', 'cs2', 'rehlds', 'ksp_dmp', 'ksp_lmp', 'nukkit', 'pocketmine', 'gomint', 'vintagestory', 'pnx', 'bedrock_vanilla', 'rimworld_together', 'rimworld_openworld'].includes(game.family)) throw Error('No retention adapter for this family');
  game.retentionOnly = true;
  game.scope = 'Targeted canonical reinstall retention and native reload; prior lifecycle evidence remains in history; recipe UI not claimed';
}
for (const game of config.games.filter(g => !g.retentionOnly)) {
  let prior;
  try { prior = JSON.parse(await readFile(resolve(config.output, game.id + '.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prior?.build === config.build && prior.fixture?.recipe === game.recipe
    && prior.fixture.install?.rawExit === '0' && prior.fixture.install.callback?.success === true) {
    game.originalInstallDiskMiB = game.diskMiB;
    game.diskMiB = Math.min(game.diskMiB, 4096);
    game.diskReservationScope = 'Additional growth for a retained successful install; existing bytes already reduce measured host/VM free disk';
  }
}
await mkdir(config.output, { recursive: true });
await writeFile(resolve(config.output, 'manifest.json'), JSON.stringify(config, null, 2));
const results = await runQueue(config, { retry: value('--retry')?.split(',') ?? [] });
for (const { game, status, action, checks } of results) console.log(JSON.stringify({ game, status, action, passedChecks: checks?.filter(x => x.status === 'PASS').length, report: resolve(config.output, game + '.json') }));
process.exitCode = results.some(r => r.status !== 'PASS') ? 1 : 0;
