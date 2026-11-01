import test from 'node:test';
import assert from 'node:assert/strict';
import {cpuThreads,cpuUsage,summarizeCPU} from '../src/admin/fleetCPUModel.ts';
test('fleet CPU weights total usage by CPU threads, including readings over one core',()=>{
 const sample=summarizeCPU([16,8],[150,75,15,0]);
 assert.equal(sample.used,2.4);assert.equal(sample.total,24);assert.equal(sample.percent,10);
 assert.equal(summarizeCPU([8],[0]).percent,0);
 assert.equal(summarizeCPU([8],[]).percent,0);
});
test('missing nodes, denied resources and malformed samples never become zero usage',()=>{
 for(const payload of [{},null,{cpu_count:0},{cpu_count:'16'}])assert.equal(cpuThreads(payload),null);
 for(const value of [undefined,null,'0',NaN,-1])assert.equal(cpuUsage({attributes:{resources:{cpu_absolute:value}}}),null);
 assert.equal(cpuUsage({attributes:{resources:{cpu_absolute:0}}}),0);
 assert.equal(cpuThreads({cpu_count:16}),16);
 assert.equal(summarizeCPU([16,null],[20,0]).percent,null);
 assert.equal(summarizeCPU([16],[20,null]).percent,null);
 assert.equal(summarizeCPU([],[]).percent,null);
});
