import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const dir='artifacts/game-parity-20261029/assetto-ai-owner-20261030';
const key='assetto_corsa/egg-assetto-corsa--freeroam--a-i.json';
const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[key];
const profile=structuredClone(current), hashes={};
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
let embed='';
for(const name of ['assetto-ai-native.py','assetto-ai-release.py']){
 const body=fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8').replaceAll('\r\n','\n');
 const marker='VOLTRA_AI_'+name.replaceAll(/[^a-z]/g,'_').toUpperCase();
 assert(!body.includes(marker));
 const source=body.endsWith('\n')?body:body+'\n';
 embed+=`cat > .voltra/${name} <<'${marker}'\n${source}${marker}\n`;
 hashes[name]=hash(source);
}
const call='python3 .voltra/assetto-native-authority.py install assettoserver';
assert.equal(profile.egg.scripts.installation.script.split(call).length,2);
profile.egg.scripts.installation.script=profile.egg.scripts.installation.script.replace(call,()=>embed+'python3 .voltra/assetto-ai-native.py install assettoserver');
profile.egg.startup=profile.egg.startup.replace('.voltra/assetto-native-authority.py run assettoserver','.voltra/assetto-ai-native.py run assettoserver');
assert(profile.egg.startup.includes('assetto-ai-native.py run assettoserver'));
profile.revision+='-ai-preflight-v1';
profile.setup_steps.push('Before acquisition import a legitimate server preset, practice session, entry list and corresponding car physics/track surfaces. Enabled AI requires a compatible spline. Preset paths with CSP traversal syntax require operator review. Repair retains cfg, content, plugins, logs and presets even when unchanged from the publisher archive. Modified or untracked executables require explicit operator review. Bootstrap package/helper provisioning occurs before this native preflight.');
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
