import fs from 'node:fs';
import {cuberitePath} from './stage-cuberite-ownership-profile.mjs';
export function stage(current){
 const read=name=>fs.readFileSync(`internal/panel/game_library/scripts/${name}`,'utf8');
 const result={[cuberitePath]:structuredClone(current[cuberitePath])}, p=result[cuberitePath];
 if(!p?.egg)throw Error('Canonical Cuberite base missing');
 let script=p.egg.scripts.installation.script;
 // Refresh only the assigned payloads and the current shared native writer.
 for(const [name,source] of [['cuberite_parity_runtime.py','cuberite-parity-runtime.py'],['cuberite_parity_install.py','cuberite-parity-install.py'],['native_config.py','native-config.py']]){
  const pattern=new RegExp(`(cat > \.voltra/${name.replaceAll('.', '\\.')} <<'([^']+)'\\r?\\n)[\\s\\S]*?(\\r?\\n\\2(?:\\r?\\n|$))`);
  if(!pattern.test(script))throw Error(`Missing current embed: ${name}`);
  script=script.replace(pattern,(_,head,marker,tail)=>head+read(source).trimEnd()+tail);
 }
 p.egg.scripts.installation.script=script;
 return result;
}
if(process.argv[1]?.endsWith('stage-cuberite-parity.mjs')){
 fs.mkdirSync('artifacts/game-parity-20261029',{recursive:true});
 fs.writeFileSync('artifacts/game-parity-20261029/cuberite-review-profile.json',JSON.stringify(stage(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))),null,2)+'\n');
}
