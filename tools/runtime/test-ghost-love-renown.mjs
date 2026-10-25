import fs from 'node:fs';
import assert from 'node:assert/strict';
import {templatePortRanges,templateAdditionalPorts,templatePortEnvironment,templatePortsValid} from '../../web/src/client/gameTemplateModel.ts';
const profiles=JSON.parse(fs.readFileSync('.local/ghost-love-renown/profiles.json')),catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
let originals=0;
for(const[path,profile]of Object.entries(profiles)){
 const original=catalog.entries.find(e=>e.path===path).egg;
 for(const variable of original.variables){
  const current=profile.egg.variables.find(v=>v.env_variable===variable.env_variable);assert.ok(current);
  for(const key of['user_viewable','user_editable'])assert.equal(current[key],variable[key],path+' '+variable.env_variable+' '+key);
  const corrected=path.startsWith('renown/')&&['QUERY_PORT','BEACON_PORT','RCON_PORT'].includes(variable.env_variable);
  assert.equal(current.default_value,corrected?'':variable.default_value,path+' '+variable.env_variable+' default');originals++;
 }
 assert.equal(profile.verification,'not_verified');
}
const profile=profiles['renown/egg-renown.json'],raw={QUERY_PORT:'',BEACON_PORT:'',RCON_PORT:''};
const allocations=[28000,28001,28002,28003,28004].map((port,index)=>({id:index+1,ip:'192.0.2.1',port}));
let ranges=templatePortRanges(profile.port_rules,raw),selected=templateAdditionalPorts(allocations,1,profile.required_ports,[],false,ranges);
assert.equal(selected.length,3);assert.equal(templatePortsValid(allocations,1,selected,4,false,ranges),true);
let resolved=templatePortEnvironment(profile.port_rules,raw,allocations,1,selected);assert.equal(resolved.error,'');assert.deepEqual(resolved.environment,{QUERY_PORT:'28001',BEACON_PORT:'28002',RCON_PORT:'28003'});assert.deepEqual(raw,{QUERY_PORT:'',BEACON_PORT:'',RCON_PORT:''});
const explicit={QUERY_PORT:'28003',BEACON_PORT:'',RCON_PORT:''};ranges=templatePortRanges(profile.port_rules,explicit);selected=templateAdditionalPorts(allocations,1,4,[],false,ranges);resolved=templatePortEnvironment(profile.port_rules,explicit,allocations,1,selected);assert.equal(resolved.error,'');assert.equal(resolved.environment.QUERY_PORT,'28003');assert.equal(new Set(Object.values(resolved.environment)).size,3);
// Zero is rejected by the real field's nullable integer range and native preflight;
// generic nonzero port-rule filtering alone intentionally treats zero as inactive.
for(const key of Object.keys(raw))assert.equal(profile.egg.variables.find(v=>v.env_variable===key).rules,'nullable|integer|between:1024,65535');
for(const environment of [{QUERY_PORT:'28000',BEACON_PORT:'',RCON_PORT:''},{QUERY_PORT:'28001',BEACON_PORT:'28001',RCON_PORT:''}]){
 assert.notEqual(templatePortEnvironment(profile.port_rules,environment,allocations,1,[2,3,4]).error,'');
}
assert.notEqual(templatePortEnvironment(profile.port_rules,raw,allocations.map(a=>a.id===2?{...a,ip:'192.0.2.2'}:a),1,[2,3,4]).error,'');
console.log(`${originals} original controls checked; only3 approved invalid Renown port defaults corrected. Shared TS auto/distinct/explicit/invalid/wrong-IP fixtures pass.`);
