import fs from 'node:fs';
const base='tools/runtime/';
for(const n of ['create','archive','metadata','metadata-review','source','observe','live','install','crash-policy-read']){
 let s=fs.readFileSync(base+'craftopia-native-'+n+'.mjs','utf8').replaceAll('craftopia/egg-craftopia.json','mordhau/egg-mordhau.json').replaceAll('craftopia-native','mordhau-native').replaceAll('Craftopia','Mordhau').replaceAll('craftopia','mordhau').replaceAll('1670340','629800').replaceAll('crafting-native-v1','mordhau-native-v1');
 if(n==='create'){
  s=s.replaceAll('profile.required_ports!==1','profile.required_ports!==3').replaceAll('disk_mib:32768,ports:1','disk_mib:24576,ports:3').replaceAll('disk:32768','disk:24576');
  s=s.replace("s.world_name='VoltraMordhau'+s.request_id.slice(0,8);save();Object.assign(environment,{WORLD_NAME:s.world_name});","s.server_name='Voltra Mordhau '+s.request_id.slice(0,8);save();Object.assign(environment,{SERVER_NAME:s.server_name,QUERY_PORT:String(s.ports[1]),BEACON_PORT:String(s.ports[2])});");
 }
 if(n==='install')s=s.replace("!profile.egg.startup.endsWith('crafting_runtime.py')","!profile.egg.startup.endsWith('run mordhau')");
 fs.writeFileSync(base+'mordhau-native-'+n+'.mjs',s,{flag:'wx'});
}
console.log('Unique Mordhau guarded drivers prepared; not executed');
