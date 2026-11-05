import fs from 'node:fs';
import assert from 'node:assert/strict';
const recipe='conan_exiles/egg-conan-exiles.json';
const all=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const upstream=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===recipe);
const current=all[recipe], profile=structuredClone(current);
assert.equal(current.upstream_sha256,upstream.sha256);
const script=profile.egg.scripts.installation;
// Replace current embedded shared dependencies, never stale historical embeds.
for(const name of ['conan-empires','ark-family','native-config','steam-template','bundle-debian-python']) {
 const target='.voltra/'+name.replaceAll('-','_')+'.py';
 const pattern=new RegExp("cat > "+target.replaceAll('.','\\.')+" <<'VOLTRA_CONAN_EMPIRES_SOURCE'\\n[\\s\\S]*?\\nVOLTRA_CONAN_EMPIRES_SOURCE\\n");
 assert(pattern.test(script.script),'Missing embed '+name);
 script.script=script.script.replace(pattern,()=>`cat > ${target} <<'VOLTRA_CONAN_EMPIRES_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+name+'.py','utf8')}\nVOLTRA_CONAN_EMPIRES_SOURCE\n`);
}
assert(script.script.includes('python3 .voltra/conan_empires.py install conan'));
script.script=script.script.replace('python3 .voltra/conan_empires.py install conan',`cat > .voltra/conan_legacy.py <<'VOLTRA_LEGACY_WRAPPER'\n${fs.readFileSync('internal/panel/game_library/scripts/conan-legacy.py','utf8')}\nVOLTRA_LEGACY_WRAPPER\npython3 .voltra/conan_legacy.py install conan`);
assert(profile.egg.startup.endsWith('.voltra/conan_empires.py run conan'));
profile.egg.startup=profile.egg.startup.replace('.voltra/conan_empires.py run conan','.voltra/conan_legacy.py run conan');
assert.deepEqual(profile.egg.variables,current.egg.variables);
for(const file of ['Engine.ini','Game.ini','ServerSettings.ini']) (profile.settings_documents??={})['/ConanSandbox/Saved/Config/WindowsServer/'+file]='ini';
profile.revision='conan-legacy-preflight-v1';profile.verification='not_verified';
profile.detail='Legacy-only explicit UE4 branch, current helper embeds, complete case-insensitive native INI preflight. Offline source tests only; unserved.';
fs.mkdirSync('artifacts/game-parity-20261029/conan-legacy-owner',{recursive:true});
fs.writeFileSync('artifacts/game-parity-20261029/conan-legacy-owner/profile.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
