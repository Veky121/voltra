import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const dir='.local/virtual-worlds/nwn',s=JSON.parse(fs.readFileSync(dir+'/private.json'));
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(server.uuid!==s.uuid||server.node!==202||server.egg!==s.egg_id||server.external_id!=='virtual-worlds-nwn-'+s.request_id)throw Error('Owned fixture identity mismatch');
const inspect=name=>{let r=spawnSync('docker',['inspect',name],{windowsHide:true,encoding:'utf8'});return r.status===0?JSON.parse(r.stdout)[0].State:null;};
const name=server.status==='installing'?s.uuid+'_installer':s.uuid;
const logs=spawnSync('docker',['logs','--tail','100',name],{windowsHide:true,encoding:'utf8'});let output=logs.stdout+logs.stderr;for(const value of s.passwords)output=output.replaceAll(value,'[REDACTED]');
const proof={uuid:s.uuid,status:server.status,native:inspect(s.uuid),installer:inspect(s.uuid+'_installer'),logs:output,at:new Date().toISOString()};
fs.writeFileSync(dir+'/observation.json',JSON.stringify(proof,null,2));console.log({...proof,logs:proof.logs.slice(-3500)});
