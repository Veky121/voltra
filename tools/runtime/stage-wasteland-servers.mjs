import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const keys=['night_of_the_dead/egg-night-of-the-dead.json','no_one_survived/egg-no-one-survived.json','plains_of_pain/egg-plains-of-pain.json'];
export function stageWastelandProfiles(current,bodies,pins,terms){
 const agreement=pins.plains_eula;
 if(crypto.createHash('sha256').update(terms,'utf8').digest('hex')!==agreement.sha256||Buffer.byteLength(terms)!==agreement.bytes)throw Error('Reviewed Plains EULA bytes mismatch');
 const profiles={};
 for(const key of keys){
  if(!current[key]?.egg)throw Error('Current reviewed profile missing: '+key);
  const profile=structuredClone(current[key]);let script=profile.egg.scripts.installation.script;
  // Refresh only owned bodies, preserving every other helper and recipe field.
  for(const name of ['wasteland-servers.py','wasteland-servers-pins.json']){
   const opening="cat > .voltra/"+name+" <<'VOLTRA_WASTELAND_SERVERS_SOURCE'\n",start=script.indexOf(opening);
   if(start<0||script.indexOf(opening,start+1)>=0)throw Error('Unique owned helper embedding required: '+name);
   const content=start+opening.length,end=script.indexOf('\nVOLTRA_WASTELAND_SERVERS_SOURCE\n',content);
   if(end<0)throw Error('Owned helper terminator missing');
   script=script.slice(0,content)+bodies[name].replaceAll('\r\n','\n')+script.slice(end);
  }
  profile.egg.scripts.installation.script=script;
  if(key==='plains_of_pain/egg-plains-of-pain.json'){
   profile.agreements=[...(profile.agreements||[]).filter(a=>a.environment!==agreement.environment),{environment:agreement.environment,title:'Plains of Pain End User License Agreement',text:terms,effective_date:agreement.effective_date,accept_value:agreement.sha256}];
   profile.egg.variables=[...profile.egg.variables.filter(v=>v.env_variable!==agreement.environment),{name:'Publisher agreement',env_variable:agreement.environment,default_value:'0',rules:'required|string|in:0,'+agreement.sha256,description:'Review the Plains of Pain publisher agreement and explicitly agree before installing or starting the server.',user_viewable:true,user_editable:true}];
  }
  profiles[key]=profile;
 }
 return profiles;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const base='internal/panel/game_library/scripts/',names=['wasteland-servers.py','wasteland-servers-pins.json'];
 const bodies=Object.fromEntries(names.map(name=>[name,fs.readFileSync(base+name,'utf8')]));
 const pins=JSON.parse(bodies['wasteland-servers-pins.json']),terms=fs.readFileSync('artifacts/plains-of-pain-publisher-EULA.txt','utf8');
 const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json','utf8'));
 const profiles=stageWastelandProfiles(current,bodies,pins,terms);
 fs.mkdirSync('.local/wasteland-servers',{recursive:true});
 fs.writeFileSync('.local/wasteland-servers/profiles.json',JSON.stringify(profiles,null,2)+'\n');
 fs.writeFileSync('.local/wasteland-servers/source-hashes.json',JSON.stringify(Object.fromEntries(names.map(name=>[name,crypto.createHash('sha256').update(bodies[name].replaceAll('\r\n','\n')).digest('hex')])),null,2)+'\n');
 console.log('Three current profiles staged with owned helper refresh and Plains agreement; canonical unchanged.');
}
