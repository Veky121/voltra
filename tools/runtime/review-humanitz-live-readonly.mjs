import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ownedStoppedServer} from './cache-owned-server.mjs';

const dir='.local/humanitz-native';
const read=p=>JSON.parse(fs.readFileSync(`${dir}/${p}`));
const {receipt:s,node,image}=await ownedStoppedServer(`${dir}/private.json`);
assert.equal(s.node,249);
const state=spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'});
assert.equal(state.status,0);
const actualState=JSON.parse(state.stdout)[0].State;
assert.equal(actualState.ExitCode,130);
assert.equal(actualState.Running,false);
assert.equal(actualState.OOMKilled,false);
assert.equal(actualState.Pid,0);
assert.equal(actualState.StartedAt,read('final-stop.json').state.StartedAt);

const expected={...read('after-native-restarts.json').files};
const world=read('native-world-final/manifest.json');
for(const [path,entry]of Object.entries(world)){
  const bytes=fs.readFileSync(`${dir}/native-world-final/${path}`);
  assert.equal(bytes.length,entry.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
  assert.equal(bytes.subarray(0,4).toString('ascii'),'GVAS');
  assert.deepEqual(entry,read('native-world-first/manifest.json')[path]);
  expected[`HumanitZServer/Saved/SaveGames/${path}`]=entry;
}
const sources=read('installed-source-final/manifest.json');
for(const [path,entry]of Object.entries(sources))expected[`.voltra/${path}`]=entry;
const code=`import hashlib,json,stat,sys
from pathlib import Path
root=Path('/v');expected=json.load(sys.stdin);verified=[]
for name,want in expected.items():
 p=root
 for part in Path(name).parts:
  assert part not in ('..','.')
  p=p/part
  assert not p.is_symlink(),name
 assert p.resolve().is_relative_to(root) and p.is_file(),name
 s=p.stat();assert stat.S_ISREG(s.st_mode),name
 h=hashlib.sha256()
 with p.open('rb') as stream:
  for block in iter(lambda:stream.read(1048576),b''):h.update(block)
 got={'sha256':h.hexdigest(),'bytes':s.st_size,'mode':oct(stat.S_IMODE(s.st_mode)),'uid':s.st_uid,'gid':s.st_gid}
 for key,value in want.items():assert got[key]==value,(name,key)
 verified.append({'path':name,**got})
print(json.dumps({'verified':verified}))`;
const result=spawnSync('docker',['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--cpus','1','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/v,readonly`,'-i',image,'python3','-B','-c',code],{windowsHide:true,encoding:'utf8',input:JSON.stringify(expected),maxBuffer:2e6});
assert.equal(result.status,0,result.stderr);
const verified=JSON.parse(result.stdout).verified;
const report={at:new Date().toISOString(),scope:'Independent read-only stopped disposable HumanitZ volume review before cleanup',uuid:s.uuid,node:s.node,container:{started:actualState.StartedAt,raw_exit:130,pid:0,oom:false},live_records_verified:verified.length,source_files:Object.keys(sources).length,genuine_gvas_world_files:Object.keys(world).length,world_bytes:Object.values(world).reduce((n,v)=>n+v.bytes,0),world_archive_hashes_verified:true,first_final_world_manifest_equal:true,records:verified,limits:['No gameplay or explicit publisher world-load acknowledgement','No native query success claim','Read-only review does not establish compatibility of every legacy setting']};
fs.writeFileSync('artifacts/humanitz-live-readonly-root-review.json',JSON.stringify(report,null,2)+'\n');
console.log({live_records:verified.length,source_files:report.source_files,world_files:report.genuine_gvas_world_files,world_bytes:report.world_bytes,raw_exit:130});
