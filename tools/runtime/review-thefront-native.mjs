import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const d='.local/thefront-native',read=n=>JSON.parse(fs.readFileSync(path.join(d,n))),hash=b=>createHash('sha256').update(b).digest('hex');
const before=read('before-final-reinstall.json'),after=read('after-final-reinstall.json'),final=read('after-native-restarts.json');
assert.deepEqual(before.files,after.files);assert.deepEqual(before.release,after.release);assert.deepEqual(before.release,final.release);
for(const [name,row]of Object.entries(before.files))assert.deepEqual(row,final.files[name],name);
const added=Object.keys(final.files).filter(n=>!before.files[n]);assert.equal(added.length,2);assert(added.every(n=>n.includes('/CrashReportClient/')&&n.endsWith('/CrashReportClient.ini')));
let actualArchiveFiles=0,actualArchiveBytes=0;
for(const tag of ['corrected','final']){
 const manifest=read('native-state-'+tag+'/manifest.json'),snap=tag==='corrected'?before:final;
 for(const [name,row]of Object.entries(manifest)){
  assert(!name.split('/').includes('..')&&!path.isAbsolute(name));
  const bytes=fs.readFileSync(path.join(d,'native-state-'+tag,name));assert.equal(bytes.length,row.bytes);assert.equal(hash(bytes),row.sha256);
  assert.deepEqual(row,snap.files['TheFrontManager/new/'+name]);actualArchiveFiles++;actualArchiveBytes+=bytes.length;
 }
}
const manifest=read('canonical-source-final-retention/manifest.json');
for(const row of manifest.modules){const bytes=fs.readFileSync(path.join(d,'canonical-source-final-retention',row.name));assert.equal(hash(bytes),row.sha256);assert.equal(bytes.length,row.bytes);assert.deepEqual(bytes,fs.readFileSync(path.join(d,'installed-source-final-retention',row.name)));}
const state=read('final-stop.json').state;
assert.equal(state.Running,false);assert.equal(state.Pid,0);assert.equal(state.OOMKilled,false);assert.equal(state.ExitCode,130);
const log=read('final-stop.json').logs;
for(const marker of ['LogExit: Game engine shut down','LogExit: Object subsystem successfully closed.','LogExit: Exiting.','RequestExit(bForce=false, ReturnCode=130)'])assert(log.includes(marker));
for(const tag of ['post-reinstall','post-restart']){const r=read(tag+'-ready-watch.json');assert.equal(r.panel,'running');for(const marker of ['load game file success, name=Basic','load game file success, name=Foliage','world baisc restored','restore game complete'])assert(r.loaded.some(x=>x.includes(marker)));}
let fileLogs=0;for(const dir of ['native-file-logs','native-file-logs-corrected','native-file-logs-final'])for(const [name,row]of Object.entries(read(dir+'/manifest.json'))){const b=fs.readFileSync(path.join(d,dir,name));assert.equal(b.length,row.bytes);assert.equal(hash(b),row.sha256);fileLogs++;}
const result={pass:true,strict_reinstall_rows:Object.keys(before.files).length,native_unchanged_rows:Object.keys(before.files).length,native_added_crash_configs:added.length,actual_archive_files:actualArchiveFiles,actual_archive_bytes:actualArchiveBytes,actual_installed_helper_bytes:manifest.modules.length,actual_file_logs:fileLogs,release:before.release,final_native_exit:state.ExitCode,semantic_native_load_generations:2};
fs.writeFileSync(d+'/independent-review-inputs.json',JSON.stringify(result,null,2)+'\n');console.log(result);
