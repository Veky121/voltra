import test from 'node:test';
import assert from 'node:assert/strict';
import {backupProtection} from '../src/client/serverProtection.ts';
const schedule=(action,active,online,next)=>({is_active:active,only_when_online:online,next_run_at:next,relationships:{tasks:{data:[{attributes:{action}}]}}});
test('protection requires an enabled backup task, not just a schedule',()=>{
 assert.deepEqual(backupProtection([schedule('power',true,false),schedule('backup',false,false)]),{count:0,next:null,onlineOnly:false});
});
test('protection selects earliest valid next run and retains online-only limitation',()=>{
 assert.deepEqual(backupProtection([schedule('backup',true,true,'2026-11-02T12:00:00Z'),schedule('backup',true,true,'2026-11-01T12:00:00Z'),schedule('backup',true,true,'invalid')]),{count:3,next:'2026-11-01T12:00:00Z',onlineOnly:true});
 assert.equal(backupProtection([schedule('backup',true,true),schedule('backup',true,false)]).onlineOnly,false);
});
