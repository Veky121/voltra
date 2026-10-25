// Compile embedded Python without executing it; compare known helpers to source.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {embeddedPython} from './embedded-python.mjs';
const scripts='internal/panel/game_library/scripts';
const sources=new Map(fs.readdirSync(scripts).filter(n=>n.endsWith('.py')).map(n=>[n.slice(0,-3).replaceAll('-','_'),fs.readFileSync(path.join(scripts,n),'utf8')]));
const normalize=s=>s.replaceAll('\r\n','\n').trimEnd();
const profiles=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const modules=[],mismatches=[];
for(const [recipe,profile] of Object.entries(profiles)){
 for(const match of embeddedPython(profile.egg.scripts.installation.script)){
  const name=path.posix.basename(match.file).slice(0,-3).replaceAll('-','_');
  modules.push({recipe,name,source:normalize(match.source)});
  if(sources.has(name)&&normalize(match.source)!==normalize(sources.get(name)))mismatches.push({recipe,module:name});
 }
}
const inspect=spawnSync('docker',['image','inspect','python:3.13-slim','--format','{{.Id}}'],{encoding:'utf8',windowsHide:true});
if(inspect.error||inspect.status||!/^sha256:[a-f0-9]{64}\s*$/.test(inspect.stdout))throw Error('Existing Python helper image required; no automatic pull performed');
const code='import json,sys\nerrors=[]\nfor m in json.load(sys.stdin):\n try: compile(m["source"],m["recipe"]+":"+m["name"],"exec")\n except SyntaxError as e: errors.append({"recipe":m["recipe"],"module":m["name"],"line":e.lineno,"error":e.msg})\nprint(json.dumps(errors))';
const result=spawnSync('docker',['run','--rm','--pull','never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--cpus','1','-i',inspect.stdout.trim(),'python3','-B','-c',code],{input:JSON.stringify(modules),encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:8*1024*1024});
if(result.error||result.status!==0)throw Error('Python syntax audit failed: '+(result.error?.message||result.stderr));
const syntaxErrors=JSON.parse(result.stdout);
const report={scope:'Embedded Python heredocs only. Compilation does not execute imports or prove native behavior. Known helper comparisons normalize line endings and trailing whitespace.',profiles:Object.keys(profiles).length,embedded_modules:modules.length,source_mismatches:mismatches,syntax_errors:syntaxErrors};
fs.writeFileSync('artifacts/game-profile-python-source-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(mismatches.length||syntaxErrors.length)process.exitCode=1;
