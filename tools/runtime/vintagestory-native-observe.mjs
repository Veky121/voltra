import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
import {api,docker,verifyRuntime,activeLease,runtime,digest} from './campaign-native-20261029.mjs';
const dir=path.resolve('.local/game-parity-20261029/vintagestory-native'),s=JSON.parse(fs.readFileSync(path.join(dir,'state.json'))),uuid=s.fixture.server.uuid;
if(s.paused||JSON.parse(fs.readFileSync(runtime+'/queue.json')).activation_pause)throw Error('Campaign pause');const receipt=await verifyRuntime();assert.equal(receipt.binary_sha256,s.runtime.binary_sha256);activeLease(s.lease.lease_id,'vintagestory_native');
const base='/api/client/servers/'+uuid,state=(await api(base+'/resources')).attributes.current_state;
const proof={at:new Date().toISOString(),backend_pid:receipt.pid},phase=process.argv[2];
if(phase==='protocol'){
 assert.equal(state,'running');
 for(const command of ['/serverconfig name','/serverconfig description','/serverconfig maxclients']){await api(base+'/command','POST',{command});await new Promise(r=>setTimeout(r,750));}
 const log=docker(['logs',uuid],true).toString('utf8').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'');fs.writeFileSync(path.join(dir,'native-query.log'),log);
 proof.console_lines=log.split('\n').filter(x=>/Vintage typed native|Owned native description|maxclients|Current value|Server name|serverconfig/.test(x)).slice(-18);
 const port=s.lease.ports[0],hex=port.toString(16).toUpperCase().padStart(4,'0');
 const sockets=docker(['exec',uuid,'sh','-c','cat /proc/net/tcp /proc/net/tcp6 /proc/net/udp /proc/net/udp6']);
 proof.native_listener_rows=sockets.split('\n').filter(x=>x.includes(':'+hex));assert.ok(proof.native_listener_rows.length>=2);
 proof.loopback_tcp_connected=await new Promise((resolve,reject)=>{const socket=net.connect({host:'127.0.0.1',port},()=>{socket.destroy();resolve(true);});socket.setTimeout(3000,()=>{socket.destroy();reject(Error('Owned TCP connection timeout'));});socket.on('error',reject);});
 proof.actual_typed_name_in_native_output=log.includes('Vintage typed native $safe');proof.actual_typed_description_in_native_output=log.includes('Owned native description');
 proof.client_boundary='TCP listener/connect plus native CLI configuration readback; no authenticated player-client/gameplay or UDP packet exchange claim.';
 proof.command_source='https://wiki.vintagestory.at/List_of_server_commands/serverconfig';
 fs.writeFileSync(path.join(dir,'protocol.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}else if(phase==='crash'){
 assert.equal(state,'running');assert.equal(JSON.parse(fs.readFileSync(path.join(runtime,'wings-private.json'))).system.crash_detection.enabled,false,'Automatic crash restart must remain disabled');
 const program="import os,pathlib,signal,json; found=[]\nfor p in pathlib.Path('/proc').iterdir():\n if p.name.isdigit():\n  try:\n   args=(p/'cmdline').read_bytes().split(b'\\0')\n   if any(a.endswith(b'/VintagestoryServer.dll') for a in args):found.append(int(p.name))\n  except (OSError,ProcessLookupError):pass\nassert len(found)==1,found\nassert found[0]>1\nprint(json.dumps({'native_dotnet_pid':found[0],'signal':9}),flush=True)\nos.kill(found[0],signal.SIGKILL)";
 proof.kill=JSON.parse(docker(['exec',uuid,'python3','-c',program]));proof.actual_docker_wait=Number(docker(['wait',uuid]).trim());assert.equal(proof.actual_docker_wait,137);
 for(let i=0;i<100;i++){if((await api(base+'/resources')).attributes.current_state==='offline')break;await new Promise(r=>setTimeout(r,100));}
 proof.panel_state=(await api(base+'/resources')).attributes.current_state;assert.equal(proof.panel_state,'offline');const container=JSON.parse(docker(['inspect',uuid]))[0];proof.actual_state=container.State;assert.equal(container.State.OOMKilled,false);assert.equal(container.State.ExitCode,137);
 const log=docker(['logs',uuid],true).toString('utf8');fs.writeFileSync(path.join(dir,'native-crash.log'),log);proof.raw_diagnostics=log.split('\n').filter(x=>x.includes('Native process exited'));assert.equal(proof.raw_diagnostics.length,1);assert.match(proof.raw_diagnostics[0],/\[ERROR\].*raw_status=-9; signal=9 .*stop_requested=false/);
 proof.auto_restart_enabled=false;fs.writeFileSync(path.join(dir,'crash.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}else if(phase==='integrity'){
 assert.equal(state,'offline');
 const program="import sqlite3,json,pathlib,hashlib,shutil; p=pathlib.Path('/v/data/Saves/default.vcdbs'); target=pathlib.Path('/tmp/proof'); target.mkdir(); family=list(p.parent.glob(p.name+'*')); [shutil.copy2(f,target/f.name) for f in family]; c=sqlite3.connect(str(target/p.name)); print(json.dumps({'source_family':[{ 'file':f.name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size} for f in family],'quick_check':c.execute('pragma quick_check').fetchall(),'tables':c.execute('select count(*) from sqlite_master').fetchone()[0],'boundary':'Stopped database family copied from read-only source into bounded private tmpfs; original never opened writable'}))";
 const result=spawnSync('docker',['--context','desktop-linux','run','--rm','--network','none','--memory','256m','--memory-swap','256m','--cpus','1','--tmpfs','/tmp:rw,noexec,nosuid,size=67108864','--mount',`type=bind,src=/var/lib/voltra-parity-20261029/volumes/${uuid},dst=/v,readonly`,'python:3.12-slim','python','-B','-c',program],{encoding:'utf8',windowsHide:true});if(result.status!==0){fs.writeFileSync(path.join(dir,'integrity-error.txt'),result.stderr);throw Error(result.stderr);}const out=result.stdout;proof.database=JSON.parse(out);assert.deepEqual(proof.database.quick_check,[['ok']]);proof.receipt_sha256=digest(out);fs.writeFileSync(path.join(dir,'integrity-'+Date.now()+'.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}else throw Error('Use protocol|integrity');
