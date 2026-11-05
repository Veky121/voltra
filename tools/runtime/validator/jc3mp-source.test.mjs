import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {snapshot,recipe,sha,sourcePins,authorityPins,verifyJC3MPFrozen,emittedHelpers,verifyJC3MPHistorical,verifyExposure} from './jc3mp-canonical-check.mjs';
import {observationPython,diagnosticGate,verifyQuitDiagnostic,compareRetention} from './jc3mp-checks.mjs';
const profile=JSON.parse(fs.readFileSync(snapshot+'/internal/panel/game_library/overrides.json'))[recipe];
test('exact frozen source, raw script, LF helpers and production semantic hashes remain separate',()=>{
 assert.equal(verifyJC3MPFrozen(profile).nativeCurrentPending,true);
 for(const [path,body]of Object.entries(emittedHelpers(profile))){assert.equal(sha(body),sourcePins[path]);assert.equal(sha(body.slice(0,-1)),authorityPins[path]);assert.notEqual(sourcePins[path],authorityPins[path]);}
 for(const change of [p=>p.egg.scripts.installation.script+='\n',p=>p.egg.config.stop='quit',p=>p.required_ports=3,p=>p.egg.startup+=' ']){const p=structuredClone(profile);change(p);assert.throws(()=>verifyJC3MPFrozen(p));}
});
test('generated installed Python and native observation compile without executing imports',()=>{
 const sources=Object.fromEntries(Object.entries(emittedHelpers(profile)).filter(([name])=>name.endsWith('.py')));sources['jc3mp-observation.py']=observationPython;
 const r=spawnSync('python',['-c','import json,sys; sources=json.load(sys.stdin); [compile(body,name,"exec") for name,body in sources.items()]; print(len(sources))'],{input:JSON.stringify(sources),encoding:'utf8',windowsHide:true});
 assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.equal(Number(r.stdout.trim()),9);
});
test('historical receipt cannot become current or graceful evidence',()=>{
 const raw=fs.readFileSync('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/jc3-native-partial-acceptance.json');assert.equal(verifyJC3MPHistorical(raw).shutdownFlush,false);assert.throws(()=>verifyJC3MPHistorical(Buffer.concat([raw,Buffer.from(' ')])));
 assert.throws(()=>diagnosticGate('save'),/JC3MP_DIAGNOSTIC_REQUIRED/);
});
test('native quit validator rejects signal exit130, wrong generation and escalation',()=>{
 const live={containerId:'owned',startedAt:'2026-11-03T12:00:00Z',process:{direct:true,pid:4,startTicks:100,binarySHA256:'a'.repeat(64)}};
 const p={containerId:live.containerId,startedAt:live.startedAt,pid:4,startTicks:100,binarySHA256:live.process.binarySHA256,command:'quit',rawExit:0,elapsedMs:1000,signalSent:false,escalated:false,descendantsGone:true,running:false,oomKilled:false,dead:false,finishedAt:'2026-11-03T12:00:02Z',commandReceiptSHA256:'b'.repeat(64)};
 assert.equal(verifyQuitDiagnostic(p,live).panelStopProven,false);
 for(const edit of [{rawExit:130},{escalated:true},{startTicks:99},{elapsedMs:30001},{descendantsGone:false},{finishedAt:'invalid'},{command:'exit'}])assert.throws(()=>verifyQuitDiagnostic({...p,...edit},live));
});
test('typed authority requires revision, pointer keys and readonly managed fields',()=>{
 const b={file:'/config.json',revision:'r1',fields:[{key:'/name',type:'text'},{key:'/maxPlayers',type:'number'},{key:'/maxTickRate',type:'number'},{key:'/announce',type:'boolean'},{key:'/port',type:'readonly'}]};assert.equal(verifyExposure(b).nativeConsumptionPending,true);assert.throws(()=>verifyExposure({...b,revision:''}));assert.throws(()=>verifyExposure({...b,fields:b.fields.map(f=>f.key==='/port'?{...f,type:'number'}:f)}));
});
test('retention needs all five files, complete metadata and directory equality',()=>{
 const names=['config.json','packages/voltra-retention.txt','packages/voltra-persistence/package.json','packages/voltra-persistence/main.js','packages/voltra-persistence/data/counter.json'];const a={files:Object.fromEntries(names.map(n=>[n,{sha256:'a'.repeat(64),bytes:1,mode:416,uid:1,gid:1}])),directories:Object.fromEntries(['packages','packages/voltra-persistence','packages/voltra-persistence/data'].map(n=>[n,{mode:448,uid:1,gid:1}]))};assert.equal(compareRetention(a,structuredClone(a)).nativeReloadPending,true);const b=structuredClone(a);b.files[names[0]].uid=2;assert.throws(()=>compareRetention(a,b));delete b.files[names[1]];assert.throws(()=>compareRetention(b,b));
});
