// Scoped driver generation only; never acquires a lease or mutates API state.
import fs from 'node:fs';
for(const part of ['create','install','observe','source','cleanup']){
 let body=fs.readFileSync('tools/runtime/romestead-native-'+part+'.mjs','utf8').replaceAll('romestead-native','solace-native').replaceAll('Romestead','Solace').replaceAll('unreal_survival','game_batch_inventory').replaceAll('crafting-native-v1','solace-fantasy-worlds-v1');
 if(part==='create')body=body.replace("path='romestead/egg-romestead.json'","path='solace_crafting/egg-solace-crafting.json'").replace('profile.required_ports!==1','profile.required_ports!==2').replaceAll('memory_mib:4096','memory_mib:2048').replace('ports:1','ports:2').replace("game:'romestead'","game:'solace'").replace("{WORLD_NAME:'Voltra Solace native',WORLD_SIZE:'1',MAX_PLAYERS:'2',CHEATS:'false',PASSWORD:s.test_password}","{AUTO_UPDATE:'0',VOLTRA_STEAM_AUTO_UPDATE:'0',QUERY_PORT:String(s.ports[1])}").replace('additional:[]','additional:s.allocation_ids.slice(1)').replace('memory:4096','memory:2048').replace('allocations:0','allocations:1');
 if(part==='install')body=body.replace("!profile.egg.startup.endsWith('crafting_runtime.py')","!profile.egg.startup.endsWith('fantasy_worlds_runtime.py solace')");
 fs.writeFileSync('tools/runtime/solace-native-'+part+'.mjs',body,{flag:'wx'});
}
console.log('Prepared five scoped drivers; no resource or acquisition mutation.');
