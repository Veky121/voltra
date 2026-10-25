import fs from 'node:fs';
for(const part of ['create','install','observe','source','cleanup']){
 let b=fs.readFileSync('tools/runtime/'+(part==='cleanup'?'romestead':'onset')+'-native-'+part+'.mjs','utf8').replaceAll('onset-native','jc3-native').replaceAll('romestead-native','jc3-native').replaceAll('Onset','JC3MP').replaceAll('Romestead','JC3MP').replaceAll('unreal_survival','game_batch_inventory');
 if(part==='create')b=b.replace("path='onset/egg-onset.json'","path='just_cause/just_cause_3/egg-j-c3-m-p.json'").replace('profile.consecutive_primary_offset!==2','profile.required_ports!==4').replace('disk_mib:8192','disk_mib:4096').replace('ports:3','ports:4').replace("game:'onset'","game:'jc3'").replaceAll('Voltra JC3MP native Å¾','Voltra private JC3MP').replace('default:s.allocation_ids[2],additional:s.allocation_ids.slice(0,2)','default:s.allocation_ids[0],additional:s.allocation_ids.slice(1)').replace('disk:8192','disk:4096').replace('allocations:2','allocations:3').replace('primary:s.ports[2]','primary:s.ports[0]');
 if(part==='install')b=b.replace("endsWith('run onset')","endsWith('run jc3')");
 fs.writeFileSync('tools/runtime/jc3-native-'+part+'.mjs',b,{flag:'wx'});
}
console.log('Prepared five unique drivers; no resource acquisition.');
