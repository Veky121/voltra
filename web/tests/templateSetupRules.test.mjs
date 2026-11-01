import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setupPublicIPv4,templateSetupRuleProblems} from '../src/client/templateSetupRules.ts';
const reference=JSON.parse(readFileSync(new URL('../../internal/panel/testdata/setup-public-ipv4-vectors.json',import.meta.url)));
const rule={environment:'PUBLIC_IP',type:'public_ipv4',required:true,message:'Enter a global unicast IPv4 address.'};
const variables=[{env_variable:'PUBLIC_IP'}];
test('Python reference corpus matches including address boundaries and all 192.0.0/24 exceptions',()=>{
  assert.ok(reference.vectors.length>=800);
  for(const row of reference.vectors)assert.equal(setupPublicIPv4(row.value),row.accept,JSON.stringify(row.value));
});
test('existing single field gets error without address discovery or input mutation',()=>{
  const input={PUBLIC_IP:'100.64.0.1',OTHER:'operator'};const before=structuredClone(input);
  assert.deepEqual(templateSetupRuleProblems([rule],variables,input),[{field:'game-template-PUBLIC_IP',message:rule.message}]);
  assert.deepEqual(input,before);
  assert.deepEqual(templateSetupRuleProblems([rule],variables,{PUBLIC_IP:'192.0.0.10'}),[]);
  assert.deepEqual(templateSetupRuleProblems([{...rule,required:false}],variables,{}),[]);
  assert.equal(templateSetupRuleProblems([rule],variables,{}).length,1);
  assert.deepEqual(templateSetupRuleProblems(undefined,variables,input),[]);
});
test('unsupported or ambiguous metadata fails closed',()=>{
  for(const rules of [[{...rule,type:'dns'}],[rule,rule],[{...rule,message:''}],[{...rule,environment:'1IP'}]])assert.ok(templateSetupRuleProblems(rules,variables,{PUBLIC_IP:'8.8.8.8'}).length);
  assert.ok(templateSetupRuleProblems([rule],[...variables,...variables],{PUBLIC_IP:'8.8.8.8'}).length);
});
