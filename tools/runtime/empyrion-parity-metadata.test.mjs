import test from 'node:test';import assert from 'node:assert/strict';
import {parseAppInfo,assess,assessShared,steamArgs,request,activeLicenses} from './empyrion-parity-metadata.mjs';
test('fixed primary metadata command cannot acquire game payload or activate a license',()=>{
 assert.deepEqual(steamArgs.slice(-3),['+app_info_print','530870','+quit']);
 assert(!steamArgs.some(x=>/app_update|download_depot|app_license_request/.test(x)));
 assert.equal(steamArgs[steamArgs.indexOf('+login')+1],'anonymous');assert.equal(request.ports,0);assert.equal(request.memory_mib,1024);
});
test('actual active-license query is bounded to target app and never converts absence into denial',()=>{
 const positive='License packageID 17906:\n - State : Active (flags 0x0)\n - Apps : 530870, 1007, (2 in total)\n - Depots : 530871, (1 in total)\n"530870" { "common" { "name" "Empyrion" } }';
 const result=activeLicenses(positive);assert.equal(result.active_app_license_observed,true);assert.deepEqual(result.packages[0].depots,['530871']);
 assert.equal(activeLicenses(positive.replace('530870, 1007','42, 1007')).active_app_license_observed,false);
 assert.equal(activeLicenses(positive.replace('State : Active','State : Expired')).active_app_license_observed,false);
 assert.equal(activeLicenses('Unknown command licenses_for_app').active_app_license_observed,false);assert.equal(activeLicenses('').unknown_if_empty,true);
});
test('exact app VDF preserves escapes and nested metadata without executing content',()=>{
 const app=parseAppInfo('Steam client noise\n"530870"\n{ "common" { "name" "Empyrion Dedicated Server" "type" "Tool" } "depots" { "branches" { "public" { "buildid" "123" } } } }\nSteam quit');
 assert.equal(app.common.name,'Empyrion Dedicated Server');assert.equal(assess(app).public_build,'123');
 assert.throws(()=>parseAppInfo('"1" { "name" "wrong app" }'));
 assert.throws(()=>parseAppInfo('"530870" { "common" "a" "common" "b" }'));
});
test('capacity counts Windows/common depots and keeps entitlement unknown',()=>{
 const app={common:{name:'Empyrion',type:'Tool',FreeToDownload:'1'},depots:{'1':{config:{oslist:'windows'},manifests:{public:{gid:'11',size:String(12*1024**3)}}},'2':{config:{oslist:'linux'},manifests:{public:{gid:'22',size:String(100*1024**3)}}}}};
 const result=assess(app);assert.equal(result.total_unpacked_bytes,String(12*1024**3));assert.equal(result.fits_proposed24GiB_initial,true);assert.equal(result.fits_proposed24GiB_reinstall,false);assert.match(result.anonymous_depot_entitlement,/NOT PROVEN/);assert.equal(result.game_content_acquired,false);
});
test('missing manifest sizes/shared app depots cannot produce a positive capacity claim',()=>{
 for(const row of [{depotfromapp:'228980'},{manifests:{public:{gid:'1'}}},{manifests:{public:{size:'1'}}},{config:{oslist:'windows'},encryptedmanifests:{public:'x'}}]){
  const result=assess({depots:{'1':row}});assert.equal(result.capacity_known,false);assert.equal(result.fits_proposed24GiB_initial,null);
 }
});
test('shared query selects exact referenced depots and never totals unrelated application content',()=>{
 const main={depots:{'530871':{manifests:{public:{gid:'1',size:'18000000000'}}},'1004':{depotfromapp:'1007'},'228988':{depotfromapp:'228980'}}};
 const sources={'1007':{depots:{'1004':{manifests:{public:{gid:'2',size:'200000000'}}},'1005':{manifests:{public:{gid:'3',size:'999999999999'}}}}},'228980':{depots:{'228988':{manifests:{public:{gid:'4',size:'300000000'}}}}}};
 const result=assessShared(main,sources);assert.equal(result.capacity_known,true);assert.equal(result.total_unpacked_bytes,'18500000000');assert.equal(result.resolved_shared_depots.length,2);assert.equal(result.fits_proposed48GiB_reinstall,true);
 assert.equal(assessShared(main,{'1007':sources['1007']}).capacity_known,false);
 assert.equal(parseAppInfo('"1007" { "common" { "type" "Tool" } }',1007).common.type,'Tool');assert.throws(()=>parseAppInfo('"42" {}',42));
});
