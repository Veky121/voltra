import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const cuberitePath='minecraft/java/cuberite/egg-cuberite.json';
export function stageCuberiteOwnership(current,helper){
 const profile=structuredClone(current[cuberitePath]);if(!profile?.egg)throw Error('Canonical Cuberite base missing');
 const install=profile.egg.scripts.installation,previous='python3 .voltra/minecraft_special_install.py cuberite';
 const ownStart="cat > .voltra/cuberite_install.py <<'VOLTRA_CUBERITE_OWNERSHIP'\n";
 const ownEnd="\nVOLTRA_CUBERITE_OWNERSHIP\npython3 .voltra/cuberite_install.py";
 let script=install.script;
 if(script.includes(ownStart)){
  const start=script.indexOf(ownStart),end=script.indexOf(ownEnd,start);if(end<0)throw Error('Malformed existing Cuberite helper embed');
  script=script.slice(0,start)+ownStart+helper+ownEnd+script.slice(end+ownEnd.length);
 }else{
  if(script.split(previous).length!==2)throw Error('Exact Cuberite-only invocation missing');
  script=script.replace(previous,ownStart+helper+ownEnd);
 }
 script=script.replace('mkdir -p .voltra\n', 'test ! -L .voltra\nmkdir -p .voltra\n');
 script=script.replaceAll('test ! -L .voltra\ntest ! -L .voltra\n','test ! -L .voltra\n');
 // Preserve the existing helper set and reject symlink targets before shell
 // heredocs, including the new narrow helper. This changes only this profile.
 script=script.replace(/(?:test ! -L (\.voltra\/[A-Za-z0-9_.-]+)\n)?cat > (\.voltra\/[A-Za-z0-9_.-]+) /g,(_,prior,target)=>`test ! -L ${target}\ncat > ${target} `);
 install.script=script;profile.revision=profile.revision.replace(/(?:-owned-v1)+$/,'')+'-owned-v1';
 const step='Cuberite Reinstall verifies executable ownership, adopts only exact reviewed publisher bytes, refuses operator-modified programs, and preserves existing configuration, plugin, world and permission data. Native compatibility is not yet fully verified.';
 profile.setup_steps=[...(profile.setup_steps||[]).filter(value=>value!==step),step];
 return {[cuberitePath]:profile};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 fs.mkdirSync('.local/cuberite-ownership',{recursive:true});
 const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json','utf8')),helper=fs.readFileSync('internal/panel/game_library/scripts/cuberite-install.py','utf8');
 fs.writeFileSync('.local/cuberite-ownership/profiles.json',JSON.stringify(stageCuberiteOwnership(current,helper),null,2)+'\n');
 console.log('Staged only Cuberite ownership profile; canonical profiles unchanged.');
}
