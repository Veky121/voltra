import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const game=process.argv[2];if(!['banana','nuclear','puck'].includes(game))throw Error('Unknown game');const dir='.local/light-games-next/'+game,s=JSON.parse(fs.readFileSync(dir+'/private.json'));
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;if(server.uuid!==s.uuid||server.node!==202||server.egg!==s.egg_id)throw Error('Owned identity mismatch');
const clean=value=>{for(const secret of s.passwords||[])value=value.replaceAll(secret,'[REDACTED]');return value;};
const inspect=spawnSync('docker',['inspect',s.uuid],{encoding:'utf8',windowsHide:true});const logs=spawnSync('docker',['logs','--tail','90',server.status==='installing'?s.uuid+'_installer':s.uuid],{encoding:'utf8',windowsHide:true});
const state=inspect.status===0?JSON.parse(inspect.stdout)[0].State:null;const proof={uuid:s.uuid,status:server.status,state,logs:clean(logs.stdout+logs.stderr),at:new Date().toISOString()};fs.writeFileSync(dir+'/observation.json',JSON.stringify(proof,null,2)+'\n');console.log({...proof,logs:proof.logs.slice(-2600)});
