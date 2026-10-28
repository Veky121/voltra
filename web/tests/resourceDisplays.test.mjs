import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {formatBytesGB,formatMiBGB} from '../src/resourceUnits.ts';

const source=readFileSync(new URL('../src/client/common.tsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('export function resourceUsageGB'));
const compiled=ts.transpile(helpers,{module:ts.ModuleKind.CommonJS});
const exports={};
new Function('exports','formatBytesGB','formatMiBGB',compiled)(exports,formatBytesGB,formatMiBGB);
const {resourceUsageGB,resourceLimitGB,resourceReadingGB}=exports;

test('resource readings convert byte usage and MiB limits independently to GB',()=>{
  assert.equal(resourceReadingGB(512*1024**2,1024),'0.5 / 1 GB');
  assert.equal(resourceReadingGB(1024**3,512),'1 / 0.5 GB');
  assert.equal(resourceReadingGB(1024,10240),'<0.1 / 10 GB');
  assert.equal(resourceReadingGB(2.21*1024**3,15000),'2.2 / 14.6 GB');
  assert.equal(resourceUsageGB(1024),'<0.001 GB');
  assert.equal(resourceLimitGB(1),'<0.001 GB');
});
test('zero usage, unlimited limits and absent data remain distinct',()=>{
  assert.equal(resourceReadingGB(0,0),'0 GB / ∞');
  assert.equal(resourceReadingGB(undefined,1024),'Unavailable');
  for(const value of [undefined,null,'',NaN,Infinity,-1]){
    assert.equal(resourceUsageGB(value),'Unavailable');
    assert.equal(resourceLimitGB(value),'Unavailable');
  }
});
test('resource cards use GB while network and file sizes retain adaptive units',()=>{
  const read=name=>readFileSync(new URL(`../src/client/${name}.tsx`,import.meta.url),'utf8');
  assert.match(read('Overview'),/resourceReadingGB\(r.memory_bytes,s.limits\?\.memory\)/);
  assert.match(read('Overview'),/resourceReadingGB\(r.disk_bytes,s.limits\?\.disk\)/);
  assert.match(read('FileStorageSummary'),/resourceUsageGB\(used\)/);
  assert.match(read('ServerDashboard'),/format=\{formatBytesGB\}/);
  assert.match(read('ServerDashboard'),/bytes\(n\).*\/s/);
  assert.match(read('Operations'),/bytes\(b.bytes\)/);
  assert.match(source,/\["B", "KiB", "MiB", "GiB", "TiB"\]/);
});
