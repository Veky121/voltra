// Development-only helper replacement. Final acceptance must use a fresh installer.
import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const dir='.local/additional-survival/enshrouded',s=JSON.parse(fs.readFileSync(dir+'/private.json')),n=JSON.parse(fs.readFileSync(s.node_receipt));
if(s.uuid!=='ba182a4d-c955-4bb6-861b-a420f20e668e'||s.node!==202||(await api('/api/application/servers/'+s.internal_id)).attributes.status!==null)throw Error('Development candidate only');
const info=JSON.parse(spawnSync('docker',['inspect',s.uuid],{encoding:'utf8'}).stdout)[0];if(info.State.Running)throw Error('Stop development game first');
const source=fs.readFileSync('internal/panel/game_library/scripts/enshrouded-runtime.py','utf8')+'\n';
const script=`import pathlib,sys
target=pathlib.Path('/snapshot/.voltra/enshrouded_runtime.py')
assert target.resolve().is_relative_to(pathlib.Path('/snapshot').resolve())
target.write_bytes(sys.stdin.buffer.read())`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--read-only','--user',info.Config.User,'--memory','128m','--mount',`type=bind,source=${n.volume_root}/${s.uuid},target=/snapshot`,'python:3.13-slim','python3','-B','-c',script],{input:source,encoding:'utf8',timeout:30000});
if(result.status)throw Error(result.stderr);fs.writeFileSync(dir+'/development-helper-patch.json',JSON.stringify({uuid:s.uuid,manual_development_patch:true,fresh_installer_acceptance:false,observed_at:new Date().toISOString()},null,2));console.log({development_helper_replaced:true});
