import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const dir='.local/citadel-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),watch=JSON.parse(fs.readFileSync(dir+'/reload-watch-resumed.json'));
const inspected=spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'});if(inspected.status)throw Error('Owned container unavailable');
const info=JSON.parse(inspected.stdout)[0];if(info.State.Running||info.State.StartedAt!==watch.started_at||watch.uuid!==s.uuid||s.owner!=='game_batch_inventory')throw Error('Generation mismatch');
const logs=spawnSync('docker',['logs','--since',watch.started_at,s.uuid],{windowsHide:true,encoding:'utf8',maxBuffer:6e6});
if(logs.status)throw Error('Generation log read failed');
fs.writeFileSync(dir+'/reload-terminal-generation.log',(logs.stdout??'')+(logs.stderr??''),{flag:'wx'});
console.log({generation_started_at:watch.started_at,raw_exit:info.State.ExitCode,terminal_log_saved:true});
