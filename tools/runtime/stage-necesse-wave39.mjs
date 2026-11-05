// Stage only Necesse, preserving every canonical field except the two helper bodies.
import fs from 'node:fs';
const key='necesse/egg-necesse.json';
const profile=structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json','utf8'))[key]);
let script=profile.egg.scripts.installation.script;
for(const [source,target] of [['java-games-runtime.py','java_games_runtime.py'],['java-games-install.py','java_games_install.py']]) {
 const start=`cat > .voltra/${target} <<'VOLTRA_JAVA_SOURCE'\n`;
 const end='\nVOLTRA_JAVA_SOURCE\n';
 const at=script.indexOf(start), until=script.indexOf(end,at+start.length);
 if(at<0 || until<0 || script.indexOf(start,at+1)>=0)throw Error('Ambiguous emitted helper '+target);
 script=script.slice(0,at+start.length)+fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8').replaceAll('\r\n','\n')+script.slice(until);
}
profile.egg.scripts.installation.script=script;
const out='artifacts/game-parity-20261029/wave39-necesse-repair';
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/profiles.json',JSON.stringify({[key]:profile},null,2)+'\n');
