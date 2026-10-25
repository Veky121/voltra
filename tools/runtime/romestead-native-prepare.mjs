// Source-only driver preparation. Does not create API resources or acquire files.
import fs from 'node:fs';
for(const part of ['create','install','observe','source','read']){
 let body=fs.readFileSync('tools/runtime/onset-native-'+part+'.mjs','utf8').replaceAll('onset-native','romestead-native').replaceAll('Onset','Romestead').replaceAll('open-world-servers-v1','crafting-native-v1');
 if(part==='create')body=body.replace("path='onset/egg-onset.json'","path='romestead/egg-romestead.json'").replace("profile.consecutive_primary_offset!==2","profile.required_ports!==1").replace('memory_mib:1024','memory_mib:4096').replace('ports:3','ports:1').replace("game:'onset'","game:'romestead'").replace("{PUBLIC_SERVER:'false',SERVER_NAME:'Voltra Romestead native ž',AUTO_UPDATE:'0'}","{WORLD_NAME:'Voltra Romestead native',WORLD_SIZE:'1',MAX_PLAYERS:'2',CHEATS:'false'}").replace('default:s.allocation_ids[2],additional:s.allocation_ids.slice(0,2)','default:s.allocation_ids[0],additional:[]').replace('memory:1024','memory:4096').replace('allocations:2','allocations:0').replace('primary:s.ports[2]','primary:s.ports[0]');
 if(part==='install')body=body.replace("!profile.egg.startup.endsWith('run onset')","!profile.egg.startup.endsWith('crafting_runtime.py')");
 if(part==='read')body=body.replace("server_config.json","config.json").replace("config.pop('password','')","config.pop('Password','')").replace("'package_files':[str(p.relative_to(r)) for p in (r/'packages').rglob('*') if p.is_file()]","'save_files':[str(p.relative_to(r)) for name in ['saved_worlds','worlds','saves','.local/share'] for p in (r/name).rglob('*') if p.is_file()]");
 fs.writeFileSync('tools/runtime/romestead-native-'+part+'.mjs',body,{flag:'wx'});
}
console.log('Prepared5 scoped drivers; no acquisition/resources started.');
