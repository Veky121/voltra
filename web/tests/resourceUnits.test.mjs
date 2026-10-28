import test from 'node:test';
import assert from 'node:assert/strict';
import {gbToMiB,miBToGB,formatBytesGB,formatMiBGB} from '../src/resourceUnits.ts';

test('GB forms preserve existing limits and accept ordinary decimal amounts',()=>{
  assert.equal(gbToMiB('8'),8192);
  assert.equal(miBToGB(8192),8);
  assert.equal(gbToMiB('8.1'),8294);
  assert.equal(gbToMiB('0.5'),512);
  for(const limit of [0,1,100,512,8192,12345,16777216]) assert.equal(gbToMiB(String(miBToGB(limit))),limit);
});
test('invalid amounts cannot become unlimited limits',()=>{
  for(const input of ['', ' ', 'no', 'Infinity', '-1', '0.000001', Number.MAX_VALUE]) assert.ok(Number.isNaN(gbToMiB(input)),String(input));
  assert.equal(gbToMiB('0'),0);
});
test('resource readings stay in GB below one GB without hiding nonzero usage',()=>{
  assert.equal(formatMiBGB(512),'0.5 GB');
  assert.equal(formatBytesGB(8*1024**3),'8 GB');
  assert.equal(formatBytesGB(1024),'<0.001 GB');
  assert.equal(formatBytesGB(0),'0 GB');
  assert.equal(formatBytesGB(NaN),'Unavailable');
});
