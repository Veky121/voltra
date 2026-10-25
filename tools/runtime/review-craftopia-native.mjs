import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const d='.local/craftopia-native';
const read=n=>JSON.parse(fs.readFileSync(`${d}/${n}`));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const before=read('before-final-reinstall.json'),after=read('after-final-reinstall.json'),final=read('final-stopped-snapshot.json');
assert.deepEqual(before.files,after.files);assert.deepEqual(before.release,after.release);
let archived=0;
for(const tag of ['before-final-reinstall','final-stopped']){
 const m=read(`native-state-${tag}/manifest.json`);
 for(const[n,v]of Object.entries(m.files)){const b=fs.readFileSync(`${d}/native-state-${tag}/${n}`);assert.equal(b.length,v.bytes);assert.equal(sha(b),v.sha256);assert.deepEqual(v,(tag==='final-stopped'?final:before).files[n]);archived++;}
 for(const v of Object.values(m.sqlite_inventory))assert.equal(v.quick_check,'ok');
}
const source=read('canonical-source-log-relay/manifest.json');
for(const tag of ['final-retention','final-stopped']){
 const installed=read(`installed-source-${tag}/manifest.json`);
 for(const v of source.modules){const a=fs.readFileSync(`${d}/canonical-source-log-relay/${v.name}`),b=fs.readFileSync(`${d}/installed-source-${tag}/${v.name}`);assert.equal(sha(a),v.sha256);assert.deepEqual(a,b);assert.equal(sha(b),installed[v.name].sha256);}
}
for(const tag of ['post-reinstall','post-restart']){
 const w=read(`watch-${tag}.json`);assert.equal(w.ready,true);assert.equal(w.samples.at(-1).state,'running');
 const log=fs.readFileSync(`${d}/${tag}-ready.log`,'utf8');assert(log.includes('World is loaded!'));assert(!log.includes('Native log relay unavailable.'));
}
const stop=read('final-stop.json');assert.equal(stop.state.Running,false);assert.equal(stop.state.Pid,0);assert.equal(stop.state.ExitCode,0);assert.equal(stop.state.OOMKilled,false);
assert(fs.readFileSync(`${d}/final-stop.log`,'utf8').includes('Shutdown handler: cleanup.'));
assert.notEqual(read('normal-restart-request.json').before.StartedAt,stop.state.StartedAt);
const ini=fs.readFileSync(`${d}/native-state-final-stopped/ServerSetting.ini`,'utf8');
assert(ini.includes('Disposable Voltra operator comment retained across reinstall'));assert(ini.includes('Literal = $value ; unknown setting retained'));
assert(final.files['DedicatedServerSave/Worlds/y65efezp43v0.db']);
for(const[n,v]of Object.entries(read('native-file-logs-final-stopped/manifest.json'))){const b=fs.readFileSync(`${d}/native-file-logs-final-stopped/${n}`);assert.equal(b.length,v.bytes);assert.equal(sha(b),v.sha256);}
const result={at:new Date().toISOString(),strict_reinstall_rows:Object.keys(before.files).length,archived_actual_rows_verified:archived,source_helpers_per_checkpoint:source.modules.length,source_checkpoints:2,actual_fresh_ready_generations:2,final_native_state:stop.state,operator_ini_comment_unknown_preserved:true,sqlite_quick_check:true,world_file:'DedicatedServerSave/Worlds/y65efezp43v0.db',cleanup_not_yet_authorized:true};
fs.writeFileSync(`${d}/independent-archive-review.json`,JSON.stringify(result,null,2)+'\n');console.log(result);
