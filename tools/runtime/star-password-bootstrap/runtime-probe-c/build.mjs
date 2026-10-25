// MIT. Approved source/offline build only. Never execute either Windows output.
import fs from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';import{spawnSync}from'node:child_process';import crypto from'node:crypto';
const src=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(src,'../../../..'),out=path.join(root,'.local/star-password-bootstrap/runtime-probe-c');fs.mkdirSync(out,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),msvc='C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC/14.44.35207',sdk='C:/Program Files (x86)/Windows Kits/10',version='10.0.26100.0',python='C:/Users/Veky/AppData/Local/Python/pythoncore-3.15-64/python.exe';
const cl=msvc+'/bin/Hostx64/x64/cl.exe',link=msvc+'/bin/Hostx64/x64/link.exe',library=sdk+'/Lib/'+version+'/um/x64/kernel32.lib';
const env={...process.env,INCLUDE:[msvc+'/include',sdk+'/Include/'+version+'/ucrt',sdk+'/Include/'+version+'/shared',sdk+'/Include/'+version+'/um'].join(';'),LIB:msvc+'/lib/x64;'+sdk+'/Lib/'+version+'/um/x64'};
function run(exe,args,cwd=src){const r=spawnSync(exe,args,{cwd,env,windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:1048576});if(r.status||r.error)throw Error(r.stderr||r.stdout||String(r.error));return(r.stdout+r.stderr).trim();}
const tests=run(python,['test_policy.py']);
const parserTests=run(python,[path.join(src,'../runtime-probe/test-import-parser.py')]);
const compileFlags=['/nologo','/c','/TC','/O1','/Oi-','/GS-','/Zl','/utf-8'];
const linkFlags=['/nologo','/NODEFAULTLIB','/ENTRY:probe_entry','/SUBSYSTEM:CONSOLE','/MACHINE:X64','/INCREMENTAL:NO','/BREPRO','/DYNAMICBASE','/NXCOMPAT'];
const builds=[];
for(const name of ['build1','build2']){const dir=path.join(out,name);fs.mkdirSync(dir,{recursive:true});const object=path.join(dir,'probe.obj'),exe=path.join(dir,'star-c-runtime-probe.exe');run(cl,[...compileFlags,'/Fo'+object,path.join(src,'probe.c')],dir);run(link,[...linkFlags,'/OUT:'+exe,'/MAP:'+path.join(dir,'probe.map'),object,library],dir);builds.push({path:exe,sha256:sha(fs.readFileSync(exe)),bytes:fs.statSync(exe).size,map:path.join(dir,'probe.map')});}
if(builds[0].sha256!==builds[1].sha256)throw Error('Two-build C reproducibility mismatch');
fs.copyFileSync(builds[0].path,path.join(out,'star-c-runtime-probe.exe'));fs.copyFileSync(path.join(src,'LICENSE'),path.join(out,'LICENSES.txt'));
const sourceFiles=Object.fromEntries(fs.readdirSync(src).filter(n=>fs.statSync(path.join(src,n)).isFile()).sort().map(n=>[n,sha(fs.readFileSync(path.join(src,n)))]));
const toolFiles=Object.fromEntries([cl,link,library,sdk+'/Include/'+version+'/um/Windows.h'].map(p=>[p,sha(fs.readFileSync(p))]));
const record={phase:'source_offline_build_only',builds,deterministic_rebuild:true,compile_flags:compileFlags,link_flags:linkFlags,source_files:sourceFiles,tool_files:toolFiles,policy_fixtures:tests,parser_fixtures:parserTests,windows_binary_executed:false,native_compatibility_verified:false,game_or_ms_installer_run:false,go_failures_preserved:true};
fs.writeFileSync(path.join(out,'build.json'),JSON.stringify(record,null,2)+'\n');console.log(run(python,['verify_pe.py']));
