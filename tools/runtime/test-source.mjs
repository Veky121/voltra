import fs from 'node:fs';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
const base='internal/panel/game_library/scripts/';
const script=[['STEAM_SOURCE','steam-template.py'],['INSTALL_SOURCE','source-install.py'],['CONSOLE_SOURCE','native-console.py'],['RUNTIME_SOURCE','source-runtime.py'],['L4D_SOURCE','source-l4d.py'],['VARIANT_SOURCE','source-variant-runtime.py']].map(([key,name])=>key+'='+JSON.stringify(fs.readFileSync(base+name,'utf8'))).join('\n')+'\n'+fs.readFileSync('tools/runtime/test-source.py','utf8');
const image=spawnSync('docker',['image','inspect','python:3.13-slim','--format','{{.Id}}'],{windowsHide:true,encoding:'utf8'});
if(image.status||!/^sha256:[a-f0-9]{64}$/.test(image.stdout.trim()))throw Error('Install the local Python helper image before Source fixtures');
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--cap-drop','ALL','--cap-add','CHOWN','--cap-add','FOWNER','--cap-add','DAC_OVERRIDE',image.stdout.trim(),'python3','-B','-'],{windowsHide:true,input:script,encoding:'utf8'});
console.log(result.stdout+result.stderr);if(result.status!==0)process.exit(result.status??1);
const staged=JSON.parse(fs.readFileSync('.local/source-games/profiles.json'));
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
for(const [key,profile]of Object.entries(staged)){
 const original=catalog.entries.find(e=>e.path===key);
 assert.equal(profile.upstream_sha256,original.sha256);
 for(const variable of original.egg.variables)assert(profile.egg.variables.some(v=>v.env_variable===variable.env_variable),`${key} lost ${variable.env_variable}`);
 const l4d=key.startsWith('left4dead/');const l4d2=key.startsWith('left4dead_2/');
 assert.equal(profile.required_ports,l4d||l4d2?1:3);assert.equal(profile.egg.config.stop,'quit');
 if(l4d||l4d2){assert.equal(JSON.parse(profile.egg.config.startup).done,'VOLTRA_L4D_MAP_READY');assert(profile.egg.scripts.installation.script.includes(fs.readFileSync(base+'source-l4d.py','utf8')));}
 if(l4d||l4d2)for(const unsupported of ['MAX_PLAYERS','TV_ENABLE','SRCDS_STV'])assert(!profile.egg.variables.some(v=>v.env_variable===unsupported));
 assert(profile.egg.scripts.installation.script.includes(fs.readFileSync(base+'source-runtime.py','utf8')));
 assert(profile.egg.features.includes('voltra_steam_template'));
 assert(profile.egg.scripts.installation.script.includes(fs.readFileSync(base+'source-install.py','utf8')));
 if(profile.egg.startup.includes('source_variant_runtime'))assert(profile.egg.scripts.installation.script.includes(fs.readFileSync(base+'source-variant-runtime.py','utf8')));
}
console.log(`${Object.keys(staged).length} staged Source profiles preserve original variables and embed current helpers.`);
