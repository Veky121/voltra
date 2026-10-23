import fs from 'node:fs';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
execFileSync('python',['tools/runtime/test-minecraft-packs.py'],{stdio:'inherit',windowsHide:true});
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),stage=JSON.parse(fs.readFileSync('.local/minecraft-packs/profiles.json'));
assert.equal(Object.keys(stage).length,13);
for(const [path,profile] of Object.entries(stage)){
 const original=catalog.entries.find(e=>e.path===path);assert(original,path);assert.equal(profile.upstream_sha256,original.sha256);
 for(const v of original.egg.variables){const adapted=profile.egg.variables.find(x=>x.env_variable===v.env_variable);assert(adapted,path+':missing '+v.env_variable);assert.equal(adapted.user_editable,v.user_editable);assert.equal(adapted.user_viewable,v.user_viewable);if(!path.includes('/hexxit/'))assert.equal(adapted.default_value,v.default_value);}
 assert(profile.egg.voltra.java_config.enabled);assert(profile.egg.features.includes('minecraft'));
 assert(profile.egg.scripts.installation.script.includes(fs.readFileSync('internal/panel/game_library/scripts/minecraft-pack-install.py','utf8')));
 assert(profile.egg.scripts.installation.script.includes(fs.readFileSync('internal/panel/game_library/minecraft-install.py','utf8')));
 assert.equal(profile.required_ports,1);
}
console.log('13 exactrecipes originalcontrols+sharedJava+currentembeddings pass.');
