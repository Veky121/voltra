import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const game=process.argv[2];if(!['dmp','lmp'].includes(game))throw Error('dmp|lmp');const dir='.local/ksp-games/'+game,s=JSON.parse(fs.readFileSync(dir+'/private.json'));
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;if(server.uuid!==s.uuid||server.node!==202)throw Error('Owned KSP identity mismatch');
const inspect=spawnSync('docker',['inspect',s.uuid],{encoding:'utf8'}),info=inspect.status===0?JSON.parse(inspect.stdout)[0]:null;
const native=spawnSync('docker',['logs','--tail','100',s.uuid],{encoding:'utf8'}),installer=spawnSync('docker',['logs','--tail','18',s.uuid+'_installer'],{encoding:'utf8'});
const clean=value=>{for(const secret of s.passwords||[])value=value.replaceAll(secret,'[REDACTED]');return value;};
const logs=clean(native.stdout+native.stderr),proof={uuid:s.uuid,game,status:server.status,container:info?.State??null,native_ready:logs.includes(game==='dmp'?'Ready!':'All systems up and running'),logs,installer_tail:installer.status===0?clean(installer.stdout+installer.stderr).slice(-2200):'not present',observed_at:new Date().toISOString()};
fs.writeFileSync(dir+'/observation.json',JSON.stringify(proof,null,2)+'\n');console.log({...proof,logs:proof.logs.slice(-2400)});
