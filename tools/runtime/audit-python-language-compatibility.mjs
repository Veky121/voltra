// Diagnostic syntax screen. This does not establish runtime/library compatibility.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {embeddedPython} from './embedded-python.mjs';

const output = process.argv[2];
if (!output) throw Error('Provide a new output receipt path');
if (fs.existsSync(output)) throw Error('Preserve existing receipts; choose a new path');
const catalog = 'internal/panel/game_library/overrides.json';
const raw = fs.readFileSync(catalog);
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const modules = [];
for (const [recipe, profile] of Object.entries(JSON.parse(raw))) {
  for (const entry of embeddedPython(profile.egg.scripts.installation.script)) {
    const emitted=entry.source+'\n';
    modules.push({recipe, file: entry.file, source: emitted, sha256: digest(emitted)});
  }
}
const inspect = spawnSync('docker', ['image', 'inspect', 'python:3.13-slim', '--format', '{{.Id}}'], {encoding:'utf8', windowsHide:true});
if (inspect.error || inspect.status || !/^sha256:[a-f0-9]{64}\s*$/.test(inspect.stdout)) throw Error('Cached Python image required; no pull attempted');
const code = `import ast,json,sys
modules=json.load(sys.stdin)
errors=[]
for m in modules:
 for minor in (9,11,13):
  try:
   ast.parse(m['source'].encode('utf-8'),filename=m['file'],feature_version=(3,minor))
  except SyntaxError as e:
   errors.append(dict(recipe=m['recipe'],file=m['file'],sha256=m['sha256'],python='3.'+str(minor),line=e.lineno,error=e.msg))
print(json.dumps(dict(interpreter=sys.version,errors=errors)))`;
const result = spawnSync('docker', ['run','--rm','--pull','never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--cpus','1','-i',inspect.stdout.trim(),'python3','-B','-c',code], {input:JSON.stringify(modules),encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:16*1024*1024});
if (result.error || result.status) throw Error(result.error?.message || result.stderr);
const parsed = JSON.parse(result.stdout);
const unchanged = digest(fs.readFileSync(catalog)) === digest(raw);
const report = {
  scope: 'AST syntax screening of exact emitted UTF-8 Python bytes for diagnostic language versions 3.9, 3.11 and 3.13. No imports, module execution, native server, dependency/ABI checks or actual installer version claim.',
  catalog_sha256: digest(raw), catalog_unchanged: unchanged,
  image: inspect.stdout.trim(), modules: modules.length,
  ...parsed,
};
fs.mkdirSync(path.dirname(output), {recursive:true});
fs.writeFileSync(output, JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({modules:modules.length,errors:parsed.errors.length,catalog_unchanged:unchanged,output}));
if (!unchanged || parsed.errors.length) process.exitCode=1;
