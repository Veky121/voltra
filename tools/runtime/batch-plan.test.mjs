import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildPlan} from './batch-plan.mjs';
import {claim} from './batch-queue.mjs';

test('managed native reviews prevent duplicate first acceptance without promoting recipe verification',()=>{
 const catalog={revision:'fixture',entries:['reviewed','unreviewed-proton'].map(path=>({path,sha256:'fixture',egg:{name:path,variables:[],docker_images:{},scripts:{installation:{script:''}}}}))};
 const checklist={games:catalog.entries.map(({path})=>({path,runtime_status:'not_verified'}))};
 const plan=buildPlan(catalog,checklist,[{path:'reviewed',evidence:'root-review.json'}]);
 assert.equal(plan.games[0].state,'reserved_reviewed');
 assert.equal(plan.games[0].runtime_status,'not_verified');
 assert.equal(plan.games[0].managed_native_review,'root-review.json');
 assert.equal(plan.games[1].state,'queued');
});
test('implemented profiles remain eligible for owner native acceptance after plan regeneration',()=>{
 const names=['unadapted','implemented','verified','partial','failed'];
 const catalog={revision:'fixture',entries:names.map(path=>({path,sha256:'fixture',egg:{name:path,variables:[],docker_images:{},scripts:{installation:{script:''}}}}))};
 const checklist={games:names.slice(1).map((path,i)=>({path,profile:'v1',runtime_status:['not_verified','runtime_verified','runtime_partial','runtime_failed'][i]}))};
 const plan=buildPlan(catalog,checklist);
 assert.deepEqual(plan.games.map(x=>x.state),['queued','queued','reserved_reviewed','reserved_reviewed','reserved_reviewed']);
 const state={claims:[],reservations:[{game:'implemented',owner:'owner'}]};
 const limits={memory_mib:2048,disk_mib:4096,reserved_disk_mib:0,max_active:1,port_min:28000,port_max:28010};
 const request={owner:'other',game:'implemented',memory_mib:512,disk_mib:1024,ports:1};
 assert.throws(()=>claim(state,plan,request,limits),/another worker/);
 assert.equal(claim(state,plan,{...request,owner:'owner'},limits).game,'implemented');
 assert.throws(()=>claim({claims:[]},plan,{...request,game:'verified'},limits),/reserved/);
});
