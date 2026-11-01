// Compile embedded Python without executing it; compare known helpers to source.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {embeddedPython} from './embedded-python.mjs';
const scripts='internal/panel/game_library/scripts';
const output=process.argv[2]||'artifacts/game-profile-python-source-audit.json';
const sources=new Map(fs.readdirSync(scripts).filter(n=>n.endsWith('.py')).map(n=>[n.slice(0,-3).replaceAll('-','_'),fs.readFileSync(path.join(scripts,n),'utf8')]));
const normalize=s=>s.replaceAll('\r\n','\n').replace(/^\uFEFF/,'').trimEnd();
const catalog='internal/panel/game_library/overrides.json',catalogBytes=fs.readFileSync(catalog);
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const profiles=JSON.parse(catalogBytes);
const modules=[],mismatches=[];
for(const [recipe,profile] of Object.entries(profiles)){
 for(const match of embeddedPython(profile.egg.scripts.installation.script)){
  const name=path.posix.basename(match.file).slice(0,-3).replaceAll('-','_');
  // Compile emitted bytes, retaining a possible encoding marker. Only the
  // comparison below ignores the semantically equivalent UTF-8 BOM.
  modules.push({recipe,name,source:match.source+'\n'});
  if(sources.has(name)&&normalize(match.source)!==normalize(sources.get(name)))mismatches.push({recipe,module:name});
 }
}
const inspect=spawnSync('docker',['image','inspect','python:3.13-slim','--format','{{.Id}}'],{encoding:'utf8',windowsHide:true});
if(inspect.error||inspect.status||!/^sha256:[a-f0-9]{64}\s*$/.test(inspect.stdout))throw Error('Existing Python helper image required; no automatic pull performed');
const code='import json,sys\nerrors=[]\nfor m in json.load(sys.stdin):\n try: compile(m["source"].encode("utf-8"),m["recipe"]+":"+m["name"],"exec")\n except SyntaxError as e: errors.append({"recipe":m["recipe"],"module":m["name"],"line":e.lineno,"error":e.msg})\nprint(json.dumps(errors))';
const result=spawnSync('docker',['run','--rm','--pull','never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--cpus','1','-i',inspect.stdout.trim(),'python3','-B','-c',code],{input:JSON.stringify(modules),encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:8*1024*1024});
if(result.error||result.status!==0)throw Error('Python syntax audit failed: '+(result.error?.message||result.stderr));
const syntaxErrors=JSON.parse(result.stdout);
const report={scope:'Embedded Python heredocs only. Compilation uses emitted UTF-8 bytes including the final heredoc newline, without imports or native behavior. Known source comparisons normalize line endings, a leading UTF-8 BOM and trailing whitespace; mismatches may be generated specializations and require review.',catalog_sha256:digest(catalogBytes),catalog_unchanged:digest(fs.readFileSync(catalog))===digest(catalogBytes),image:inspect.stdout.trim(),profiles:Object.keys(profiles).length,embedded_modules:modules.length,source_mismatches:mismatches,syntax_errors:syntaxErrors};
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!report.catalog_unchanged||mismatches.length||syntaxErrors.length)process.exitCode=1;
