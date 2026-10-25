import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const dir='.local/sandstorm-optional-tokens',base='internal/panel/game_library/scripts/';
const stageRequested=process.argv.includes('--stage');
const names=['steam-template.py','native-console.py','source-install.py','source-next-install.py','tactical-install.py','tactical-runtime.py'];
const old=fs.readFileSync(dir+'/tactical-runtime-before.py','utf8');
const current=fs.readFileSync(base+'tactical-runtime.py','utf8');
const marker="    else:\n        maximum = integer(env, 'maxplayers'";
assert.equal(current.slice(current.indexOf(marker)),old.slice(old.indexOf(marker)),'Other branch source drift');
let tests=fs.readFileSync('tools/runtime/test-tactical.py','utf8');assert(tests.includes('unittest.main()'));tests=tests.replace('unittest.main()','');
// Inherit only the shared fixture method; existing TacticalTests run once.
let added=fs.readFileSync('tools/runtime/test-sandstorm-tokens.py','utf8').replace('class SandstormOptionalTokenTests(TacticalTests):','class SandstormOptionalTokenTests(unittest.TestCase):\n    fixture = TacticalTests.fixture');
const input='SOURCES='+JSON.stringify(names.map(n=>[n.slice(0,-3).replaceAll('-','_'),fs.readFileSync(base+n,'utf8')]))+'\nOLD_RUNTIME='+JSON.stringify(old)+'\n'+tests+'\n'+added+'\nunittest.main()\n';
const image=spawnSync('docker',['image','inspect','python:3.13-slim','--format','{{.Id}}'],{windowsHide:true,encoding:'utf8'});assert.equal(image.status,0);
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--cap-drop','ALL','--cap-add','CHOWN','--cap-add','FOWNER',image.stdout.trim(),'python3','-B','-'],{windowsHide:true,input,encoding:'utf8',timeout:60000});
fs.writeFileSync(dir+(stageRequested?'/fixtures.log':'/fixtures-root-current.log'),result.stdout+result.stderr);console.log(result.stdout+result.stderr);assert.equal(result.status,0);
const profiles=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));const staged={};const manifest=[];
const prefix="cat > .voltra/tactical_runtime.py <<'VOLTRA_SOURCE'\n",end='\nVOLTRA_SOURCE';
for(const [path,p] of Object.entries(profiles)){
 const script=p.egg?.scripts?.installation?.script;if(!script?.includes(prefix))continue;
 const start=script.indexOf(prefix)+prefix.length,finish=script.indexOf(end,start);assert(finish>start);
 const embedded=script.slice(start,finish).replace(/\r\n/g,'\n').trimEnd();
 assert(embedded===old.replace(/\r\n/g,'\n').trimEnd()||embedded===current.replace(/\r\n/g,'\n').trimEnd(),'Unexpected helper '+path);
 const copy=structuredClone(p);copy.egg.scripts.installation.script=script.slice(0,start)+current.replace(/\r\n/g,'\n').replace(/\n$/,'')+script.slice(finish);
 const check=structuredClone(copy);check.egg.scripts.installation.script=script;assert.deepEqual(check,p,'Metadata changed');
 staged[path]=copy;
 const target=dir+'/eggs/'+path;const bytes=Buffer.from(JSON.stringify(copy,null,2)+'\n');if(stageRequested){fs.mkdirSync(target.slice(0,target.lastIndexOf('/')),{recursive:true});fs.writeFileSync(target,bytes);}manifest.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
assert.equal(Object.keys(staged).length,12);
if(stageRequested){fs.writeFileSync(dir+'/profiles.json',JSON.stringify(staged,null,2)+'\n');fs.writeFileSync(dir+'/tactical-runtime.py',current);fs.writeFileSync(dir+'/manifest.json',JSON.stringify({created_at:new Date().toISOString(),helper_sha256:createHash('sha256').update(current).digest('hex'),profiles:manifest},null,2)+'\n');}
console.log(stageRequested?'Twelve scoped embeddings staged; metadata unchanged.':'Twelve scoped embeddings checked; staged receipts left unchanged.');
