import assert from 'node:assert/strict';
import fs from 'node:fs';
const recipe='gta/gtac/egg-grand-theft-auto-connected.json';
const base=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
const stage=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/wave45-gtac/profile.json'))[recipe];
const a=structuredClone(base),b=structuredClone(stage);
for(const p of [a,b]){delete p.revision;delete p.verification;delete p.detail;delete p.egg.scripts.installation.script;}
assert.deepEqual(a,b);
const script=stage.egg.scripts.installation.script;
for(const name of ['gtac-install.py','gtac-runtime.py']) {
 const prefix=`cat > .voltra/${name} <<'VOLTRA_SOURCE'\n`;
 const start=script.indexOf(prefix)+prefix.length,end=script.indexOf('\nVOLTRA_SOURCE',start);
 assert.equal(script.slice(start,end),fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8').trimEnd());
}
assert(script.indexOf('python3 .voltra/gtac-install.py --preflight')<script.indexOf('python3 .voltra/bundle-debian-python.py'));
console.log('PASS exact emission, ordered variables, defaults, rules, permissions, resources, images, readiness and unchanged profile semantics');
