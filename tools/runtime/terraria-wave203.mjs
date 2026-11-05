import fs from 'node:fs';
import * as c from './campaign-native-20261029.mjs';
const dir=c.root+'/artifacts/game-parity-20261029/wave203-terraria-settings';fs.mkdirSync(dir,{recursive:true});
const file=dir+'/state.json';let s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
const save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2));
const recipe='terraria/vanilla/egg-terraria-vanilla.json';
const r=await c.verifyRuntime();
if(process.argv[2]==='create'){
 if(s.lease)throw Error('Existing owned state; inspect or clean up before creating another fixture');
 const entry=JSON.parse(fs.readFileSync(r.snapshot+'/internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===recipe);
 const h=c.digest(recipe+':'+entry.sha256).slice(0,32),uuid=[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
 if((await c.api('/api/admin/eggs')).data.some(e=>e.attributes.uuid===uuid))throw Error('Canonical egg exists; do not mutate');
 s.lease=c.claimNativeUtility({task:'terraria_settings_identity',owner:'terraria_wave203',memory_mib:128,disk_mib:64,ports:1});save();
 s.slot=c.acquireInstaller(s.lease.lease_id,s.lease.owner);save();
 s.nest=(await c.api('/api/admin/nests','POST',{name:'Owned Terraria identity wave203',author:'campaign@localhost'})).attributes;save();
 const egg=structuredClone(c.profileFromRuntime(recipe,r).egg);s.original_egg=structuredClone(egg);s.beforehash=c.digest(JSON.stringify(egg));save();
 egg.uuid=uuid;
 s.egg=(await c.api('/api/admin/eggs/import','POST',{nest_id:s.nest.id,egg})).attributes;save();
 c.assertPortsFree(s.lease.ports);
 await c.api('/api/application/nodes/1/allocations','POST',{ip:'127.0.0.1',ports:s.lease.ports.map(String)});
 s.allocations=(await c.api('/api/application/nodes/1/allocations')).data.map(x=>x.attributes).filter(x=>s.lease.ports.includes(x.port));save();
 const options=(await c.api('/api/client/game-library/templates/'+c.digest(recipe).slice(0,16))).attributes;
 fs.writeFileSync(dir+'/easy-setup.json',JSON.stringify(options,null,2));
 s.server=(await c.api('/api/application/servers','POST',{name:'Owned Terraria API identity wave203',user:1,egg:s.egg.id,node_id:1,docker_image:Object.values(egg.docker_images)[0],startup:egg.startup,allocation:{default:s.allocations[0].id},limits:c.boundedBuild(s.lease),feature_limits:{allocations:0,databases:0,backups:0},environment:Object.fromEntries(options.variables.map(v=>[v.env_variable,v.default_value])),skip_scripts:true,start_on_completion:false})).attributes;save();
 console.log({server:s.server.uuid,egg:s.egg.uuid});
}
if(process.argv[2]==='probe'){
 const base='/api/client/servers/'+s.server.uuid;
 const response=await fetch('http://127.0.0.1:18099'+base+'/files/write?file=/serverconfig.txt',{method:'POST',body:'maxplayers=8\nmotd=Wave203 identity\nport='+s.lease.ports[0]+'\n'});if(!response.ok)throw Error('file seed '+response.status+' '+await response.text());
 for(const [name,route] of [['settings','/game-settings?file=/serverconfig.txt'],['startup','/startup']])fs.writeFileSync(dir+'/'+name+'.json',JSON.stringify(await c.api(base+route),null,2));
 console.log(fs.readFileSync(dir+'/settings.json','utf8'));
}
if(process.argv[2]==='cleanup'){
 if(s.server){if((await c.observePower(s)).current_state!=='offline')throw Error('Offline required');await c.api('/api/application/servers/'+s.server.id,'DELETE');s.server_removed=true;save();}
 for(const a of s.allocations||[])await c.api('/api/application/nodes/1/allocations/'+a.id,'DELETE');
 if(s.egg)await c.api('/api/admin/eggs/'+s.egg.id,'DELETE');if(s.nest)await c.api('/api/admin/nests/'+s.nest.id,'DELETE');
 if(c.containers().some(x=>x.Name.includes(s.server.uuid)))throw Error('Owned container remains');
 c.releaseInstaller(s.slot);c.releaseNative(s.lease.lease_id,s.lease.owner,'tested',true);s.cleaned=true;save();console.log('Owned fixture removed; lease released');
}
