// Read-only verification of a stopped, receipt-owned disposable batch server.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {ownedStoppedServer} from './cache-owned-server.mjs';

export async function reviewOwnedVolume({receiptPath, records, terminalProof, output}) {
  const expected={};
  for(const [name, row] of Object.entries(records)) {
    assert(name && name.length<=2048 && !name.includes('\\') && !name.includes('\0') && !name.startsWith('/') && name.split('/').every(p=>p && p!=='.' && p!=='..'), 'Unsafe audit path');
    assert(/^[a-f0-9]{64}$/.test(row.sha256), 'Expected SHA256 required');
    assert(Object.keys(row).every(k=>['sha256','size','bytes','mode','uid','gid'].includes(k)), 'Unknown expected identity field');
    const normalized={...row};
    if(row.size!==undefined) {
      assert(row.bytes===undefined || row.bytes===row.size, 'Conflicting byte counts');
      normalized.bytes=row.size;delete normalized.size;
    }
    expected[name]=normalized;
  }
  assert(Object.keys(expected).length>0 && Object.keys(expected).length<=100000, 'Audit record budget');
  const outputPath=path.resolve(output), artifacts=path.resolve('artifacts')+path.sep;
  assert(outputPath.startsWith(artifacts), 'Audit output must be under artifacts');
  const {receipt:s,node,image}=await ownedStoppedServer(receiptPath);
  const inspect=spawnSync('docker',['inspect','--format','{{json .State}}',s.uuid],{windowsHide:true,encoding:'utf8'});
  assert.equal(inspect.status,0,inspect.stderr);
  const state=JSON.parse(inspect.stdout);
  assert.equal(state.Running,false);assert.equal(state.Pid,0);
  for(const key of ['StartedAt','FinishedAt','ExitCode','OOMKilled'])assert.equal(state[key],terminalProof.state[key],key);
  assert.equal(terminalProof.uuid,s.uuid);
  const code=`import hashlib,json,stat,sys
from pathlib import Path
root=Path('/v');result=[]
for name,want in json.load(sys.stdin).items():
 p=root
 for part in Path(name).parts:
  assert part not in ('.','..')
  p=p/part
  assert not p.is_symlink(),name
 assert p.is_file() and p.resolve().is_relative_to(root),name
 s=p.stat();assert stat.S_ISREG(s.st_mode),name
 h=hashlib.sha256()
 with p.open('rb') as stream:
  for block in iter(lambda:stream.read(1048576),b''):h.update(block)
 after=p.stat()
 assert (s.st_ino,s.st_size,s.st_mtime_ns,s.st_mode,s.st_uid,s.st_gid)==(after.st_ino,after.st_size,after.st_mtime_ns,after.st_mode,after.st_uid,after.st_gid),name
 got={'sha256':h.hexdigest(),'bytes':s.st_size,'mode':oct(stat.S_IMODE(s.st_mode)),'uid':s.st_uid,'gid':s.st_gid}
 for key,value in want.items():assert got[key]==value,(name,key)
 result.append({'path':name,**got})
print(json.dumps(result))`;
  const checked=spawnSync('docker',['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--cpus','1','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/v,readonly`,'-i',image,'python3','-B','-c',code],{windowsHide:true,encoding:'utf8',input:JSON.stringify(expected),maxBuffer:16e6,timeout:60000});
  assert.equal(checked.status,0,checked.error?.message||checked.stderr);
  // Establish that this stayed the same stopped generation during the review.
  const final=spawnSync('docker',['inspect','--format','{{json .State}}',s.uuid],{windowsHide:true,encoding:'utf8'});
  assert.equal(final.status,0,final.stderr);
  const finalState=JSON.parse(final.stdout);
  for(const key of ['Running','Pid','StartedAt','FinishedAt','ExitCode','OOMKilled'])assert.equal(finalState[key],state[key],key);
  const report={at:new Date().toISOString(),scope:'Independent read-only stopped disposable volume review before cleanup',uuid:s.uuid,node:s.node,state:{running:false,pid:0,raw_exit:state.ExitCode,oom:state.OOMKilled,started:state.StartedAt,finished:state.FinishedAt},records:JSON.parse(checked.stdout)};
  fs.writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n');
  return report;
}
