import fs from 'node:fs';
for(const part of ['create','install','observe','source','cleanup','power']){
 let body=fs.readFileSync('tools/runtime/fortress-native-'+part+'.mjs','utf8')
  .replaceAll('fortress-native','citadel-native').replaceAll('FortressCraft','Citadel')
  .replaceAll('fortresscraft_evolved/egg-fortresscraft-evolved.json','citadel/egg-citadel-forged-with-fire.json')
  .replaceAll('fortress-typed-automation-v1','citadel-fantasy-worlds-v1');
 if(part==='create')body=body.replaceAll('memory_mib:4096','memory_mib:6144').replaceAll('memory:4096','memory:6144')
  .replace("game:'fortress'","game:'citadel'")
  .replace("{SERVER_NAME:'Voltra private Fortress',WORLDNAME:'VoltraAcceptance',MAX_PLAYERS:'3',PUBLIC:'false',AUTO_PAUSE:'false',AUTO_UPDATE:'0',RCON_PORT:String(s.ports[1]),RCON_PASSWORD:s.test_password}","{AUTO_UPDATE:'0',QPORT:String(s.ports[1]),ADMIN_PASSWD:s.test_password}");
 if(part==='install')body=body.replace("!profile.egg.startup.endsWith('automation-sims.py run fortress')","!profile.egg.startup.endsWith('fantasy_worlds_runtime.py citadel')");
 fs.writeFileSync('tools/runtime/citadel-native-'+part+'.mjs',body,{flag:'wx'});
}
console.log('Prepared six scoped Citadel drivers; no mutations.');
