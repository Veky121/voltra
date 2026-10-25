import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {stageTerrariaProfiles,stageVanillaPublisherStartup} from './stage-terraria-release-profiles.mjs';

test('four staged profiles preserve defaults, runtime, controls and recorded evidence',()=>{
 const source=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
 const before=JSON.stringify(source),helper=fs.readFileSync('internal/panel/game_library/scripts/terraria-release-install.py','utf8');
 const staged=stageTerrariaProfiles(source,helper);assert.equal(Object.keys(staged).length,4);assert.equal(JSON.stringify(source),before);
 for(const [key,profile] of Object.entries(staged)){
  const old=source[key];assert.deepEqual(profile.egg.docker_images,old.egg.docker_images);assert.equal(profile.egg.startup,key==='terraria/vanilla/egg-terraria-vanilla.json'?'exec /bin/bash /home/container/TerrariaServer -config serverconfig.txt -noupnp':key==='terraria/tshock/egg-tshock.json'?'exec python3 .voltra/tshock_runtime.py':key==='terraria/tmodloader/egg-t-modloader.json'?'exec python3 .voltra/tmodloader_runtime.py':old.egg.startup);assert.deepEqual(profile.egg.config,old.egg.config);
  for(const original of old.egg.variables){const updated=profile.egg.variables.find(v=>v.env_variable===original.env_variable);assert.equal(updated.default_value,original.default_value);if(!['VERSION','TERRARIA_VERSION','TSHOCK_VERSION','RELEASE_SHA256','VOLTRA_TERRARIA_KIND'].includes(original.env_variable))assert.deepEqual(updated,original);}
  assert.ok(profile.egg.scripts.installation.script.includes(helper));assert.equal(profile.verification,old.verification);
 }
});

test('modern TShock runtime family stage stays single-key and default image stays NET9',()=>{
 const source=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),helper=fs.readFileSync('internal/panel/game_library/scripts/terraria-release-install.py','utf8'),key='terraria/tshock/egg-tshock.json';
 const staged=stageTerrariaProfiles(source,helper,'# runtime source fixture',[key]);assert.deepEqual(Object.keys(staged),[key]);
 assert.deepEqual(staged[key].egg.docker_images,source[key].egg.docker_images);assert.ok(staged[key].egg.scripts.installation.script.includes('# runtime source fixture'));
 const version=staged[key].egg.variables.find(v=>v.env_variable==='TSHOCK_VERSION');assert.equal(version.default_value,'v6.2.1');assert.ok(version.description.includes('support ended2024-11-12'));
 assert.ok(!staged[key].egg.scripts.installation.script.includes('dotnet_6'));
});

test('tModLoader-only stage embeds real family dispatcher and preserves default controls',()=>{
 const source=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),key='terraria/tmodloader/egg-t-modloader.json';
 const helper=fs.readFileSync('internal/panel/game_library/scripts/terraria-release-install.py','utf8'),runtime=fs.readFileSync('internal/panel/game_library/scripts/tmodloader-runtime.py','utf8');
 const staged=stageTerrariaProfiles(source,helper,'# private6 primitive',[key],runtime);assert.deepEqual(Object.keys(staged),[key]);
 const profile=staged[key];assert.equal(profile.egg.startup,'exec python3 .voltra/tmodloader_runtime.py');assert.deepEqual(profile.egg.config,source[key].egg.config);
 assert.equal(profile.egg.variables.find(v=>v.env_variable==='VERSION').default_value,'v2026.08.3.0');
 assert.ok(profile.egg.scripts.installation.script.includes(runtime));assert.ok(profile.egg.scripts.installation.script.includes('# private6 primitive'));
 assert.ok(profile.detail.includes('MonoKickstart'));assert.ok(!profile.detail.includes('adapter added with offline fixture'));
 assert.deepEqual(stageTerrariaProfiles(staged,helper,'# private6 primitive',[key],runtime),staged);
});

test('staging is idempotent and helper refresh preserves original controls',()=>{
 const source=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
 const first=stageTerrariaProfiles(source,'# helper first');
 assert.deepEqual(stageTerrariaProfiles(first,'# helper first'),first);
 const refreshed=stageTerrariaProfiles(first,'# helper refreshed');
 for(const [key,profile] of Object.entries(refreshed)){
  const old=first[key];assert.deepEqual(profile.egg.variables,old.egg.variables);assert.deepEqual(profile.setup_steps,old.setup_steps);assert.equal(profile.detail,old.detail);assert.equal(profile.revision,old.revision);
  assert.ok(profile.egg.scripts.installation.script.includes('# helper refreshed'));assert.ok(!profile.egg.scripts.installation.script.includes('# helper first'));
  for(const env of ['RELEASE_SHA256','VOLTRA_TERRARIA_KIND'])assert.equal(profile.egg.variables.filter(v=>v.env_variable===env).length,1);
  assert.ok(profile.setup_steps.some(step=>step.includes(key.includes('/tmodloader/')?'may reject newer worlds':'may refuse newer worlds')));
  const variable=profile.egg.variables.find(v=>['VERSION','TERRARIA_VERSION','TSHOCK_VERSION'].includes(v.env_variable));
  // Backend PCRE anchors are tested in TestGameSelectableVersionRules.
  const pattern=variable.rules.match(/regex:\/(.*)\/$/)[1],regex=new RegExp(pattern.replaceAll('\\A','^').replaceAll('\\z','(?![\\s\\S])'));
  const valid=key.includes('/vanilla/')?['1.4.4.9','1449','latest']:['6.1.0','v6.1.0','latest'];
  for(const value of valid)assert.ok(regex.test(value),value);
  for(const value of ['../release','vlatest','1.2;echo','https://example.com','1\n2','1.2.3\n'])assert.ok(!regex.test(value),value);
 }
});


test('vanilla publisher interpreter startup is isolated and preserves every other field',()=>{
 const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),key='terraria/vanilla/egg-terraria-vanilla.json';
 const before=JSON.stringify(current),staged=stageVanillaPublisherStartup(current);assert.deepEqual(Object.keys(staged),[key]);
 assert.equal(staged[key].egg.startup,'exec /bin/bash /home/container/TerrariaServer -config serverconfig.txt -noupnp');
 const expected=structuredClone(current[key]);expected.egg.startup=staged[key].egg.startup;assert.deepEqual(staged[key],expected);
 assert.deepEqual(stageVanillaPublisherStartup(staged),staged);assert.equal(JSON.stringify(current),before);
});

test('unmodified official wrapper sets cwd and MONO_IOMAP with exact arguments and preserves files', {skip:process.platform!=='linux'},()=>{
 // Explicit local cached-wrapper input, never download or invoke a game binary.
 const publisher=fs.readFileSync(process.env.TERRARIA_PUBLISHER_WRAPPER||'.local/terraria-launcher-alignment/TerrariaServer');
 assert.equal(crypto.createHash('sha256').update(publisher).digest('hex'),'efa73e6a5c2468859f37a99dcb9cedfe16bf1b102991e6abae060489f1f05722');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'terraria-publisher-wrapper-'));
 try{
  const home=path.join(root,'server'),elsewhere=path.join(root,'elsewhere');fs.mkdirSync(home);fs.mkdirSync(elsewhere);
  const wrapper=path.join(home,'TerrariaServer');fs.writeFileSync(wrapper,publisher,{mode:0o644});
  // Harmless shell shim only. Original publisher MonoKickstart is never executed.
  fs.writeFileSync(path.join(home,'TerrariaServer.bin.x86_64'),'#!/bin/bash\nprintf "%s\\0" "$PWD" "$MONO_IOMAP" "$VOLTRA_FIXTURE_PRESERVE" "$#" "$@"\nexit 37\n',{mode:0o755});
  const operator=path.join(home,'serverconfig.txt');fs.writeFileSync(operator,'operator configuration must remain exact\n',{mode:0o640});
  const snapshot=file=>{const s=fs.statSync(file);return {bytes:fs.readFileSync(file),mode:s.mode,uid:s.uid,gid:s.gid,mtimeMs:s.mtimeMs};};
  const oldWrapper=snapshot(wrapper),oldOperator=snapshot(operator);
  for(const value of [undefined,'conflicting-operator-value']){
   const env={...process.env,VOLTRA_FIXTURE_PRESERVE:'unchanged'};if(value===undefined)delete env.MONO_IOMAP;else env.MONO_IOMAP=value;
   const result=spawnSync('/bin/bash',[wrapper,'-config','serverconfig.txt','-noupnp'],{cwd:elsewhere,env,encoding:'utf8',timeout:5000});
   assert.equal(result.error,undefined);assert.equal(result.status,37);assert.equal(result.stderr,'');
   assert.deepEqual(result.stdout.split('\0'),[home,'all','unchanged','3','-config','serverconfig.txt','-noupnp','']);
   assert.deepEqual(snapshot(wrapper),oldWrapper);assert.deepEqual(snapshot(operator),oldOperator);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
