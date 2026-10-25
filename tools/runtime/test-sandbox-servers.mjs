import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const profiles=JSON.parse(fs.readFileSync('.local/sandbox-servers/profiles.json'));
const paths=['wine/generic/egg-wine-generic.json','novalife_amboise/egg-nova--life--amboise.json','modiverse/egg-modiverse.json'];
assert.deepEqual(Object.keys(profiles),paths);
let originalControls=0;
for(const path of paths){
 const original=catalog.entries.find(e=>e.path===path),profile=profiles[path],egg=profile.egg;
 assert.equal(profile.upstream_sha256,original.sha256);assert.equal(profile.verification,'not_verified');
 for(const variable of original.egg.variables){assert.deepEqual(egg.variables.find(v=>v.env_variable===variable.env_variable),variable);originalControls++;}
 assert.equal(egg.config.files,'{}');assert.equal(egg.config.stop,'^C');
 assert.equal(egg.variables.find(v=>v.env_variable==='XVFB').default_value,'0');
 for(const image of Object.values(egg.docker_images))assert.match(image,/@sha256:[a-f0-9]{64}$/);
 assert.match(egg.scripts.installation.container,/@sha256:[a-f0-9]{64}$/);
 const hashes=JSON.parse(fs.readFileSync('.local/sandbox-servers/source-hashes.json'));
 for(const[source,expected]of Object.entries(hashes)){
  const content=fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8');
  assert.equal(crypto.createHash('sha256').update(content).digest('hex'),expected);
  assert(egg.scripts.installation.script.includes(`cat > .voltra/${source.replaceAll('-','_')} <<'VOLTRA_SANDBOX_SOURCE'\n${content}\nVOLTRA_SANDBOX_SOURCE\n`),'Stale embedded '+source);
 }
 assert(!egg.scripts.installation.script.includes('virtual_worlds_runtime'));
}
assert.equal(originalControls,13);
const generic=profiles[paths[0]].egg;
assert.equal(Object.keys(generic.docker_images).length,3);
assert.equal(generic.variables.find(v=>v.env_variable==='AUTO_UPDATE').default_value,'0');
assert.equal(JSON.parse(generic.config.startup).done,'VOLTRA_GENERIC_READY');
assert.equal(generic.variables.find(v=>v.env_variable==='READINESS_MARKER').default_value,'');
assert.equal(profiles[paths[2]].port_rules[0].auto_allocate,false);
assert.equal(profiles[paths[2]].egg.variables.find(v=>v.env_variable==='QUERY_PORT').default_value,'27015');
const defaults=JSON.parse(fs.readFileSync('internal/panel/game_library/scripts/sandbox-servers-defaults.json'));
const pinned=JSON.parse(fs.readFileSync('internal/panel/game_library/scripts/sandbox-servers-modiverse-seed.json'));
assert.deepEqual(defaults.modiverse,pinned);assert.equal(defaults.nova.disconnectClientsBeforeStop,true);
assert.equal(defaults.nova.autoSaveIntervalSeconds,1800);assert.equal(defaults.nova.isPublicServer,false);
const runtime=fs.readFileSync('internal/panel/game_library/scripts/sandbox-servers.py','utf8');
assert(!runtime.includes('shell=True'));assert(!runtime.includes('os.system'));assert(!runtime.includes('wineserver -k'));
console.log('PASS: exact three recipes, all13 original variables unchanged, three pinned Wine variants, original configuration seeds, fresh embedded helpers and honest readiness/port metadata.');
