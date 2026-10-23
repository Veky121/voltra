import fs from 'node:fs';
import {createHash} from 'node:crypto';

const mapping=JSON.parse(fs.readFileSync('artifacts/managed-steam-bridge-mapping.json','utf8'));
const evidence={
 MAX_PLAYERS:['Native process reads requested limit','Satisfactory QueryServerState / 7Days filtered getgamepref confirms value'],
 AUTO_UPDATE:['Runtime image AUTO_UPDATE=0','Managed off/on_start settings change actual source job selection; no duplicate image updater'],
 SRCDS_APPID:['Installed native appmanifest StateFlags4, requested app ID and exact publisher build'],
 SRCDS_BETAID:['Publisher target branch metadata agrees with installed build','A password-free alternate branch is exercised only if publisher exposes a suitable branch'],
 GAME_DIFFICULTY:['7Days filtered native getgamepref GameDifficulty agrees with preserved XML'],
 LD_LIBRARY_PATH:['Actual Docker/process environment retains requested game path and required Steam SDK paths'],
 PASSWORD:['Real private console authenticates through the shipped rcon configuration client','One wrong-password attempt fails; credential absent from argv/env/API/audit/artifacts'],
 TELNET_PORT:['Native PID owns configured private listening socket','Port is not published; Wings console and shutdown use that socket'],
 SERVER_DISABLED_NETWORK_PROTOCOLS:['Native preference and protocol startup logs agree with requested XML','Restore original protocol setting and demonstrate successful restart'],
 VALIDATE:['Source node advertises steam-options-v1; actual mutation invokes validate when requested','Verify always validates; public no-validation update remains available'],
 NUM_AUTOSAVES:['Preserved Engine.ini sets requested rotating-autosave count','Running world generates rotating autosaves within a bounded observation window; compare active native options if exposed'],
 INIT_CONNECT_TIMEOUT:['Native process loads requested Engine.ini section/key','Runtime reflected option/log evidence if publisher exposes it; config-only evidence is labelled explicitly'],
 CONNECT_TIMEOUT:['Native process loads requested Engine.ini section/key','Runtime reflected option/log evidence if publisher exposes it; config-only evidence is labelled explicitly'],
 SRCDS_BETAPASS:['Explicitly unavailable: private capability unadvertised; both executors fail before side effects','Native parser codec fidelity remains unresolved; no private-branch readiness claim'],
 RELIABLE_PORT:['Distinct requested allocations match native TCP socket owner and advertised endpoint','Stopped change plus restart moves both ReliablePort and ExternalReliablePort consistently'],
};
const files=['internal/panel/steam_catalog_bridge.go','internal/panel/steam_catalog_state.go','internal/panel/steam_catalog_console_assets.go','internal/panel/managed_console_assets/manifest.json','internal/panel/steam_games.go','internal/panel/steam.go','internal/panel/game_sevendays.go','internal/panel/game_quick_setup.go','internal/steamapi/types.go','internal/steamapi/profiles.go','internal/steamexec/executor.go','internal/steamexec/docker.go','internal/nodeagent/steam.go'];
const source=Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const plan={schema_version:1,created_at:new Date().toISOString(),state:'checklist_only_runtime_receipts_authoritative',source_sha256:source,
 runtime_boundary:{existing_panel:'Main :8088 unchanged; fixture builds current source instead of refreshing it',existing_node:202,missing_existing_runtime:['Latest reviewed console artifact and power-lock correction in main binary','node202 managed Steam connector','steam-options-v1'],fixture_schema:'infraTestApp random schema, no public/live migration',proposed_panel_port:18098,proposed_wings_port:18191,proposed_sftp_port:12131,new_processes_require_owner_coordination:true,new_credentials:'Generated only for isolated schema/processes; no existing credential changes',shared_pool:'One active weighted queue lease per native game, including control-process overhead',refresh_existing_services:false},
 games:mapping.games.map(game=>({path:game.path,managed_game:game.managed_game,verification:'not_verified',lease:{owner:'managed_steam_bridge',memory_mib:game.managed_game==='7days'?9216:13312,disk_mib:game.managed_game==='7days'?33280:20992,ports:game.managed_game==='7days'?4:2},controls:game.controls.map(control=>({...control,native_evidence_required:evidence[control.environment]??(()=>{throw Error('Missing native evidence contract '+control.environment)})()})),common_checks:['Fresh unique server volume and original first install attempt recorded separately from repair/development attempts','Actual game PID and socket ownership; job completion is not readiness','Real saved world/session and exact marker persists through stopped verify/update and restart','Record native build, source hashes, container image IDs, sampled file contents/mode/UID/GID','Final native stop and receipt-owned cleanup before fixture schema removal','No real client gameplay, load, public listing or arbitrary branches inferred']}))};
if(plan.games.reduce((n,g)=>n+g.controls.length,0)!==19)throw Error('Original control checklist changed');
fs.writeFileSync('artifacts/managed-steam-native-acceptance-plan.json',JSON.stringify(plan,null,2)+'\n');
console.log('Updated 19-control checklist only; existing runtime receipts remain authoritative');
