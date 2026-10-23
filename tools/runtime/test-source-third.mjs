import fs from 'node:fs';import{spawnSync}from'node:child_process';import assert from'node:assert/strict';
const base='internal/panel/game_library/scripts/',names=['steam-template.py','native-console.py','source-install.py','source-runtime.py','source-next-install.py','source-l4d.py','source-third-install.py','source-third-runtime.py'];
const source='SOURCES='+JSON.stringify(names.map(name=>[name.slice(0,-3).replaceAll('-','_'),fs.readFileSync(base+name,'utf8')]))+'\n'+fs.readFileSync('tools/runtime/test-source-third.py','utf8');
const image=spawnSync('docker',['image','inspect','python:3.13-slim','--format','{{.Id}}'],{windowsHide:true,encoding:'utf8'});if(image.status)throw Error('Pinned local Python image unavailable');
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--cap-drop','ALL','--cap-add','CHOWN','--cap-add','FOWNER',image.stdout.trim(),'python3','-B','-'],{windowsHide:true,input:source,encoding:'utf8',timeout:60000});console.log(result.stdout+result.stderr);if(result.status)process.exit(result.status);
const profiles=JSON.parse(fs.readFileSync('.local/source-third/profiles.json')),catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
for(const [path,p]of Object.entries(profiles)){
 const entry=catalog.entries.find(e=>e.path===path);assert.equal(p.upstream_sha256,entry.sha256);for(const variable of entry.egg.variables)assert(p.egg.variables.some(v=>v.env_variable===variable.env_variable),'Original control lost: '+variable.env_variable);
 for(const name of names)assert(p.egg.scripts.installation.script.includes(fs.readFileSync(base+name,'utf8')),'Stale helper: '+name);
 assert.equal(p.egg.config.stop,'quit');assert.equal(p.verification,'not_verified');assert.equal(p.required_ports,path.includes('counter_strike_2')?2:1);
}
console.log('Three disjoint Source profiles retain all original variables and current helpers.');
