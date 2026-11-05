import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const old=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/wings-root-build.json'));
const paths=JSON.parse(fs.readFileSync(old.manifest)).inputs.map(e=>e.path).concat('server/crash_diagnostic.go','server/crash_diagnostic_test.go');assert.equal(new Set(paths).size,paths.length);
const source=path.resolve('.local/wings-source'),dir=path.resolve('.local/game-parity-20261029/wings-diagnostic-build-'+Date.now()),snapshot=path.join(dir,'input');fs.mkdirSync(snapshot,{recursive:true});
const entries=paths.map(p=>{const from=path.join(source,p),to=path.join(snapshot,p),h=sha(from);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);assert.equal(sha(to),h);return {path:p,sha256:h,bytes:fs.statSync(from).size}});
const fingerprint=crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({source,snapshot,entries,fingerprint},null,2)+'\n');
const go='C:/Users/Veky/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.27.3.windows-amd64/bin/go.exe';assert(fs.existsSync(go));
const env={...process.env,GOOS:'linux',GOARCH:'amd64',CGO_ENABLED:'0',GOMAXPROCS:'2',GOMEMLIMIT:'1GiB',GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off'};
const run=async(name,args)=>{const log=fs.openSync(path.join(dir,name+'.log'),'w');const started=Date.now();const code=await new Promise((resolve,reject)=>{const p=spawn(go,args,{cwd:snapshot,env,windowsHide:true,stdio:['ignore',log,log]});p.on('error',reject);p.on('exit',resolve)});fs.closeSync(log);assert.equal(code,0,name+' failed; see '+path.join(dir,name+'.log'));return {command:[go,...args],exit:code,elapsed_seconds:(Date.now()-started)/1000,log:path.join(dir,name+'.log')}};
const report={at:new Date().toISOString(),source,snapshot,dir,manifest:path.join(dir,'manifest.json'),inputs:entries.length,fingerprint,env,previous_build:old.snapshot,activation:false};delete report.env.DATABASE_URL;report.env=Object.fromEntries(['GOOS','GOARCH','CGO_ENABLED','GOMAXPROCS','GOMEMLIMIT','GOTOOLCHAIN','GOPROXY','GOSUMDB'].map(k=>[k,env[k]]));
fs.writeFileSync('.local/game-parity-20261029/wings-crash-diagnostic/build-location.json',JSON.stringify({dir,snapshot},null,2)+'\n');
report.version=await run('version',['version']);console.log(fs.readFileSync(report.version.log,'utf8').trim());
report.test_compile=await run('test-compile',['test','-c','-mod=readonly','-trimpath','-o',path.join(dir,'server-tests-linux-amd64'),'./server']);console.log('Linux server test compile PASS');
report.build=await run('build',['build','-mod=readonly','-trimpath','-o',path.join(dir,'wings-linux-amd64'),'wings.go']);console.log('Linux Wings build PASS');
for(const e of entries){assert.equal(sha(path.join(source,e.path)),e.sha256,'Source drift '+e.path);assert.equal(sha(path.join(snapshot,e.path)),e.sha256,'Snapshot drift '+e.path)}
report.binaries=Object.fromEntries(['server-tests-linux-amd64','wings-linux-amd64'].map(n=>[n,{path:path.join(dir,n),sha256:sha(path.join(dir,n)),bytes:fs.statSync(path.join(dir,n)).size}]));report.source_snapshot_unchanged=true;
fs.writeFileSync('artifacts/game-parity-20261029/wings-crash-diagnostic-build.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({dir,inputs:entries.length,binaries:report.binaries}));
