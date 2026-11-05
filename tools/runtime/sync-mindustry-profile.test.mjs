import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {recipe, refreshMindustryProfile} from './sync-mindustry-profile.mjs';
const file='internal/panel/game_library/overrides.json';
const baseline=fs.readFileSync(file), current=JSON.parse(baseline)[recipe];
const sources={java:fs.readFileSync('internal/panel/game_library/scripts/VoltraMindustry.java','utf8'),license:fs.readFileSync('internal/panel/game_library/scripts/Mindustry-LICENSE','utf8'),preflight:fs.readFileSync('internal/panel/game_library/scripts/mindustry-installer-preflight.sh','utf8')};

test('current native-authority generation is byte-identical and preserves all ordered controls and metadata',()=>{
 const updated=refreshMindustryProfile(current,sources);assert.deepEqual(updated,current);assert.equal(updated.egg.variables.length,9);assert.deepEqual(updated.egg.variables,current.egg.variables);assert(fs.readFileSync(file).equals(baseline));
});
test('canonical Java refresh changes only embedded source and preserves safety scaffold',()=>{
 const java=sources.java+'\n// Owned source refresh fixture\n';const updated=refreshMindustryProfile(current,{...sources,java});assert(updated.egg.scripts.installation.script.includes(java));const a=structuredClone(updated),b=structuredClone(current);delete a.egg.scripts.installation.script;delete b.egg.scripts.installation.script;assert.deepEqual(a,b);assert(updated.egg.scripts.installation.script.includes('mv -Tf -- "$stage/mindustry-native-start.sh" .voltra/mindustry-native-start.sh'));assert.equal(refreshMindustryProfile(updated,{...sources,java}).egg.scripts.installation.script,updated.egg.scripts.installation.script);
});
test('canonical managed-path refresh stays before acquisition and retains exact staged publication',()=>{
 const preflight=sources.preflight.replace('    local path','    # source refresh fixture\n    local path');const script=refreshMindustryProfile(current,{...sources,preflight}).egg.scripts.installation.script;assert(script.includes(preflight.trimEnd()));assert(script.indexOf('source refresh fixture')<script.indexOf('apt-get update'));assert.equal(script.split('mv -Tf --').length-1,5);
});
test('legacy authority, missing binary discovery and unsafe scaffold are refused',()=>{
 for(const alter of [p=>p.revision='mindustry-v160.7-v1',p=>p.egg.startup='exec bash .voltra/mindustry-start.sh',p=>p.settings_documents=[],p=>p.egg.scripts.installation.script=p.egg.scripts.installation.script.replace('mv -Tf -- "$stage/mindustry-native-start.sh"','mv -- "$stage/mindustry-native-start.sh"')]){const p=structuredClone(current);alter(p);assert.throws(()=>refreshMindustryProfile(p,sources));}
});
test('missing admin flush and reserved heredoc delimiters are refused without writes',()=>{
 assert.throws(()=>refreshMindustryProfile(current,{...sources,java:sources.java.replace('Vars.netServer.admins.forceSave();','')}));assert.throws(()=>refreshMindustryProfile(current,{...sources,java:sources.java+'\nJAVA_SOURCE\n'}));assert.throws(()=>refreshMindustryProfile(current,{...sources,license:sources.license+'\nLICENSE_SOURCE\n'}));assert(fs.readFileSync(file).equals(baseline));
});
test('CLI check and default staging never write canonical overrides',()=>{
 for(const args of [['--check'],[]]){const r=spawnSync(process.execPath,['tools/runtime/sync-mindustry-profile.mjs',...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert(fs.readFileSync(file).equals(baseline));assert.equal(JSON.parse(r.stdout).canonical_written,false);}
 const staged=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/mindustry-sync-profile.json'));assert.deepEqual(Object.keys(staged),[recipe]);assert.deepEqual(staged[recipe],current);
});
