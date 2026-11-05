import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('regression verdict requires stable inputs, all checks, cleanup and completed results',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'voltra-regression-verdict-'));
 try {
  for(const scenario of ['pass','changed','added','vet','driver','cleanup','empty','unfinished','package-failure','invalid-log']){
   const dir=path.join(root,scenario);fs.mkdirSync(dir);
   const before=[{path:'example.go',sha256:'a'}];
   const after=scenario==='changed'?[{path:'example.go',sha256:'b'}]:scenario==='added'?[...before,{path:'new.go',sha256:'c'}]:before;
   const report={command:{exit_code:0},driver_exit:scenario==='driver'?1:0,go_vet_exit:scenario==='vet'?1:0,database_cleanup:{cleanup:scenario!=='cleanup'}};
   const events=scenario==='empty'?[]:[{Package:'fixture',Test:'TestFixture',Action:'pass'},{Package:'fixture',Action:'pass'}];
   if(scenario==='unfinished')events.push({Package:'unfinished',Action:'start'});
   if(scenario==='package-failure')events.push({Package:'failed',Action:'fail'});
   for(const [name,value]of [['source-before.json',before],['source-after.json',after],['report.json',report]])fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
   fs.writeFileSync(path.join(dir,'go-test.jsonl'),events.map(event=>JSON.stringify(event)).join('\n')+(scenario==='invalid-log'?'\ntruncated event': ''));
   const result=spawnSync(process.execPath,['tools/runtime/summarize-source-regression.mjs',dir],{encoding:'utf8',windowsHide:true});
   assert.equal(result.status,scenario==='pass'?0:1,`${scenario}: ${result.stderr}`);
   const saved=JSON.parse(fs.readFileSync(path.join(dir,'report.json')));
   assert.equal(saved.outcome,scenario==='pass'?'source_regression_passed':'source_regression_failed',scenario);
   assert.equal(saved.verification_failures.length===0,scenario==='pass',scenario);
  }
 } finally {
  const resolved=path.resolve(root);
  assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('voltra-regression-verdict-'));
  fs.rmSync(resolved,{recursive:true,force:true});
 }
});
