import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accountNickname} from '../src/client/accountProfile.ts';

test('display name uses saved nickname, then email local part, then login username',()=>{
  assert.equal(accountNickname({nickname:'  My nickname 🦊  ',email:'player@example.test',username:'login'}),'My nickname 🦊');
  assert.equal(accountNickname({email:'player.name+games@example.test',username:'login'}),'player.name+games');
  assert.equal(accountNickname({nickname:' ',email:'player@example.test'}),'player');
  assert.equal(accountNickname({username:'login-only'}),'login-only');
  assert.equal(accountNickname({}),'');
});
