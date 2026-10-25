import fs from 'node:fs';import assert from 'node:assert/strict';import {api} from './openttd-compat-node.mjs';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/jc3-native',{receipt:s}=await ownedStoppedServer(dir+'/private.json');if(s.owner!=='game_batch_inventory'||s.path!=='just_cause/just_cause_3/egg-j-c3-m-p.json')throw Error('Foreign fixture');
const proposed=JSON.parse(fs.readFileSync('.local/jc3-native-source/profiles.json'))[s.path],canonical=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[s.path];assert.deepEqual(canonical,proposed,'Root canonical merge required');
const marker=dir+'/image-change.json';if(fs.existsSync(marker))throw Error('Image update already submitted');
const before=(await api('/api/application/servers/'+s.internal_id)).attributes;const image=Object.values(canonical.egg.docker_images)[0];
await api('/api/admin/eggs/'+s.egg_id+'/import','POST',canonical.egg);await api('/api/application/servers/'+s.internal_id+'/startup','PATCH',{image,environment:{}});
const after=(await api('/api/application/servers/'+s.internal_id)).attributes;if(after.container.image!==image||before.uuid!==after.uuid)throw Error('Actual image update mismatch');
fs.writeFileSync(dir+'/source-profile-compatible.json',JSON.stringify(canonical,null,2)+'\n',{flag:'wx'});fs.writeFileSync(marker,JSON.stringify({uuid:s.uuid,before:before.container.image,after:after.container.image,at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});console.log({uuid:s.uuid,image,updated:true});
