import fs from 'node:fs';
const dir='artifacts/game-parity-20261029/wave45-romestead';fs.mkdirSync(dir,{recursive:true});
const recipe='romestead/egg-romestead.json',profile=structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe]);
let script=profile.egg.scripts.installation.script;
for(const file of ['crafting-install.py','crafting-runtime.py']){
 const emitted=file.replaceAll('-','_'),start=`cat > .voltra/${emitted} <<'VOLTRA_SOURCE'\n`,i=script.indexOf(start);
 if(i<0)throw Error('Missing canonical emission '+emitted);
 const j=script.indexOf('\nVOLTRA_SOURCE',i+start.length);if(j<0)throw Error('Missing heredoc terminator');
 script=script.slice(0,i+start.length)+fs.readFileSync('internal/panel/game_library/scripts/'+file,'utf8').trimEnd()+script.slice(j);
}
profile.egg.scripts.installation.script=script;
fs.writeFileSync(dir+'/profiles.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
console.log('Staged exact canonical Romestead metadata; replaced only two owned embedded modules.');
