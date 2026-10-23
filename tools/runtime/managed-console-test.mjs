// Cross-compile upstream/fork fixtures and run actual Linux binaries without a Go image.
import fs from 'node:fs';import{resolve,join,relative}from'node:path';import{spawnSync}from'node:child_process';
const root=resolve('tools/runtime/managed-console'),out=resolve('.local/managed-console/tests');fs.mkdirSync(out,{recursive:true});
const run=(command,args,extra={})=>{const r=spawnSync(command,args,{windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024,...extra});if(r.status!==0)throw Error(command+' fixture failed: '+r.stdout+'\n'+r.stderr);return r.stdout.trim();};
const results=[];let index=0;
for(const module of [root,join(root,'third_party/telnet')]){
 const packages=run('go',['list','-f','{{if or .TestGoFiles .XTestGoFiles}}{{.ImportPath}}|{{.Dir}}{{end}}','./...'],{cwd:module}).split(/\r?\n/).filter(Boolean);
 for(const p of packages){const[pkg,dir]=p.split('|'),file='fixture-'+index++;run('go',['test','-c','-o',join(out,file),pkg],{cwd:module,env:{...process.env,GOOS:'linux',GOARCH:'amd64',CGO_ENABLED:'0',GOTOOLCHAIN:'local'}});
 const cwd='/tmp/source/'+relative(root,dir).replaceAll('\\','/');const program="import shutil,subprocess,sys;shutil.copytree('/source','/tmp/source');sys.exit(subprocess.run(['/tests/"+file+"','-test.v'],cwd="+JSON.stringify(cwd)+").returncode)";
 const text=run('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--cpus','1','--read-only','--tmpfs','/tmp:rw,size=64m','--cap-drop','ALL','--mount',`type=bind,source=${root},target=/source,readonly`,'--mount',`type=bind,source=${out},target=/tests,readonly`,'python:3.13-slim','python3','-B','-c',program]);fs.writeFileSync(join(out,file+'.log'),text+'\n');results.push({package:pkg,status:'passed',log:join(out,file+'.log')});console.log(pkg+' passed on Linux');
 }
}
fs.writeFileSync(join(out,'receipt.json'),JSON.stringify({observed_at:new Date().toISOString(),scope:'Linux loopback protocol fixtures; no actual game/download',results},null,2)+'\n');
