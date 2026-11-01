// Static local-helper import candidates, without importing or running game code.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {embeddedPython} from './embedded-python.mjs';

const output=process.argv[2];
if(!output||fs.existsSync(output))throw Error('Provide a new output receipt path');
const file='internal/panel/game_library/overrides.json', raw=fs.readFileSync(file);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const known=fs.readdirSync('internal/panel/game_library/scripts').filter(n=>n.endsWith('.py')).map(n=>n.slice(0,-3).replaceAll('-','_'));
const profiles=Object.entries(JSON.parse(raw)).map(([recipe,p])=>({recipe,modules:embeddedPython(p.egg.scripts.installation.script).map(m=>({...m,source:m.source+'\n'}))}));
const inspected=spawnSync('docker',['image','inspect','python:3.13-slim','--format','{{.Id}}'],{encoding:'utf8',windowsHide:true});
if(inspected.error||inspected.status||!/^sha256:[a-f0-9]{64}\s*$/.test(inspected.stdout))throw Error('Cached Python image required; no pull attempted');
const code=String.raw`import ast,json,posixpath,sys
def imports(source):
 tree=ast.parse(source.encode('utf-8'))
 result=set()
 for node in tree.body:
  if isinstance(node,ast.Import): result.update(alias.name.split('.')[0] for alias in node.names)
  elif isinstance(node,ast.ImportFrom) and node.level==0 and node.module: result.add(node.module.split('.')[0])
 return result
assert imports('import alpha as a\nfrom beta.child import x\ndef f():\n import deferred\n')=={'alpha','beta'}
data=json.load(sys.stdin)
known=set(data['known']); candidates=[]; errors=[]; count=0
for profile in data['profiles']:
 available={posixpath.basename(m['file'])[:-3] for m in profile['modules']}
 for module in profile['modules']:
  count+=1
  try: missing=sorted((imports(module['source']) & known)-available)
  except SyntaxError as e:
   errors.append(dict(recipe=profile['recipe'],file=module['file'],line=e.lineno,error=e.msg)); continue
  if missing: candidates.append(dict(recipe=profile['recipe'],file=module['file'],missing_local_modules=missing))
print(json.dumps(dict(modules=count,candidates=candidates,syntax_errors=errors)))`;
const run=spawnSync('docker',['run','--rm','--pull','never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--cpus','1','-i',inspected.stdout.trim(),'python3','-B','-c',code],{encoding:'utf8',windowsHide:true,input:JSON.stringify({known,profiles}),timeout:60000,maxBuffer:8*1024*1024});
if(run.error||run.status)throw Error([run.error?.message,run.stderr].filter(Boolean).join('\n'));
const result=JSON.parse(run.stdout);
const report={scope:'Top-level absolute imports referring to known repository Python helpers, compared with literal Python heredoc basenames in each exact profile. Static candidates only: no import execution, conditional/dynamic imports, shell copy/download analysis, sys.path resolution, package/ABI checks or native acceptance.',catalog_sha256:hash(raw),catalog_unchanged:hash(fs.readFileSync(file))===hash(raw),image:inspected.stdout.trim(),profiles:profiles.length,...result};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({profiles:report.profiles,modules:report.modules,candidates:report.candidates.length,syntax_errors:report.syntax_errors.length,catalog_unchanged:report.catalog_unchanged,output}));
if(!report.catalog_unchanged||report.syntax_errors.length)process.exitCode=1;
