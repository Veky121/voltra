import fs from 'node:fs';
import assert from 'node:assert/strict';
const recipe='gta/ragecoop/egg-rage-c-o-o-p.json';
const source=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
assert(source?.egg,'Exact canonical profile missing');
const profile=structuredClone(source);
let script=profile.egg.scripts.installation.script;
for(const name of ['ragecoop-install.py','ragecoop-runtime.py']) {
 const start=`cat > .voltra/${name} <<'VOLTRA_SOURCE'\n`;
 const a=script.indexOf(start);assert(a>=0,`Missing emission ${name}`);
 const b=script.indexOf('\nVOLTRA_SOURCE',a+start.length);assert(b>=0);
 script=script.slice(0,a+start.length)+fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')+'\n'+script.slice(b);
}
profile.egg.scripts.installation.script=script;
profile.revision=source.revision+'-wave45-source';
profile.verification='not_verified';
profile.detail='Unapplied source-only RageCOOP preflight and operator-file authority correction; native acceptance pending.';
const before=structuredClone(source),after=structuredClone(profile);
for(const x of [before,after]){delete x.revision;delete x.verification;delete x.detail;x.egg.scripts.installation.script='';}
assert.deepEqual(after,before);
const out='artifacts/game-parity-20261029/wave45-ragecoop';fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/profiles.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
console.log('PASS exact profile semantics retained; two helper bodies replaced; no canonical write');
