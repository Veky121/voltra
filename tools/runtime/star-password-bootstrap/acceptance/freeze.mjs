// MIT. Offline freeze only: harmless Python children, never Wine/game/controller.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../../..');
const python='C:/Users/Veky/AppData/Local/Python/pythoncore-3.15-64/python.exe';
const result=spawnSync(python,[path.join(here,'test_fixture.py')],{cwd:root,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:1048576});
if(result.status!==0||result.error)throw Error(result.stderr||String(result.error));
let linux=null;
if(process.argv.includes('--linux-offline')){
  const linuxRoot=root.replaceAll('\\','/').replace(/^([A-Za-z]):/,(_,drive)=>'/mnt/'+drive.toLowerCase());
  const run=spawnSync('wsl.exe',['-d','Ubuntu','--cd',linuxRoot,'--','python3','tools/runtime/star-password-bootstrap/acceptance/test_fixture.py'],{cwd:root,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:1048576});
  if(run.status!==0||run.error)throw Error(run.stderr||String(run.error));
  linux={platform:'existing_local_Ubuntu_WSL',tests:(run.stdout+run.stderr).trim(),wine_or_game_executed:false,resources_created:false};
}
const names=['fixture.py','fixture-pins.json','test_fixture.py','README.md','freeze.mjs','acquire.py','native-controller.mjs','native-once.py','inspect-payload.py'];
const syntax=spawnSync(process.execPath,['--check',path.join(here,'native-controller.mjs')],{windowsHide:true,encoding:'utf8',timeout:10000});
if(syntax.status!==0||syntax.error)throw Error(syntax.stderr||String(syntax.error));
const source=names.map(name=>path.join(here,name));
source.push(path.join(here,'../prepare.py'),path.join(here,'../main.lua'),path.join(root,'internal/panel/game_library/scripts/steam-template.py'));
for(const name of ['ocean-space-servers','additional-survival-install','native-config','native-console','private-wine-prerequisites','steam-native-next','native-release'])source.push(path.join(root,'internal/panel/game_library/scripts/'+name+'.py'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const files=source.map(file=>{const body=fs.readFileSync(file);return{path:path.relative(root,file).replaceAll('\\','/'),bytes:body.length,sha256:sha(body)};});
const stage=path.join(root,'.local/star-password-bootstrap/acceptance/source');fs.mkdirSync(stage,{recursive:true});
for(const name of names)fs.copyFileSync(path.join(here,name),path.join(stage,name));
const receipt={phase:'source_only_offline_fixture_freeze',files,tests:(result.stdout+result.stderr).trim(),linux,
  freeze_invoked_game_acquisition:false,freeze_invoked_game_or_loader:false,freeze_claimed_resources:false,production_gates_changed:false,
  runtime_authoritative_receipt:'.local/star-native-acceptance/receipt.json',
  native_encrypted_files_verified:false,windows_posix_staging_mocked_for_orchestration_only:true,
  prior_go_probe_failures_preserved:true,requires_separate_native_approval:true};
fs.writeFileSync(path.join(root,'artifacts/star-password-bootstrap-acceptance-source.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({phase:receipt.phase,files:files.length,tests:receipt.tests,stage:path.relative(root,stage)}));
