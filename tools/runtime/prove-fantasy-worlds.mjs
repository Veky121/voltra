import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=process.cwd(),dir='.local/fantasy-worlds';
fs.mkdirSync(dir,{recursive:true});
function command(exe,args){
 const result=spawnSync(exe,args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024,timeout:60000});
 if(result.error||result.status!==0)throw Error((result.stdout||'')+(result.stderr||'')+(result.error||''));
 return (result.stdout||'')+(result.stderr||'');
}
command(process.execPath,['--max-old-space-size=192','tools/runtime/stage-fantasy-worlds.mjs']);
const proof=command(process.execPath,['--max-old-space-size=192','tools/runtime/test-fantasy-worlds.mjs']);
const scripts=path.join(root,'internal/panel/game_library/scripts').replaceAll('\\','/');
const fixture=path.join(root,'tools/runtime/test-fantasy-worlds.py').replaceAll('\\','/');
const tests=command('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--cpus','1','--read-only','--tmpfs','/tmp:rw,size=64m','-e','PYTHONDONTWRITEBYTECODE=1','-v',scripts+':/scripts:ro','-v',fixture+':/test.py:ro','python:3.13-slim','python','/test.py']);
fs.writeFileSync(dir+'/source-proof.log',proof+tests);
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const profiles=JSON.parse(fs.readFileSync(dir+'/profiles.json'));
const hashes=JSON.parse(fs.readFileSync(dir+'/source-hashes.json'));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files=['tools/runtime/stage-fantasy-worlds.mjs','tools/runtime/test-fantasy-worlds.mjs','tools/runtime/test-fantasy-worlds.py','tools/runtime/prove-fantasy-worlds.mjs','tools/runtime/fantasy-worlds.md',...Object.keys(hashes).filter(x=>x.startsWith('fantasy-worlds')).map(x=>'internal/panel/game_library/scripts/'+x)];
const image='ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8';
const history=command('docker',['history','--no-trunc',image,'--format','{{.CreatedBy}}']);
fs.writeFileSync(dir+'/pinned-runtime-history.log',history);
if(!history.includes('xvfb xauth python3'))throw Error('Pinned runtime Python/display package evidence changed');
const receipt={schema_version:1,checked_at:new Date().toISOString(),scope:'source_only',frozen:true,profiles:Object.keys(profiles),verification:'not_verified',native_acceptance:false,
 tests:{python_fixtures:34,result:'pass',source_parity:proof.trim(),utility_limits:{memory_mib:256,network:'none',cpus:1,tmpfs_mib:64,read_only:true,pull:'never'},log:dir+'/source-proof.log'},
 source:{repository:catalog.repository,revision:catalog.revision,license:'internal/panel/game_library/upstream/LICENSE',original_sha256:Object.fromEntries(Object.entries(profiles).map(([p,v])=>[p,v.upstream_sha256])),embedded_sha256:hashes,owned_files_sha256:Object.fromEntries(files.map(file=>[file,sha(file)])),stage_sha256:sha(dir+'/profiles.json')},
 provenance:{
  portal:{url:'https://steamcommunity.com/app/374040/discussions/0/3377008022019727254/',author:'AnimatedAnt_505, developer',scope:'Licensed client zip, configuration fields, role permissions, native save directory and hidden-console limitation. Old publisher documentation is not current-depot or Wine acceptance.',html_sha256:sha(dir+'/portal-publisher.html')},
  solace:{url:'https://steamcommunity.com/app/670260/discussions/0/1651045226215951009/',author:'Malkere, developer',scope:'Historical servercfg.dat/world layout and native control descriptions. This 2019 post marks several administrator/password controls inactive. Current support is not proved; values are preserved unchanged.'},
  citadel:{url:'https://steamcommunity.com/app/487120/discussions/0/1471967529574156952/',author:'fatguy1121, community author, pinned guide',scope:'Historical supporting port/INI/save documentation; not represented as a publisher implementation or current-depot proof. Original pinned MIT catalog is the source of control defaults and installation AppID.'},
  wine_console:{license:'MIT, own scoped derivative of existing source-wine-console.c',source_sha256:hashes['fantasy-worlds-wine-console.c'],build:'No PE compiled or executed in this batch. Future installer uses signed Ubuntu APT MinGW, records actual compiler package versions plus source/binary hashes, verifies PE32 architecture before use.',target:'Only Z:\\home\\container\\dedicated_server\\pk_dedicated_server.exe; numeric owned Wine PID. Commands and Ctrl+C travel through stdin, never argv.'},
  runtime:{image,history_sha256:sha(dir+'/pinned-runtime-history.log'),evidence:'Existing local immutable Docker image metadata/history only, no image pull/container startup. Image build installs python3/xvfb/xauth and Wine stable.'}
 },
 original_controls:19,approved_behavior_deltas:[
  'Portal STEAM_USER/STEAM_PASS required rules become required_if:PORTAL_INSTALL_MODE,steam. All original defaults, visibility, editability and other metadata remain unchanged. Uploaded mode needs no dummy credentials and never invokes Steam.',
  'Portal hideConsoleWindow becomes false inside a private owned Xvfb display so exact-process console input and Ctrl+C can be attempted. No shared wineserver termination. Native Windows API/save semantics remain unverified.',
  'Original destructive configuration overwrites are replaced by private configuration/world retention and section-specific typed serializers. Portal third-party paste configuration download is removed.',
  'Citadel locked QPORT=27015 remains unchanged and requires its own selected allocation. Solace gains optional QUERY_PORT. All recipes disable image-wide Xvfb through a hidden fixed XVFB=0 control.'
 ],
 limits:[
  'No game/runtime binaries downloaded. No game, Wine, SteamCMD or native server launched. No native lease, live API/DB mutations, service changes, production builds or canonical overrides edits.',
  'Steam private credential transport is unproved and fails closed in Steam mode before operator-state writes/processes. Portal paid-client entitlement must not be inferred from its public AppID. Uploaded mode requires operator-owned legal publisher files.',
  'Native installation/depot layout, current binary compatibility, process discovery, console input, Ctrl+C/save completion, network protocols/listing/client joins and persistence remain unverified for all three games.',
  'Solace original native access/administrator/moderator/restart controls are retained in Files, including historically unsupported settings. No claim they function in current publisher native builds.',
  'Operator-state symlinks fail closed except exact documented Citadel Config links. Archive program collisions fail closed. Existing native mods/configuration remain operator-owned; compatibility is not inferred.',
  'Memory/disk defaults are unmeasured setup estimates. Original publisher and dependency license obligations remain; no proprietary client/module assets are bundled.'
 ]};
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/fantasy-worlds-source-acceptance.json',JSON.stringify(receipt,null,2)+'\n');
console.log('FROZEN: 3 source-only profiles; 34 offline fixtures + original-control/source parity PASS. '+receipt.source.stage_sha256);
