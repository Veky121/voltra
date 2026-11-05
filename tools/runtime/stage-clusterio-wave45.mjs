import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const recipe='factorio/clusterio/egg-clusterio.json';
export function stageClusterio(current,helpers){
 const profile=structuredClone(current[recipe]);
 if(!profile?.egg)throw Error('Canonical Clusterio profile missing');
 let script=profile.egg.scripts.installation.script;
 for(const [name,source] of Object.entries(helpers)){
  const begin=`cat > .voltra/${name} <<'VOLTRA_HELPER'\n`,end='\nVOLTRA_HELPER\n';
  const i=script.indexOf(begin),j=script.indexOf(end,i);
  if(i<0||j<0)throw Error(`Missing exact helper emission: ${name}`);
  script=script.slice(0,i)+begin+source+'\nVOLTRA_HELPER\n'+script.slice(j+end.length);
 }
 const marker='apt-get update\n';
 if(script.split(marker).length!==2)throw Error('Installer acquisition boundary changed');
 // Run the same validator from memory before apt, helper writes or npm.
 script=script.replace(marker,`cd /mnt/server\nnode --input-type=module <<'VOLTRA_CLUSTERIO_PREFLIGHT'\n${helpers['clusterio-start.mjs']}\npreflightSetup('.',process.env);\nVOLTRA_CLUSTERIO_PREFLIGHT\n${marker}`);
 profile.egg.scripts.installation.script=script;
 return {[recipe]:profile};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const helpers=Object.fromEntries(['clusterio-start.mjs','clusterio-setup.mjs','clusterio-controller.mjs'].map(name=>[name,fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')]));
 const staged=stageClusterio(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json','utf8')),helpers);
 fs.mkdirSync('artifacts/game-parity-20261029/wave45-clusterio',{recursive:true});
 fs.writeFileSync('artifacts/game-parity-20261029/wave45-clusterio/profiles.json',JSON.stringify(staged,null,2)+'\n');
}
