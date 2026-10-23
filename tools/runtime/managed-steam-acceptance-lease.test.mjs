import test from 'node:test';
import assert from 'node:assert/strict';
import {managedNativeLease} from './managed-steam-acceptance-lease.mjs';

const lease=()=>({lease_id:'owned-fixture',owner:'managed_steam_bridge',game:'7_days_to_die/egg-7-days-to-die.json',status:'active',memory_mib:9216,disk_mib:33280,ports:[28010,28011,28012,28013]});
test('native managed acceptance requires a current exact owned weighted lease',()=>{
 const row=lease(),state={claims:[row]};
 assert.deepEqual(managedNativeLease(state,row.lease_id,'7days'),row);
 for(const patch of [{status:'released'},{owner:'other'},{game:'other/egg-7-days-to-die.json'},{memory_mib:8192},{disk_mib:32768},{ports:[28010,28011,28013,28014]}])assert.throws(()=>managedNativeLease({claims:[{...row,...patch}]},row.lease_id,'7days'));
 assert.throws(()=>managedNativeLease(state,'saved-stale-receipt','7days'));
});
test('native managed acceptance rejects overbooking and port overlap',()=>{
 const row=lease();
 const other={...row,lease_id:'other',owner:'other',game:'other',memory_mib:12288,ports:[28020]};
 assert.throws(()=>managedNativeLease({claims:[row,other]},row.lease_id,'7days'),/budget/);
 assert.throws(()=>managedNativeLease({claims:[row,{...other,memory_mib:512,ports:[28011]}]},row.lease_id,'7days'),/overlaps/);
 assert.throws(()=>managedNativeLease({claims:[row,...Array.from({length:7},(_,i)=>({...other,lease_id:String(i),memory_mib:1,disk_mib:1,ports:[28100+i]}))]},row.lease_id,'7days'),/budget/);
});
