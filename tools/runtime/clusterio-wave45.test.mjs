import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {applySettings,preflightSetup,roleSettings} from '../../internal/panel/game_library/scripts/clusterio-start.mjs';
import {stageClusterio,recipe} from './stage-clusterio-wave45.mjs';
const base=path.resolve('internal/panel/game_library/scripts');
const helpers=Object.fromEntries(['clusterio-start.mjs','clusterio-setup.mjs','clusterio-controller.mjs'].map(n=>[n,fs.readFileSync(path.join(base,n),'utf8')]));
const host={SERVER_MODE:'host',SERVER_PORT:'24561',SERVER_IP:'192.0.2.1',HOST_NAME:'Fixture',CONTROLLER_URL:'https://controller.invalid/',CONTROLLER_TOKEN:'head.'+Buffer.from(JSON.stringify({aud:'host',host:42})).toString('base64url')+'.sig',VOLTRA_ALLOCATED_PORTS:'24561,24562',PLUGINS:''};
function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clusterio-wave45-'));try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('JSON arrays, scalars and malformed configs refuse with identical bytes',()=>fixture(dir=>{
 for(const value of ['[]','null','42','"secret"','{"secret":']){
  const file=path.join(dir,'config-host.json');fs.writeFileSync(file,value);
  assert.throws(()=>applySettings(dir,host));assert.throws(()=>preflightSetup(dir,host));
  assert.equal(fs.readFileSync(file,'utf8'),value);assert.deepEqual(fs.readdirSync(dir),['config-host.json']);
 }
}));
test('preflight checks plugins, administrator and package shape without writes',()=>fixture(dir=>{
 for(const env of [{...host,PLUGINS:'https://bad.invalid/pkg'},{...host,SERVER_MODE:'controller',CLUSTER_NAME:'Factory',ADMIN_STRING:' '}])assert.throws(()=>preflightSetup(dir,env));
 assert.deepEqual(fs.readdirSync(dir),[]);
 fs.writeFileSync(path.join(dir,'package.json'),'[]');assert.throws(()=>preflightSetup(dir,host));
 assert.equal(fs.readFileSync(path.join(dir,'package.json'),'utf8'),'[]');
}));
test('host merge preserves nested unknown arrays, token bytes and unrelated config files',()=>fixture(dir=>{
 const file=path.join(dir,'config-host.json');const operator={'plugin.rows':[{secret:'private',values:[1,false,'001']}],'host.controller_token':'old'};
 fs.writeFileSync(file,JSON.stringify(operator));fs.writeFileSync(path.join(dir,'config-controller.json'),'operator bytes');
 applySettings(dir,host);const result=JSON.parse(fs.readFileSync(file));assert.deepEqual(result['plugin.rows'],operator['plugin.rows']);assert.equal(result['host.controller_token'],host.CONTROLLER_TOKEN);assert.equal(result['host.factorio_port_range'],'24561,24562');assert.equal(fs.readFileSync(path.join(dir,'config-controller.json'),'utf8'),'operator bytes');
}));
test('stager preserves every profile property except installer bytes and emits exact helpers',()=>{
 const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
 const staged=stageClusterio(current,helpers),profile=staged[recipe],before=structuredClone(current[recipe]);
 const script=profile.egg.scripts.installation.script;
 for(const [name,source]of Object.entries(helpers))assert.ok(script.includes(`cat > .voltra/${name} <<'VOLTRA_HELPER'\n${source}\nVOLTRA_HELPER\n`));
 assert.ok(script.indexOf("preflightSetup('.',process.env)")<script.indexOf('apt-get update'));
 assert.ok(script.indexOf('VOLTRA_CLUSTERIO_PREFLIGHT\napt-get update')<script.indexOf('mkdir -p .voltra'));
 profile.egg.scripts.installation.script=before.egg.scripts.installation.script;assert.deepEqual(profile,before);assert.deepEqual(Object.keys(staged),[recipe]);
});
test('setup npm success and failure are mocked, protected saves and mods survive',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clusterio-wave45-setup-')),cwd=process.cwd(),env={...process.env};
 try{
  process.chdir(dir);Object.assign(process.env,host);fs.mkdirSync('.voltra');fs.mkdirSync('instances');fs.mkdirSync('mods');fs.writeFileSync('instances/save.zip','save bytes');fs.writeFileSync('mods/operator.zip','mod bytes');fs.writeFileSync('config-host.json',JSON.stringify({...roleSettings(host),'operator.array':[1,2]}));
  const config=fs.readFileSync('config-host.json','utf8');
  for(const status of [1,0]){
   const calls=[];globalThis.clusterioWave45Spawn=(binary,args)=>{calls.push({binary,args});return {status,stdout:''};};
   const source=helpers['clusterio-setup.mjs'].replace("import {spawnSync} from 'node:child_process';","const spawnSync=globalThis.clusterioWave45Spawn;").replace("'./clusterio-start.mjs'",JSON.stringify(pathToFileURL(path.join(base,'clusterio-start.mjs')).href));
   const run=import('data:text/javascript;base64,'+Buffer.from(source+`\n// fixture ${status}`).toString('base64'));
   if(status)await assert.rejects(run,/setup command failed/);else await run;
   assert.equal(calls.length,1);assert.equal(calls[0].binary,'npm');assert.equal(fs.readFileSync('config-host.json','utf8'),config);assert.equal(fs.readFileSync('instances/save.zip','utf8'),'save bytes');assert.equal(fs.readFileSync('mods/operator.zip','utf8'),'mod bytes');
  }
 }finally{delete globalThis.clusterioWave45Spawn;process.chdir(cwd);for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);fs.rmSync(dir,{recursive:true,force:true});}
});
