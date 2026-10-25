// Reconcile the single failed POST; never create or start another server.
import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api,rows} from './openttd-compat-node.mjs';
const dir='.local/romestead-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),n=JSON.parse(fs.readFileSync(s.node_receipt));
if(s.owner!=='unreal_survival'||s.node!==n.node||s.node_uuid!==n.node_uuid)throw Error('Foreign receipt');
const found=rows(await api('/api/application/servers')).filter(v=>v.external_id==='romestead-native-'+s.request_id);
if(found.length!==1)throw Error('Expected exactly one same-request APIrecord, found'+found.length);
const v=found[0];if(v.node!==s.node||v.egg!==s.egg_id||v.name!=='Voltra isolated Romestead acceptance')throw Error('Foreign resource');
if(s.uuid&&s.uuid!==v.uuid)throw Error('Receipt identity changed');
Object.assign(s,{uuid:v.uuid,internal_id:v.id,identifier:v.identifier});fs.writeFileSync(dir+'/private.json',JSON.stringify(s,null,2)+'\n',{mode:0o600});
const i=spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'});let state=null;if(!i.status)state=JSON.parse(i.stdout)[0].State;
fs.writeFileSync(dir+'/first-create-failure.json',JSON.stringify({phase:'first creation POST',http_status:502,uuid:s.uuid,server:s.internal_id,node:s.node,status:v.status,state,at:new Date().toISOString(),retry:false},null,2)+'\n');
const p=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[s.path];fs.writeFileSync(dir+'/source-profile.json',JSON.stringify(p,null,2)+'\n',{flag:'wx'});console.log({server:s.internal_id,uuid:s.uuid,status:v.status,state});
