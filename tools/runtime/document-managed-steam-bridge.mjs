import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const paths={'7_days_to_die/egg-7-days-to-die.json':'7days','satisfactory/egg-satisfactory.json':'satisfactory'};
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const mapping={
 '7days':{
  MAX_PLAYERS:'serverconfig.xml ServerMaxPlayerCount; existing managed max_players and Quick setup',
  GAME_DIFFICULTY:'serverconfig.xml GameDifficulty; existing Quick setup field',
  SRCDS_APPID:'Managed Steam app294420; fixed per-game preservation policy',
  AUTO_UPDATE:'Managed Steam mode on_start/off; no image legacy updater',
  LD_LIBRARY_PATH:'Typed runtime environment; no shell interpolation',
  SRCDS_BETAID:'Managed Steam branch metadata, install/update/verify and exact target manifest',
  PASSWORD:'Encrypted private console credential; native XML plus local authenticated telnet bridge',
  TELNET_PORT:'Typed native console port; private loopback connection/readiness',
  SERVER_DISABLED_NETWORK_PROTOCOLS:'serverconfig.xml ServerDisabledNetworkProtocols; preserve unknown XML properties',
 },
 satisfactory:{
  AUTO_UPDATE:'Managed Steam mode on_start/off; no image legacy updater',
  VALIDATE:'With automatic startup updates enabled, validate before every start including current/cached builds; an update already validating files avoids duplicate validation. Off preserves startup; explicit verify remains unconditional.',
  MAX_PLAYERS:'Typed -ini:Game:[/Script/Engine.GameSession]:MaxPlayers startup override survives publisher deletion of Game.ini; conventional Game.ini key retained when settings are applied',
  NUM_AUTOSAVES:'FactoryGame/Saved/Config/LinuxServer/Engine.ini [/Script/FactoryGame.FGSaveSession] mNumRotatingAutosaves',
  INIT_CONNECT_TIMEOUT:'Engine.ini [/Script/OnlineSubsystemUtils.IpNetDriver] InitialConnectTimeout',
  CONNECT_TIMEOUT:'Engine.ini [/Script/OnlineSubsystemUtils.IpNetDriver] ConnectionTimeout',
  SRCDS_BETAID:'Managed branch metadata, install/update/verify and exact target manifest',
  SRCDS_BETAPASS:'Encrypted beta_password_encrypted schema and redaction implemented; private capability unadvertised and executor fails closed until native SteamCMD parser fidelity is proven',
  SRCDS_APPID:'Managed Steam app1690800; fixed per-game preservation policy',
  RELIABLE_PORT:'Distinct allocation on same address; -ReliablePort and -ExternalReliablePort; 0 retains managed auto-selection',
 },
};
const games=[];
for(const [path,id] of Object.entries(paths)){
 const entry=catalog.entries.find(entry=>entry.path===path);if(!entry)throw Error('Exact catalog path missing');
 const controls=entry.egg.variables.map(variable=>{const target=mapping[id][variable.env_variable];if(!target)throw Error('Unmapped original control '+variable.env_variable);return {environment:variable.env_variable,original_default:variable.default_value,translation:target};});
 games.push({path,managed_game:id,upstream_sha256:entry.sha256,controls,verification:'not_verified',implementation_scope:'Managed setup/startup/settings/config/runtime hooks and exact catalog metadata aliases reuse the shared Steam form, with isolated PostgreSQL/API and model fixtures. Private branch credentials explicitly unavailable pending native parser proof. Native acceptance pending; no inherited runtime verification.'});
}
const report={schema_version:1,generated_at:new Date().toISOString(),games,shared_components:['SteamSetupForm','GameQuickSetup','managed Steam node executor','existing XML patch/preservation','Wings console/files/lifecycle APIs'],managed_defaults_retained:['Public branch','Satisfactory reliable port chosen from actual allocations; imported8888 available when explicitly allocated/requested','7Days loopback telnet8081 with empty credential until configured','Existing managed settings and saves retained'],native_acceptance_remaining:['Fresh per-catalog bridge install','Every original control changes actual native state/configuration','Private console credential authentication and shutdown','Publisher branch/validate calls and credential redaction/persistence checks','Save/config preservation across verify/update/restart','Satisfactory server API/session/save and native reliable socket proof'],no_native_leases_or_downloads:true};
fs.writeFileSync('artifacts/managed-steam-bridge-mapping.json',JSON.stringify(report,null,2)+'\n');
if(process.argv.includes('--reserve'))for(const path of Object.keys(paths)){
 const result=spawnSync(process.execPath,['tools/runtime/batch-queue.mjs','reserve',JSON.stringify({owner:'managed_steam_bridge',game:path})],{encoding:'utf8',windowsHide:true});
 if(result.status)throw Error(result.stderr);console.log(result.stdout.trim());
}
console.log('Documented all '+games.reduce((sum,game)=>sum+game.controls.length,0)+' original controls; native verification remains pending');
