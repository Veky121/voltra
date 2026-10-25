import test from 'node:test';
import assert from 'node:assert/strict';
import {privateAuthorizationBody, privateGuardReply, privateGuardUsable} from '../src/client/privateSteamModel.ts';

test('private Steam credentials preserve opaque literals and omit unsaved passwords', () => {
  const username='  user λ " +quit  ', password='  secret \\ " λ\n  ';
  assert.deepEqual(privateAuthorizationBody(username,true,password),{username,password,save_password:true});
  assert.deepEqual(privateAuthorizationBody(username,false,password),{username,save_password:false});
  assert.throws(()=>privateAuthorizationBody('',true,password),/account name/);
  assert.throws(()=>privateAuthorizationBody(username,true,''),/password/);
});

test('Guard replies refuse expired, malformed and unsupported challenges', () => {
  const now=Date.parse('2026-10-24T00:00:00Z');
  const guard={challenge_id:'challenge',kind:'email_code',expires_at:new Date(now+1000).toISOString()};
  assert.equal(privateGuardUsable(guard,now),true);
  assert.deepEqual(privateGuardReply(guard,{code:'  0λ  '},now),{challenge_id:'challenge',kind:'email_code',code:'  0λ  '});
  for(const changed of [{expires_at:new Date(now).toISOString()},{expires_at:'invalid'},{kind:'future_kind'},{challenge_id:''}]) {
    assert.equal(privateGuardUsable({...guard,...changed},now),false);
    assert.throws(()=>privateGuardReply({...guard,...changed},{code:'123'},now),/expired/);
  }
  assert.throws(()=>privateGuardReply(guard,{accepted:true},now),/code/);
});

test('device confirmation supports explicit decline without accepting mixed reply shapes', () => {
  const guard={challenge_id:'challenge',kind:'device_confirmation',expires_at:'2026-10-24T00:00:20Z'};
  const now=Date.parse('2026-10-24T00:00:00Z');
  for(const accepted of [true,false])assert.deepEqual(privateGuardReply(guard,{accepted},now),{challenge_id:'challenge',kind:'device_confirmation',accepted});
  assert.throws(()=>privateGuardReply(guard,{code:'123'},now),/Confirm or decline/);
  assert.throws(()=>privateGuardReply(guard,{accepted:true,code:'123'},now),/Confirm or decline/);
});
