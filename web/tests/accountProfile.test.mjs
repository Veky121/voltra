import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accountNickname} from '../src/client/accountProfile.ts';

test('display name uses saved nickname, then login username without using email',()=>{
  assert.equal(accountNickname({nickname:'  My nickname 🦊  ',email:'player@example.test',username:'login'}),'My nickname 🦊');
  assert.equal(accountNickname({email:'player.name+games@example.test',username:'login'}),'login');
  assert.equal(accountNickname({nickname:' ',email:'player@example.test'}),'User');
  assert.equal(accountNickname({username:'login-only'}),'login-only');
  assert.equal(accountNickname({}),'User');
});

test('email-shaped display names never expose an address',()=>{
  assert.equal(accountNickname({nickname:'contact@example.test',username:'player'}),'player');
  assert.equal(accountNickname({email:'private@example.test'}),'User');
  assert.equal(accountNickname({username:'private@example.test'}),'User');
});
