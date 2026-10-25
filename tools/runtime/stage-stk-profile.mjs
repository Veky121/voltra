// STK source-only LAN discovery repair. Never writes canonical overrides.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const key='SuperTuxKart/egg-super-tux-kart.json';
export function stageStkProfile(original, source=fs.readFileSync('internal/panel/game_library/scripts/stk-runtime.py','utf8')) {
 const profile=structuredClone(original),egg=profile.egg;
 const marker=/(cat > \.voltra\/stk_runtime\.py <<'VOLTRA_STK_DISCOVERY_SOURCE'\n)[\s\S]*?(\nVOLTRA_STK_DISCOVERY_SOURCE\n)/;
 let script=egg.scripts.installation.script;
 if(marker.test(script))script=script.replace(marker,(_,start,end)=>start+source+end);
 else {
  const anchor='python3 .voltra/small_games_family_install.py stk\n';
  if(!script.endsWith(anchor))throw Error('Review STK installer before staging discovery helper');
  script=script.slice(0,-anchor.length)+`cat > .voltra/stk_runtime.py <<'VOLTRA_STK_DISCOVERY_SOURCE'\n${source}\nVOLTRA_STK_DISCOVERY_SOURCE\n`+anchor;
 }
 egg.scripts.installation.script=script;
 egg.startup='exec python3 .voltra/stk_runtime.py';
 const variable={name:'LAN Discovery Port',description:'Stock LAN discovery uses UDP 2757. The planner can select another port on conflict; blank also selects an allocated secondary. A custom port requires matching client discovery configuration or an explicit direct server address. Native/client discovery is not verified.',env_variable:'DISCOVERY_PORT',default_value:'2757',user_viewable:true,user_editable:true,rules:'nullable|integer|between:1,65535',field_type:'text'};
 egg.variables=egg.variables.filter(v=>v.env_variable!=='DISCOVERY_PORT');egg.variables.push(variable);
 profile.required_ports=2;
 profile.defaults={...profile.defaults,port:2759};
 profile.port_rules=[{minimum:1,maximum:65535,count:2},{environment:'DISCOVERY_PORT',condition:'nonzero',allocated_value:true,auto_allocate:true,exclude_primary:true,exclude_ports:[2758],minimum:1,maximum:65535,count:2}];
 profile.revision='stk-lan-discovery-v2';
 profile.detail='Uses separate game and LAN discovery ports. Native startup, discovery and clean shutdown are not yet verified.';
 const setup='Select two allocations on the same address: game UDP and LAN discovery UDP. Stock discovery uses 2757; the planner may choose another port if unavailable, and blank selects an allocated secondary. Custom discovery requires matching client configuration or an explicit direct address. Native compatibility is not yet verified.';
 profile.setup_steps=profile.setup_steps.filter(s=>s!==setup&&!s.startsWith('Select one Linux x64 node and one allocation.'));
 profile.setup_steps.unshift(setup);
 return profile;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json','utf8'));
 const output='.local/stk-discovery-source';fs.mkdirSync(output,{recursive:true});
 fs.writeFileSync(output+'/profiles.json',JSON.stringify({[key]:stageStkProfile(current[key])},null,2)+'\n');
 console.log('Staged STK discovery source profile only; canonical and native resources unchanged.');
}
