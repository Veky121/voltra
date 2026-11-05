import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const dir='artifacts/game-parity-20261029/assetto-vanilla-owner-20261030';
const key='assetto_corsa/egg-assetto-corsa.json';
const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[key];
const profile=structuredClone(current), hashes={};
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
let embed='';
for(const name of ['assetto-vanilla-native.py']){
 const body=fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8').replaceAll('\r\n','\n');
 const marker='VOLTRA_AI_'+name.replaceAll(/[^a-z]/g,'_').toUpperCase();
 assert(!body.includes(marker));
 const source=body.endsWith('\n')?body:body+'\n';
 embed+=`cat > .voltra/${name} <<'${marker}'\n${source}${marker}\n`;
 hashes[name]=hash(source);
}
const call='python3 .voltra/assetto-native-authority.py install assetto';
assert.equal(profile.egg.scripts.installation.script.split(call).length,2);
profile.egg.scripts.installation.script=profile.egg.scripts.installation.script.replace(call,()=>embed+'python3 .voltra/assetto-vanilla-native.py install assetto');
profile.egg.startup=profile.egg.startup.replace('.voltra/assetto-native-authority.py run assetto','.voltra/assetto-vanilla-native.py run assetto');
assert(profile.egg.startup.includes('assetto-vanilla-native.py run assetto'));
profile.revision+='-vanilla-preflight-v1';
profile.setup_steps.push('Before acquisition import a legitimate vanilla preset, session, entry list and corresponding owned car physics and track surfaces. Native files retain authority. Quoted scalar values and semicolon car arrays are parsed without rewriting operator bytes. Private Steam credential transport remains blocked. Bootstrap provisioning precedes this gate.');
for(const field of ['variables','config','docker_images','features'])assert.deepEqual(profile.egg[field],current.egg[field]);
for(const field of ['defaults','required_ports','port_rules','upstream_sha256','verification'])assert.deepEqual(profile[field],current[field]);
for(const [name,expected] of Object.entries(hashes)){
 const script=profile.egg.scripts.installation.script;
 const start=script.indexOf(`cat > .voltra/${name} <<'`);
 const tail=script.slice(start), marker=tail.split('\n')[0].split("'")[1];
 assert.equal(hash(tail.slice(tail.indexOf('\n')+1,tail.indexOf('\n'+marker+'\n')+1)),expected);
}
fs.writeFileSync(dir+'/profile.json',JSON.stringify({[key]:profile},null,2)+'\n');
fs.writeFileSync(dir+'/stage.json',JSON.stringify({recipe:key,source_only:true,ordered_controls_preserved:true,embedded_sha256:hashes,profile_sha256:hash(fs.readFileSync(dir+'/profile.json'))},null,2)+'\n');
console.log(JSON.stringify(hashes));
