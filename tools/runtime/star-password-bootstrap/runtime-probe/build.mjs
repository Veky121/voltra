// MIT. Deterministic fixed-input probe build/test only; never run probe main.
import fs from'node:fs';import path from'node:path';import{spawnSync}from'node:child_process';import crypto from'node:crypto';import{fileURLToPath}from'node:url';
const source=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(source,'../../../..'),output=path.join(root,'.local/star-password-bootstrap/runtime-probe');fs.mkdirSync(output,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const env={...process.env,GOOS:'windows',GOARCH:'amd64',GOAMD64:'v1',CGO_ENABLED:'0',GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off'};
function run(exe,args,cwd=source){const r=spawnSync(exe,args,{cwd,env,windowsHide:true,encoding:'utf8',maxBuffer:1048576,timeout:120000});if(r.error||r.status)throw Error(r.stderr||r.stdout||String(r.error));return (r.stdout+r.stderr).trim();}
const python='C:/Users/Veky/AppData/Local/Python/pythoncore-3.15-64/python.exe';
const parserTests=run(python,['test-import-parser.py']);
const before=sha(fs.readFileSync(path.join(source,'imports.json')));run(python,['generate-imports.py']);if(before!==sha(fs.readFileSync(path.join(source,'imports.json'))))throw Error('Reviewed fixed import manifest drift');
const policyTests=run('go',['test','-count=1','.']);
const exe=path.join(output,'star-runtime-probe.exe'),flags=['-trimpath','-buildvcs=false','-ldflags','-s -w -buildid='];
run('go',['build',...flags,'-o',exe,'.']);const first=sha(fs.readFileSync(exe));run('go',['build',...flags,'-o',exe,'.']);if(first!==sha(fs.readFileSync(exe)))throw Error('Deterministic rebuild mismatch');
const goroot=run('go',['env','GOROOT']);fs.writeFileSync(path.join(output,'LICENSES.txt'),fs.readFileSync(path.join(source,'LICENSE'),'utf8')+'\nGo runtime license:\n\n'+fs.readFileSync(path.join(goroot,'LICENSE'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(source,'imports.json'))),files=Object.fromEntries(fs.readdirSync(source).filter(n=>fs.statSync(path.join(source,n)).isFile()).sort().map(n=>[n,sha(fs.readFileSync(path.join(source,n)))]));
const record={phase:'built_offline_not_native_run',source_files:files,target:'windows/amd64',compiler:run('go',['version']),flags,probe_sha256:first,probe_bytes:fs.statSync(exe).size,notices_sha256:sha(fs.readFileSync(path.join(output,'LICENSES.txt'))),import_libraries:Object.keys(manifest.imports).length,import_exports:Object.values(manifest.imports).reduce((s,v)=>s+v.length,0),parser_fixtures:parserTests,policy_fixtures:policyTests,deterministic_rebuild:true,probe_main_executed:false,game_or_ue4ss_loaded:false,palworld_files_changed:false,native_compatibility_verified:false};
fs.writeFileSync(path.join(output,'bundle.json'),JSON.stringify(record,null,2)+'\n');fs.writeFileSync(path.join(root,'artifacts/star-password-bootstrap-runtime-probe.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
