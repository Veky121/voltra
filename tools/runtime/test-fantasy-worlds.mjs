import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const profiles=JSON.parse(fs.readFileSync('.local/fantasy-worlds/profiles.json'));
const expected=['citadel/egg-citadel-forged-with-fire.json','portal_knights/egg-portal-knights.json','solace_crafting/egg-solace-crafting.json'];
assert.deepEqual(Object.keys(profiles),expected);
let originalControls=0;
for(const path of expected){
 const original=catalog.entries.find(e=>e.path===path),profile=profiles[path],egg=profile.egg;
 assert.equal(profile.upstream_sha256,original.sha256);
 assert.equal(profile.verification,'not_verified');
 assert(egg.features.includes('voltra_steam_template'));
 assert.equal(egg.variables.find(v=>v.env_variable==='XVFB').default_value,'0');
 for(const variable of original.egg.variables){
  const next=egg.variables.find(v=>v.env_variable===variable.env_variable);
  assert(next,'Missing '+variable.env_variable);
  const expected=structuredClone(variable);
  if(path.includes('portal_knights')&&['STEAM_USER','STEAM_PASS'].includes(expected.env_variable))expected.rules=expected.rules.replace(/^required(?=\|)/,'required_if:PORTAL_INSTALL_MODE,steam');
  assert.deepEqual(next,expected,'Original control metadata changed '+variable.env_variable);
  originalControls++;
 }
 const script=egg.scripts.installation.script;
 assert(!script.includes('pteropaste.com'));
 for(const source of ['steam-template.py','native-config.py','native-console.py','fantasy-worlds-runtime.py','fantasy-worlds-install.py','fantasy-worlds-defaults.json','fantasy-worlds-wine.py','fantasy-worlds-wine-build.py','fantasy-worlds-wine-console.c']){
  const content=fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8');
  assert(script.includes(`cat > .voltra/${source.replaceAll('-','_')} <<'VOLTRA_FANTASY_SOURCE'\n${content}\nVOLTRA_FANTASY_SOURCE\n`),'Missing/stale exact embedded helper '+source);
 }
 assert.match(Object.values(egg.docker_images)[0],/@sha256:[a-f0-9]{64}$/);
 assert.match(egg.scripts.installation.container,/@sha256:[a-f0-9]{64}$/);
 assert.equal(egg.config.files,'{}');
 assert(!script.includes('virtual_worlds_'));
}
assert.equal(originalControls,19);
const c=profiles[expected[0]],p=profiles[expected[1]],s=profiles[expected[2]];
assert.equal(c.port_rules[0].environment,'QPORT');assert.equal(c.port_rules[0].auto_allocate,false);
assert.equal(s.port_rules[0].environment,'QUERY_PORT');assert.equal(s.port_rules[0].auto_allocate,true);
assert.equal(p.egg.variables.find(v=>v.env_variable==='PORTAL_INSTALL_MODE').default_value,'steam');
assert.equal(JSON.parse(p.egg.config.startup).done,'VOLTRA_PORTAL_READY');
const consoleSource=fs.readFileSync('internal/panel/game_library/scripts/fantasy-worlds-wine-console.c','utf8');
assert(consoleSource.includes('Z:\\\\home\\\\container\\\\dedicated_server\\\\pk_dedicated_server.exe'));
assert(consoleSource.includes('QueryFullProcessImageNameW'));
assert(consoleSource.includes('GenerateConsoleCtrlEvent(CTRL_C_EVENT,0)'));
assert(consoleSource.indexOf('CompareStringOrdinal')<consoleSource.indexOf('AttachConsole'));
const driver=fs.readFileSync('internal/panel/game_library/scripts/fantasy-worlds-wine.py','utf8');
assert(!driver.includes('wineserver -k'));assert(!driver.includes('taskkill'));
const hashes=JSON.parse(fs.readFileSync('.local/fantasy-worlds/source-hashes.json'));
for(const[source,expected]of Object.entries(hashes))assert.equal(crypto.createHash('sha256').update(fs.readFileSync('internal/panel/game_library/scripts/'+source)).digest('hex'),expected);
console.log('PASS: exact 3 paths, 19 original controls with approved 2 conditional-rule deltas, fresh embedded sources, immutable images, port rules and scoped console source guards. Native execution unverified.');
