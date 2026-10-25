import fs from 'node:fs';
for(const part of ['create','install','observe','source','power','installer-die']){
 let body=fs.readFileSync('tools/runtime/citadel-native-'+part+'.mjs','utf8')
  .replaceAll('citadel-native','aapg-native').replaceAll('Citadel','AAPG')
  .replaceAll('citadel/egg-citadel-forged-with-fire.json','americas_army/proving_grounds/egg-america-s-army--proving-grounds.json')
  .replaceAll('citadel-fantasy-worlds-v1','tactical-next-v1');
 if(part==='create')body=body.replaceAll('memory_mib:6144','memory_mib:4096').replaceAll('memory:6144','memory:4096')
  .replace('profile.required_ports!==2','profile.required_ports!==3').replace('ports:2','ports:3')
  .replace("game:'citadel'","game:'aapg'").replace('allocations:1','allocations:2')
  .replace("s.test_password=randomBytes(8).toString('hex');save();",'')
  .replace("{AUTO_UPDATE:'0',QPORT:String(s.ports[1]),ADMIN_PASSWD:s.test_password}","{SERVER_NAME:'Voltra isolated AAPG',AUTO_UPDATE:'0',QUERY_PORT:String(s.ports[1]),AUTH_PORT:String(s.ports[2])}");
 if(part==='install')body=body.replace("!profile.egg.startup.endsWith('fantasy_worlds_runtime.py citadel')","!profile.egg.startup.endsWith('tactical_next_runtime.py')");
 fs.writeFileSync('tools/runtime/aapg-native-'+part+'.mjs',body,{flag:'wx'});
}
console.log('Prepared seven AAPG-scoped drivers; no mutations.');
