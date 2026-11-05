import fs from 'node:fs';
import assert from 'node:assert/strict';
const recipe='midnight_ghost_hunt/egg-midnight-ghost-hunt.json';
const staged=JSON.parse(fs.readFileSync('.local/mgh/profiles.json'));
assert.deepEqual(Object.keys(staged),[recipe]);
const upstream=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===recipe).egg;
const profile=staged[recipe];
assert.deepEqual(profile.egg.variables.slice(0,upstream.variables.length),upstream.variables);
const base=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
assert.deepEqual(profile.port_rules,base.port_rules);
assert.deepEqual(profile.defaults,base.defaults);
assert.deepEqual(profile.egg.docker_images,base.egg.docker_images);
const script=profile.egg.scripts.installation.script;
for(const match of script.matchAll(/cat > \.voltra\/([^ ]+) <<'(VOLTRA_GHOST_LOVE_RENOWN_SOURCE|VOLTRA_MGH_SOURCE)'\n([\s\S]*?)\n\2\n/g)){
 const source=match[1].endsWith('.json')?match[1]:match[1].replaceAll('_','-');
 assert.equal(match[3],fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8'));
}
assert(script.includes('python3 .voltra/mgh_runtime.py install'));
assert(profile.egg.startup.includes('.voltra/mgh_runtime.py run'));
assert.equal(profile.verification,'not_verified');
console.log('PASS exact MGH fragment, original controls, allocation/default/image preservation and current embedded helper bytes.');
