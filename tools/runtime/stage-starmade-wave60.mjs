import fs from 'node:fs';
const out=process.argv[2];
if(!out || fs.existsSync(out))throw Error('Pass a new task-owned output directory');
const key='starmade/egg-starmade.json';
const all=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const profile=structuredClone(all[key]);
if(!profile?.egg?.scripts?.installation)throw Error('Missing current StarMade override');
for(const [source,target] of [['java-games-install.py','java_games_install.py'],['java-games-runtime.py','java_games_runtime.py']]){
 const marker=`cat > .voltra/${target} <<'VOLTRA_JAVA_SOURCE'\n`;
 const script=profile.egg.scripts.installation.script;
 const start=script.indexOf(marker),end=script.indexOf('\nVOLTRA_JAVA_SOURCE',start+marker.length);
 if(start<0 || end<0)throw Error('Unknown installer emission boundary '+target);
 profile.egg.scripts.installation.script=script.slice(0,start+marker.length)+fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')+script.slice(end);
}
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/recipe-fragment.json',JSON.stringify({[key]:profile},null,2)+'\n');
console.log(out+'/recipe-fragment.json');
