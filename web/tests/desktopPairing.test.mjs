import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopPairingString,parseDesktopPairing} from '../src/desktopPairing.ts';

test('one paste preserves panel address, path, port and pairing code',()=>{
  for(const panel of ['https://panel.example.test','http://127.0.0.1:8088','https://[::1]:8443/panel']) {
    assert.deepEqual(parseDesktopPairing(` ${desktopPairingString(panel,'TEST-PAIRING')} `),{panel_url:panel,code:'TEST-PAIRING'});
  }
});
test('invalid connection strings fail without reflecting credentials',()=>{
  for(const value of ['secret','https://example.test','voltra://connect?panel=javascript%3Asecret&code=secret','voltra://connect?panel=https%3A%2F%2Fuser%3Asecret%40example.test&code=secret','voltra://connect?panel=https%3A%2F%2Fexample.test&code=secret&code=other']) {
    assert.throws(()=>parseDesktopPairing(value),error=>!error.message.includes('secret'));
  }
});
