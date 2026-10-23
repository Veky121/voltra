import test from 'node:test';
import assert from 'node:assert/strict';
import {steamAdvancedEnvironment} from '../src/client/gameSetupModel.ts';

test('shared Steam form preserves opaque credentials and submits only declared controls', () => {
  const fields=[{key:'AUTO_UPDATE',label:'Updates',type:'boolean',default:'1'},{key:'PASSWORD',label:'Private console password',type:'text',default:'',secret:true},{key:'TELNET_PORT',label:'Console port',type:'integer',default:'8081',min:1024,max:65535}];
  const secret='  fixture "quote" \\ +quit λé  ';
  assert.deepEqual(steamAdvancedEnvironment(fields,{PASSWORD:secret,unexpected:'ignored'}),{AUTO_UPDATE:true,PASSWORD:secret,TELNET_PORT:'8081'});
  assert.equal(steamAdvancedEnvironment(fields,{AUTO_UPDATE:false}).AUTO_UPDATE,false);
  for(const TELNET_PORT of ['0','65536','1.5','NaN',''])assert.throws(()=>steamAdvancedEnvironment(fields,{TELNET_PORT}),/Console port/);
});

test('shared Steam secret validation matches the protocol UTF8 boundary', () => {
  const fields=[{key:'PASSWORD',label:'Credential',type:'text',default:'',secret:true}];
  for(const PASSWORD of ['x'.repeat(1024),'é'.repeat(512)])assert.equal(steamAdvancedEnvironment(fields,{PASSWORD}).PASSWORD,PASSWORD);
  for(const PASSWORD of ['x'.repeat(1025),'é'.repeat(512)+'x','line\nfeed'])assert.throws(()=>steamAdvancedEnvironment(fields,{PASSWORD}),/Credential/);
});
