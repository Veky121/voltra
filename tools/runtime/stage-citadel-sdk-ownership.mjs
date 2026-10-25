import fs from 'node:fs';
import crypto from 'node:crypto';
const source='internal/panel/game_library/scripts/fantasy-worlds-install.py';
const helper=fs.readFileSync(source,'utf8').replace(/\r\n/g,'\n');
const canonical=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const profiles={};
for(const [key,value] of Object.entries(canonical)){
 const script=value.egg?.scripts?.installation?.script;
 if(typeof script!=='string')continue;
 const pattern=/(cat > \.voltra\/fantasy_worlds_install\.py <<'([^']+)'\n)[\s\S]*?(\n\2\n)/g;
 let count=0;
 const updated=script.replace(pattern,(_,header,delimiter)=>{count++;return header+helper+'\n'+delimiter+'\n';});
 if(!count)continue;
 if(count!==1)throw Error('Unexpected helper count '+key);
 const profile=structuredClone(value);
 profile.egg.scripts.installation.script=updated;
 profiles[key]=profile;
}
if(!profiles['citadel/egg-citadel-forged-with-fire.json'])throw Error('Citadel current helper not found');
const dir='.local/citadel-sdk-ownership';fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(dir+'/profiles.json',JSON.stringify(profiles,null,2)+'\n');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const receipt={scope:'same-helper-body-only; metadata/defaults/status/domain behavior unchanged outside Citadel SDK installer',source,source_sha256:sha(helper),profiles:Object.keys(profiles),stage_sha256:sha(fs.readFileSync(dir+'/profiles.json')),tests:{sdk:15,family:34,initial_failure_log:'.local/citadel-sdk-ownership-current.log',current_log:'.local/citadel-sdk-ownership-fixed.log',family_log:'.local/citadel-fantasy-regression.log'},native_actions:false};
fs.writeFileSync(dir+'/source-checkpoint.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt));
