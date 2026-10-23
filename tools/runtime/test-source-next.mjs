import fs from 'node:fs';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
const base='internal/panel/game_library/scripts/';
const names=[['steam_template','steam-template.py'],['source_install','source-install.py'],['native_console','native-console.py'],['source_runtime','source-runtime.py'],['source_l4d','source-l4d.py'],['source_next_install','source-next-install.py'],['source_openfortress_install','source-openfortress-install.py'],['source_wine_build','source-wine-build.py'],['source_wine_runtime','source-wine-runtime.py'],['source_next_runtime','source-next-runtime.py']];
const source='SOURCES='+JSON.stringify(names.map(([name,file])=>[name,fs.readFileSync(base+file,'utf8')]))+'\n'+fs.readFileSync('tools/runtime/test-source-next.py','utf8');
const image=spawnSync('docker',['image','inspect','python:3.13-slim','--format','{{.Id}}'],{windowsHide:true,encoding:'utf8'});if(image.status)throw Error('Pinned local fixture image unavailable');
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--cap-drop','ALL','--cap-add','CHOWN','--cap-add','FOWNER','--cap-add','DAC_OVERRIDE',image.stdout.trim(),'python3','-B','-'],{windowsHide:true,input:source,encoding:'utf8'});console.log(result.stdout+result.stderr);if(result.status)process.exit(result.status);
const profiles=JSON.parse(fs.readFileSync('.local/source-next/profiles.json')),catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
for(const [path,p]of Object.entries(profiles)){
 const original=catalog.entries.find(e=>e.path===path);assert.equal(p.upstream_sha256,original.sha256);
 for(const v of original.egg.variables)assert(p.egg.variables.some(e=>e.env_variable===v.env_variable),'Original control lost '+v.env_variable);
 for(const [,file]of names){if(file==='source-next-install.py'&&!/^(sourcecoop|open_fortress)\//.test(path))continue;if(file==='source-openfortress-install.py'&&!path.startsWith('open_fortress/'))continue;if(file.startsWith('source-wine-')&&!path.startsWith('contagion/'))continue;assert(p.egg.scripts.installation.script.includes(fs.readFileSync(base+file,'utf8')),'Stale embedded helper '+file);}
 if(path.startsWith('contagion/'))assert(p.egg.scripts.installation.script.includes(fs.readFileSync(base+'source-wine-console.c','utf8')));
 assert.equal(p.required_ports,3);assert.equal(p.egg.config.stop,'quit');
 if(path.startsWith('contagion/')){assert.equal(p.egg.variables.find(v=>v.env_variable==='WINDOWS_INSTALL').default_value,'1');assert.equal(Object.entries(p.egg.docker_images).sort(([a],[b])=>a.localeCompare(b))[0][1],'ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8');assert(!p.egg.variables.some(v=>v.env_variable==='SOURCE_TV'));}
}
console.log(Object.keys(profiles).length+' additional Source profiles retain every original control and current helpers.');
