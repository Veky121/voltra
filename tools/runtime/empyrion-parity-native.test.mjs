import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {recipe,request,validateIntegratedProfile,terminalInstallerProof} from './empyrion-parity-native.mjs';
const candidate=JSON.parse(fs.readFileSync(new URL('../../artifacts/game-parity-20261029/empyrion-parity-capacity-profile.json',import.meta.url)))[recipe];
test('measured 48 GiB candidate retains native authority and raw input proposal',()=>{
 assert.equal(validateIntegratedProfile(candidate),candidate);
 assert.deepEqual([request.memory_mib,request.disk_mib,request.ports],[6144,49152,5]);
});
test('old startup, missing preflight or buffered-console proposal and undersized disk refuse admission',()=>{
 for(const change of [p=>p.egg.startup='exec /usr/bin/python3 .voltra/space-survival.py run empyrion',p=>p.egg.scripts.installation.script=p.egg.scripts.installation.script.replace('class Parsed(Exception)','class Removed(Exception)'),p=>p.egg.scripts.installation.script=p.egg.scripts.installation.script.replace('def raw_commands(','def removed('),p=>p.defaults.disk=24576,p=>p.defaults.memory=4096]){
  const p=structuredClone(candidate);change(p);assert.throws(()=>validateIntegratedProfile(p),/Root must integrate/);
 }
});
const done={completed_at:'actual-wait-receipt',wait:{client_exit:0,container_exit:'0'}};
test('terminal success needs both callback and actual Docker completion',()=>{
 assert.deepEqual(terminalInstallerProof({success:true},done,false),{api_success:true,container_exit:0});
 for(const args of [[null,done,false],[{success:true},{...done,completed_at:undefined},false],[{success:true},{...done,wait:{client_exit:1,container_exit:'0'}},false],[{success:true},{...done,wait:{client_exit:0,container_exit:''}},false],[{success:true},done,true],[{success:true},{...done,wait:{client_exit:0,container_exit:'1'}},false]])assert.throws(()=>terminalInstallerProof(...args));
});
test('real failed installer is terminal without converting it into native success',()=>{
 assert.deepEqual(terminalInstallerProof({success:false},{...done,wait:{client_exit:0,container_exit:'17'}},false),{api_success:false,container_exit:17});
});
