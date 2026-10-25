import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {cuberitePath,stageCuberiteOwnership} from './stage-cuberite-ownership-profile.mjs';
test('Cuberite-only installer selection preserves all controls/runtime and is idempotent',()=>{
 const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),before=JSON.stringify(current),helper=fs.readFileSync('internal/panel/game_library/scripts/cuberite-install.py','utf8');
 const staged=stageCuberiteOwnership(current,helper);assert.deepEqual(Object.keys(staged),[cuberitePath]);assert.equal(JSON.stringify(current),before);
 const old=current[cuberitePath],profile=staged[cuberitePath];
 for(const key of ['variables','startup','docker_images','config','features','voltra'])assert.deepEqual(profile.egg[key],old.egg[key]);
 for(const key of ['required_ports','port_rules','defaults','verification','detail'])assert.deepEqual(profile[key],old[key]);
 assert.equal(profile.egg.scripts.installation.container,old.egg.scripts.installation.container);
 assert.ok(profile.egg.scripts.installation.script.includes(helper));assert.ok(!profile.egg.scripts.installation.script.includes('python3 .voltra/minecraft_special_install.py cuberite'));
 assert.deepEqual(stageCuberiteOwnership(staged,helper),staged);
 const refresh=stageCuberiteOwnership(staged,'# refreshed helper');assert.ok(refresh[cuberitePath].egg.scripts.installation.script.includes('# refreshed helper'));assert.deepEqual(refresh[cuberitePath].egg.variables,old.egg.variables);
});
