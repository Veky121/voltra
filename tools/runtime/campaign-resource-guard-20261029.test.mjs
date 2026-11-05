import {test} from 'node:test';
import assert from 'node:assert/strict';
import {campaignDefaults,assertCampaignAdmission,assertInstallerProof} from './campaign-resource-guard-20261029.mjs';
const request=()=>({lease:{memory_mib:2048,status:'active'},build:campaignDefaults({memory_mib:2048}),hostAvailableBytes:20*1024**3,diskFreeBytes:110*1024**3});
test('exact lease reserves hard memory with no swap and one CPU',()=>{const p=assertCampaignAdmission(request());assert.equal(p.expected_docker.Memory,2147483648);assert.equal(p.expected_docker.MemorySwap,2147483648);assertInstallerProof(p.expected_docker,p.expected_docker)});
test('reject unlimited CPU, swap and memory',()=>{for(const k of ['cpu','swap','memory']){const r=request();r.build[k]=k==='swap'?-1:0;assert.throws(()=>assertCampaignAdmission(r))}});
test('retain host headroom and four-core aggregate budget',()=>{for(const patch of [{hostAvailableBytes:15*1024**3},{diskFreeBytes:99*1024**3},{activeCpuPercent:301},{installerCount:1}])assert.throws(()=>assertCampaignAdmission({...request(),...patch}))});
test('reject terminal lease and unproven installer resources',()=>{const r=request();r.lease.status='blocked';assert.throws(()=>assertCampaignAdmission(r));const p=assertCampaignAdmission(request()).expected_docker;assert.throws(()=>assertInstallerProof({...p,CpuQuota:0},p));assert.throws(()=>assertInstallerProof({...p,Memory:2469606195},p))});
test('accept actual Docker inspect CPU spelling and reject absent proof',()=>{
  const input=request();input.lease.memory_mib=128;input.build=campaignDefaults(input.lease);
  const expected=assertCampaignAdmission(input).expected_docker;
  // Sanitized HostConfig fields captured from the real Wings-created installer.
  const actual={Memory:134217728,MemorySwap:134217728,CpuPeriod:100000,CpuQuota:100000,OomKillDisable:null};
  assertInstallerProof(actual,expected);
  assert.throws(()=>assertInstallerProof({...actual,CpuQuota:undefined},expected));
  assert.throws(()=>assertInstallerProof(actual,{}));
  assert.throws(()=>assertInstallerProof(actual,{Memory:134217728,MemorySwap:134217728,CPUPeriod:100000,CPUQuota:100000}));
});
