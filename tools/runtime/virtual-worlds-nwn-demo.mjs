import fs from 'node:fs';import crypto from 'node:crypto';import {api} from './openttd-compat-node.mjs';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/virtual-worlds/nwn',{receipt}=await ownedStoppedServer(dir+'/private.json');
if(!fs.existsSync(dir+'/installed-before-boot-proof.json'))throw Error('Exact installed source proof is required before fixture writes');
const provenance=JSON.parse(fs.readFileSync('.local/virtual-worlds/demo-provenance.json'));
if(provenance.commit!=='b1822f0781083aacd166929c8794d9d0e7f7c18c')throw Error('Unapproved demo revision');
const prefix='/api/client/servers/'+receipt.identifier+'/files';
await api(prefix+'/create-folder','POST',{root:'/',name:'user'});
await api(prefix+'/create-folder','POST',{root:'/user',name:'modules'});
for(const[name,destination]of[['DockerDemo.mod','/user/modules/DockerDemo.mod'],['LICENSE','/user/modules/DockerDemo-LICENSE.txt']]){
 const bytes=fs.readFileSync('.local/virtual-worlds/'+name),expected=provenance.files.find(f=>f.name===name);
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw Error('Demo fixture digest mismatch');
 const r=await fetch('http://127.0.0.1:8088'+prefix+'/write?file='+encodeURIComponent(destination),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:bytes});
 await r.text();if(!r.ok)throw Error('Owned fixture write failed HTTP '+r.status);
}
fs.writeFileSync(dir+'/demo-provenance.json',JSON.stringify({...provenance,uuid:receipt.uuid,uploaded_at:new Date().toISOString()},null,2));
console.log({uuid:receipt.uuid,module:'MIT DockerDemo.mod',phase:'uploaded fixture only; no game start'});
