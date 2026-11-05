import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const recipe='cod/iw4x/egg-iw4x-mw2.json';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const original=catalog.entries.find(e=>e.path===recipe);
const baseline=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
assert.ok(baseline?.egg, 'Retained arena profile required');
const profile=structuredClone(baseline), hashes={};
profile.revision='iw4x-authority-v4';
profile.verification='not_verified';
profile.detail='Source-only IW4x local challenge query gate, strict Dvar and mod/path preflight. Native listener/query validation requires legitimate owned payload and an authorized served build.';
profile.egg.variables=structuredClone(original.egg.variables);
for(const variable of baseline.egg.variables) if(!original.egg.variables.some(v=>v.env_variable===variable.env_variable)) profile.egg.variables.push(structuredClone(variable));
assert.deepEqual(profile.egg.variables.slice(0,original.egg.variables.length),original.egg.variables);
profile.egg.startup=profile.egg.startup.replace('arena-native.py run iw4x','iw4x-native.py run');
profile.egg.config.startup=JSON.stringify({done:'VOLTRA_IW4X_LOCAL_MATCH_READY'});
let script=profile.egg.scripts.installation.script;
// Re-staging must not accumulate duplicate wrapper emissions or preflight calls.
script=script.replace(/cat > \.voltra\/iw4x-native\.py <<'([^']+)'\n[\s\S]*?\n\1\n/g, '').replace(/^python3 \.voltra\/iw4x-native\.py preflight\n/gm, '');
script=script.replace(/(cat > \.voltra\/([^ ]+) <<'([^']+)'\n)[\s\S]*?\n\3\n/g,(_,head,file,delimiter)=>head+fs.readFileSync('internal/panel/game_library/scripts/'+(file==='steam_template.py'?'steam-template.py':file),'utf8')+'\n'+delimiter+'\n');
const wrapper=fs.readFileSync('internal/panel/game_library/scripts/iw4x-native.py','utf8');
const preflight=`cat > .voltra/iw4x-native.py <<'VOLTRA_IW4X_ONLY'\n${wrapper}\nVOLTRA_IW4X_ONLY\npython3 .voltra/iw4x-native.py preflight\n`;
script=script.replace('python3 .voltra/bundle-debian-python.py\n',preflight+'python3 .voltra/bundle-debian-python.py\n').replace('python3 .voltra/arena-native.py install iw4x','python3 .voltra/iw4x-native.py install');
// Fail before apt or writing through a pre-existing internal directory link.
script=script.replace('cd /mnt/server\n',`cd /mnt/server\n[ "\${INSTALL_MODE:-existing}" = existing ] || { echo 'IW4x private acquisition unavailable' >&2; exit 1; }\n[ ! -L .voltra ] || { echo 'IW4x .voltra symlink refused' >&2; exit 1; }\n`);
profile.egg.scripts.installation.script=script;
for(const match of script.matchAll(/cat > \.voltra\/([^ ]+) <<'([^']+)'\n([\s\S]*?)\n\2\n/g)) {
 const file=match[1], body=match[3], source=file==='steam_template.py'?'steam-template.py':file;
 assert.equal(body,fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8'),`stale embedded helper: ${file}`);
 hashes[file]=crypto.createHash('sha256').update(body).digest('hex');
}
assert.ok(hashes['iw4x-native.py']);
const directory='artifacts/game-parity-20261029/wave25-iw4x-integration';
fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(directory+'/profile.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
fs.writeFileSync(directory+'/embed-hashes.json',JSON.stringify({recipe,upstream_sha256:original.sha256,helpers:hashes,profile_sha256:crypto.createHash('sha256').update(fs.readFileSync(directory+'/profile.json')).digest('hex'),original_ordered_variables_preserved:true},null,2)+'\n');
console.log('IW4X-STAGE: exact original variable records and all embedded helper hashes verified');

