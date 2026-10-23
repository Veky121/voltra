import test from 'node:test';
import assert from 'node:assert/strict';
import {templateVariableControl, templateAdditionalPorts, templatePrimaryPort, templatePortsValid, templatePortRanges, templatePortEnvironment} from '../src/client/gameTemplateModel.ts';

const automaticRole = environment => ({environment, condition:'nonzero', allocated_value:true, auto_allocate:true, exclude_primary:true, minimum:1, maximum:65535, count:3});
const automaticAllocations = [28000,28001,28002,28003].map((port,index)=>({id:index+1,ip:'192.0.2.1',port}));

test('service-relative groups autofill companions and reject sparse, overlapping or unselected pairs', () => {
  const allocations=[28000,28001,28003,28004,28009,28010].map((port,index)=>({id:index+1,ip:'192.0.2.1',port}));
  const rules=[{minimum:1,maximum:65535,count:4,offsets:[1]},{...automaticRole('QUERY'),count:4,allocated_offsets:[1]}];
  const raw={QUERY:''},ranges=templatePortRanges(rules,raw),selected=templateAdditionalPorts(allocations,1,4,[],false,ranges);
  assert.deepEqual(new Set(selected),new Set([2,3,4]));assert.equal(templatePortsValid(allocations,1,selected,4,false,ranges),true);
  assert.deepEqual(templatePortEnvironment(rules,raw,allocations,1,[6,5,4,3,2]).environment,{QUERY:'28003'});assert.equal(raw.QUERY,'');
  for(const [env,ids] of [[{QUERY:''},[2,3,5]],[{QUERY:'28004'},[2,3,4]],[{QUERY:'28001'},[2,3,4]],[{QUERY:'28003'},[2,3,5]]]) {
    assert.equal(templatePortsValid(allocations,1,ids,4,false,templatePortRanges(rules,env)),false);
    assert.notEqual(templatePortEnvironment(rules,env,allocations,1,ids).error,'');
  }
  const later=[{...automaticRole('COMM'),count:5},...rules],env={COMM:'',QUERY:'28003'};
  const fill=templateAdditionalPorts(allocations,1,5,[],false,templatePortRanges(later,env));
  assert.deepEqual(templatePortEnvironment(later,env,allocations,1,fill).environment,{COMM:'28009',QUERY:'28003'});
  const foreign=allocations.map(item=>item.id===4?{...item,ip:'192.0.2.2'}:item);
  assert.notEqual(templatePortEnvironment(rules,raw,foreign,1,[2,3,4]).error,'');
  for(const allocated_offsets of [[0],[1,1],[65535]])assert.equal(templatePortsValid(allocations,1,[2,3,4],4,false,templatePortRanges([{...rules[1],allocated_offsets,when_environment:'ENABLED',when_value:'true'}],{ENABLED:'false',QUERY:''})),false);
  assert.equal(templatePortEnvironment(rules,{QUERY:'0'},allocations,1,[2]).environment.QUERY,'0');
});
test('automatic service roles select distinct ports and retain raw blank settings', () => {
  const rules=[automaticRole('COMM'),automaticRole('QUERY')],raw={COMM:'',QUERY:''},ranges=templatePortRanges(rules,raw);
  const selected=templateAdditionalPorts(automaticAllocations,1,3,[],false,ranges);
  assert.deepEqual(selected,[2,3]);assert.equal(templatePortsValid(automaticAllocations,1,selected,3,false,ranges),true);
  const result=templatePortEnvironment(rules,raw,automaticAllocations,1,[3,2]);assert.equal(result.error,'');assert.deepEqual(result.environment,{COMM:'28001',QUERY:'28002'});assert.deepEqual(raw,{COMM:'',QUERY:''});
  assert.deepEqual(templatePortEnvironment(rules,result.environment,automaticAllocations,1,selected).environment,result.environment);
});
test('later explicit service roles reserve their exact port before automatic roles', () => {
  const rules=[automaticRole('COMM'),automaticRole('QUERY')],raw={COMM:'',QUERY:'28001'},ranges=templatePortRanges(rules,raw);
  const selected=templateAdditionalPorts(automaticAllocations,1,3,[],false,ranges);
  assert.deepEqual(new Set(selected),new Set([2,3]));assert.equal(templatePortsValid(automaticAllocations,1,selected,3,false,ranges),true);
  assert.deepEqual(templatePortEnvironment(rules,raw,automaticAllocations,1,selected).environment,{COMM:'28002',QUERY:'28001'});
  for(const environment of [{COMM:'28001',QUERY:'28001'},{COMM:'28000',QUERY:''},{COMM:'28004',QUERY:''}]) {
    const ranges=templatePortRanges(rules,environment);assert.equal(templatePortsValid(automaticAllocations,1,[2,3],3,false,ranges),false);assert.notEqual(templatePortEnvironment(rules,environment,automaticAllocations,1,[2,3]).error,'');
  }
});
test('automatic RCON excludes game/query ports and disabled mode retains the original value', () => {
  const rules=[{minimum:1,maximum:65535,count:2,offsets:[-1]},{...automaticRole('RCON_PORT'),when_environment:'RCON',when_value:'true',exclude_offsets:[-1]}];
  const enabled={RCON:'true',RCON_PORT:''},ranges=templatePortRanges(rules,enabled);
  const primary=templatePrimaryPort(automaticAllocations,2,false,ranges);assert.equal(primary.id,2);
  const selected=templateAdditionalPorts(automaticAllocations,2,2,[],false,ranges);assert.deepEqual(new Set(selected),new Set([1,3]));
  assert.equal(templatePortsValid(automaticAllocations,2,selected,2,false,ranges),true);assert.deepEqual(templatePortEnvironment(rules,enabled,automaticAllocations,2,selected).environment,{RCON:'true',RCON_PORT:'28002'});
  const disabled={RCON:'false',RCON_PORT:'4253'},disabledRanges=templatePortRanges(rules,disabled);
  assert.equal(templatePortsValid(automaticAllocations,2,[1],2,false,disabledRanges),true);assert.deepEqual(templatePortEnvironment(rules,disabled,automaticAllocations,2,[1]).environment,disabled);
  assert.equal(templatePortsValid(automaticAllocations,2,[1,3],2,false,templatePortRanges(rules,{RCON:'true',RCON_PORT:'28000'})),false);
});
test('automatic roles reject insufficient or wrong-address selections without selecting unallocated ports', () => {
  const rules=[automaticRole('COMM'),automaticRole('QUERY')],raw={COMM:'',QUERY:''},ranges=templatePortRanges(rules,raw);
  assert.equal(templatePortsValid(automaticAllocations,1,[2],3,false,ranges),false);
  const wrong=automaticAllocations.map(item=>item.id===2?{...item,ip:'192.0.2.2'}:item);
  assert.equal(templatePortsValid(wrong,1,[2,3],3,false,ranges),false);assert.notEqual(templatePortEnvironment(rules,raw,wrong,1,[2,3]).error,'');
});
test('malformed automatic or gated metadata is rejected even when its gate is inactive', () => {
  const base={...automaticRole('PORT'),when_environment:'ENABLE',when_value:'true'};
  for(const patch of [{allocated_value:false},{condition:''},{when_environment:''},{when_value:''},{when_environment:'invalid key'},{minimum:0},{offsets:[0]},{exclude_offsets:[-1,-1]}]) {
    const ranges=templatePortRanges([{...base,...patch}],{ENABLE:'false',PORT:''});assert.equal(templatePortsValid(automaticAllocations,1,[2,3],3,false,ranges),false);
  }
  const duplicate=templatePortRanges([base,base],{ENABLE:'false',PORT:''});assert.equal(templatePortsValid(automaticAllocations,1,[2,3],3,false,duplicate),false);
});

test('shifted consecutive block reserves lower neighbor and separate administration port', () => {
  const ports=[4254,4255,4256,4257,4258,4259,4300].map((port,index)=>({id:index+1,ip:'192.0.2.1',port}));
  assert.equal(templatePrimaryPort(ports,7,true,[],6,1).id,2);
  const selected=templateAdditionalPorts(ports,2,7,[],true,[],6,1);
  assert.deepEqual(selected,[1,3,4,5,6,7]);
  assert.equal(templatePortsValid(ports,2,selected,7,true,[],6,1),true);
  assert.equal(templatePortsValid(ports,1,[2,3,4,5,6,7],7,true,[],6,1),false);
  assert.equal(templatePortsValid(ports,2,selected.slice(0,5),7,true,[],6,1),false);
  for (const [count,offset] of [[8,1],[6,-1],[6,6],[-1,0]]) assert.equal(templatePortsValid(ports,2,selected,7,true,[],count,offset),false);
  assert.equal(templatePortsValid(ports,2,selected,7,false,[],6,1),false);
});

test('mode-dependent port ranges select native LAN ports without limiting online mode', () => {
  const ports=[...Array.from({length:6},(_,index)=>({id:index+1,ip:'192.0.2.1',port:23560+index})),{id:7,ip:'192.0.2.1',port:10998},{id:8,ip:'192.0.2.1',port:10999},{id:9,ip:'192.0.2.2',port:11000}];
  const rules=[{environment:'ONLINE_MODE',value:'0',minimum:10998,maximum:11018,count:2}];
  const online=templatePortRanges(rules,{ONLINE_MODE:'1'}),offline=templatePortRanges(rules,{ONLINE_MODE:'0'});
  assert.equal(templatePrimaryPort(ports,6,false,online).id,1);
  assert.equal(templatePrimaryPort(ports,6,false,offline).id,7);
  const selected=templateAdditionalPorts(ports,7,6,[],false,offline);
  assert.ok(selected.includes(8));assert.ok(!selected.includes(9));assert.equal(selected.length,5);
  assert.equal(templatePortsValid(ports,7,selected,6,false,offline),true);
  assert.equal(templatePortsValid(ports,1,[2,3,4,5,6],6,false,offline),false);
  assert.equal(templatePortsValid(ports,1,[2,3,4,5,6],6,false,online),true);
  assert.equal(templatePortsValid(ports,7,[1,2,3,4,5],6,false,offline),false);
});

test('consecutive recipes choose a complete block and reject gaps or port overflow', () => {
  const ports=[{id:1,ip:'192.0.2.1',port:23560},{id:2,ip:'192.0.2.1',port:23570},{id:3,ip:'192.0.2.1',port:23571},{id:4,ip:'192.0.2.1',port:27015}];
  assert.equal(templatePrimaryPort(ports,2,true).id,2);
  assert.deepEqual(templateAdditionalPorts(ports,2,2,[],true),[3]);
  assert.deepEqual(templateAdditionalPorts(ports,2,2,[4],true),[4,3]);
  assert.equal(templatePortsValid(ports,2,[4],2,true),false);
  assert.equal(templatePortsValid(ports,2,[4,3],2,true),true);
  assert.equal(templatePortsValid(ports,2,[3,3],2,true),false);
  assert.equal(templatePortsValid([{id:1,ip:'a',port:65535},{id:2,ip:'a',port:1}],1,[2],2,true),false);
  assert.equal(templatePortsValid(ports,1,[2],2,false),true);
});

test('multi-port recipes select free ports on the primary address', () => {
  const ports=[{id:1,ip:'192.0.2.1',port:23560},{id:2,ip:'192.0.2.2',port:23561},{id:3,ip:'192.0.2.2',port:23562}];
  assert.equal(templatePrimaryPort(ports,2).id,2);
  assert.deepEqual(templateAdditionalPorts(ports,2,2),[3]);
  assert.deepEqual(templateAdditionalPorts(ports,1,2),[]);
  assert.deepEqual(templateAdditionalPorts(ports,3,2,[3,1]),[2]);
  assert.deepEqual(templateAdditionalPorts(ports,1,1,[2,3]),[2,3]);
  assert.deepEqual(templateAdditionalPorts([],0,2),[]);
});

const field = (env_variable, rules, default_value = '') => templateVariableControl({env_variable, rules, default_value});

test('Steam game server login tokens use secret inputs', () => {
  assert.equal(field('GSLT','nullable|string').secret,true);
  assert.equal(field('STEAM_GSLT','nullable|string').secret,true);
  assert.equal(field('GSLT_PORT','required|integer').secret,false);
});

test('licensed timed download URLs are secret while ordinary URLs remain visible', () => {
  assert.equal(field('TIMED_URL','required|url').secret,true);
  for (const key of ['DOWNLOAD_URL','SERVER_URL','AUTH_SERVER_URL']) assert.equal(field(key,'required|url').secret,false,key);
});

test('environment-dependent credentials become required only for the selected mode', () => {
  const variable = {env_variable:'SERVER_TOKEN',rules:'nullable|required_if:environment.PUBLIC_SERVER,1|string',default_value:''};
  assert.equal(templateVariableControl(variable,{PUBLIC_SERVER:'0'}).required,false);
  assert.equal(templateVariableControl(variable,{PUBLIC_SERVER:'1'}).required,true);
  assert.equal(templateVariableControl(variable,{PUBLIC_SERVER:'1'}).secret,true);
  assert.equal(templateVariableControl(variable).required,false);
  assert.equal(templateVariableControl({...variable,rules:'required_if:environment.MODE,public,listed'},{MODE:'listed'}).required,true);
  assert.equal(templateVariableControl({...variable,rules:'required_if:MODE,public'},{MODE:'public'}).required,false);
});
test('template controls preserve enum and boolean values accepted by eggs', () => {
  assert.deepEqual(field('MODE', 'required|in:easy,normal,hard').choices, ['easy', 'normal', 'hard']);
  assert.deepEqual(field('PUBLIC', 'boolean', 'false').choices, ['false', 'true']);
  assert.deepEqual(field('AUTO_UPDATE', 'required|boolean', '1').choices, ['0', '1']);
});
test('template credentials use password controls while port and ordinary fields stay visible', () => {
  for (const key of ['PASSWORD','STEAM_PASS','API_KEY','AUTHKEY','AUTH_KEY','SERVER_AUTHKEY','STEAM_AUTH','LICENSE_KEY','RCON_PASSWORD','SERVER_TOKEN','SRCDS_BETAPASS','ADMIN_PASSWD','CUBE_ADMINPASSWORD']) assert.equal(field(key,'string').secret,true,key);
  for (const key of ['AUTH_PORT','AUTHKEY_PORT','TOKEN_PORT','SERVER_NAME','BACKUP_COUNT','KEYBOARD_LAYOUT']) assert.equal(field(key,'string').secret,false,key);
});

test('relative offsets are chosen before generic extras, including conditional ASE', () => {
  const ports=[28000,28001,28002,28123,28010].map((port,index)=>({id:index+1,ip:'192.0.2.1',port}));
  const soldat=templatePortRanges([{minimum:1,maximum:65535,count:2,offsets:[10]}],{});
  assert.deepEqual(templateAdditionalPorts(ports,1,2,[],false,soldat),[5]);
  assert.equal(templatePortsValid(ports,1,[2],2,false,soldat),false);
  assert.equal(templatePortsValid(ports,1,[5],2,false,soldat),true);
  const rules=[{environment:'ASE',value:'1',minimum:1,maximum:65535,count:3,offsets:[123]}];
  const ase=templatePortRanges(rules,{ASE:'1'});
  assert.deepEqual(templateAdditionalPorts(ports,1,2,[],false,ase),[4,2]);
  assert.deepEqual(templateAdditionalPorts(ports,1,2,[2],false,ase),[2,4]);
  assert.equal(templatePortsValid(ports,1,[2,4],2,false,ase),true);
  assert.equal(templatePortsValid(ports,1,[4],2,false,ase),false);
  assert.equal(templatePortsValid(ports,1,[2],2,false,templatePortRanges(rules,{ASE:'0'})),true);
});

test('relative-port metadata, address, duplicates and overflow fail consistently', () => {
  const ports=[{id:1,ip:'a',port:28000},{id:2,ip:'a',port:28010},{id:3,ip:'b',port:28010},{id:4,ip:'a',port:28010}];
  const valid={minimum:1,maximum:65535,count:2,offsets:[10]};
  assert.equal(templatePortsValid(ports,1,[3],2,false,[valid]),false);
  assert.equal(templatePortsValid(ports,1,[2,4],2,false,[valid]),false);
  for(const bad of [{...valid,minimum:0},{...valid,offsets:[0]},{...valid,count:3,offsets:[10,10]},{...valid,offsets:[10,20]},{...valid,offsets:[.5]},{...valid,environment:'ASE'},{...valid,condition:'unknown'}]) {
    const ranges=templatePortRanges([bad],{ASE:'0'});
    assert.equal(templatePortsValid(ports,1,[2],2,false,ranges),false,JSON.stringify(bad));
  }
  for(const [primary,offset]of [[65535,10],[1,-10]])assert.equal(templatePortsValid([{id:1,ip:'a',port:primary},{id:2,ip:'a',port:28010}],1,[2],2,false,[{...valid,offsets:[offset]}]),false);
  assert.equal(templatePortsValid([{id:1,ip:'a',port:28000},{id:2,ip:'b',port:28000}],1,[2],1),true);
});

test('optional nonzero port roles choose exact allocated values and zero disables them', () => {
  const ports=[28000,28001,28010,28020].map((port,index)=>({id:index+1,ip:'192.0.2.1',port}));
  const rules=['WS','RCON'].map(environment=>({environment,condition:'nonzero',allocated_value:true,minimum:1,maximum:65535,count:2}));
  const none=templatePortRanges(rules,{WS:'0',RCON:'0'});assert.deepEqual(none,[]);assert.equal(templatePortsValid(ports,1,[],1,false,none),true);
  const one=templatePortRanges(rules,{WS:'28010',RCON:'0'});assert.deepEqual(templateAdditionalPorts(ports,1,1,[],false,one),[3]);
  const both=templatePortRanges(rules,{WS:'28010',RCON:'28020'});assert.deepEqual(templateAdditionalPorts(ports,1,1,[],false,both),[3,4]);assert.equal(templatePortsValid(ports,1,[3,4],1,false,both),true);assert.equal(templatePortsValid(ports,1,[3],1,false,both),false);
  for(const invalid of ['','-1','1.0','1e3','65536','NaN','00'])assert.equal(templatePortsValid(ports,1,[3],1,false,templatePortRanges(rules,{WS:invalid,RCON:'0'})),false,invalid);
  assert.equal(templatePortsValid([{id:1,ip:'a',port:28000},{id:2,ip:'b',port:28010}],1,[2],1,false,one),false);
  for(const bad of [{...rules[0],condition:'unknown'},{...rules[0],value:'1'},{...rules[0],environment:''},{...rules[0],count:1},{...rules[0],condition:''}])assert.equal(templatePortsValid(ports,1,[3],1,false,templatePortRanges([bad],{WS:'0'})),false,JSON.stringify(bad));
});
test('numeric bounds use values rather than text lengths and retain decimals', () => {
  const integer = field('QUERY_PORT','required|integer|min:1|max:65535');
  assert.equal(integer.required,true); assert.equal(integer.numeric,true); assert.equal(integer.minimum,1); assert.equal(integer.maximum,65535); assert.equal(integer.step,1);
  const decimal = field('MULTIPLIER','numeric|min:0.1|max:20');
  assert.equal(decimal.step,'any'); assert.equal(decimal.minimum,0.1);
  assert.equal(field('PASSWORD','required|string|min:5|max:20').numeric,false);
});

test('public authentication endpoints and modes stay visible while credentials remain masked', () => {
  assert.equal(field('AUTH_SERVER_URL','required|url').secret,false);
  assert.equal(field('AUTH_MODE','required|in:official,offline').secret,false);
  assert.equal(field('STEAM_AUTH','string').secret,true);
  assert.equal(field('AUTH_TOKEN_URL','required|url').secret,true);
});

test('between rules constrain numeric inputs and combine with narrower bounds', () => {
  const players = field('MAX_PLAYERS', 'required|integer|between:1,255');
  assert.equal(players.minimum, 1); assert.equal(players.maximum, 255); assert.equal(players.step, 1);
  const combined = field('MULTIPLIER', 'numeric|between:-0.5,10|min:0.25|max:4');
  assert.equal(combined.minimum, 0.25); assert.equal(combined.maximum, 4); assert.equal(combined.step, 'any');
  const ordinary = field('NAME', 'required|string');
  assert.equal(ordinary.minimum, undefined); assert.equal(ordinary.maximum, undefined);
});

test('allocated listener roles optionally exclude the primary without changing legacy rules', () => {
  const ports=[28000,28001,28002].map((port,index)=>({id:index+1,ip:'192.0.2.1',port}));
  const rule={environment:'HTTPS_PORT',condition:'nonzero',allocated_value:true,minimum:1,maximum:65535,count:2};
  const ranges=(port,extra={})=>templatePortRanges([{...rule,...extra}],{HTTPS_PORT:port});
  assert.equal(templatePortsValid(ports,1,[2],2,false,ranges('28000')),true);
  assert.equal(templatePortsValid(ports,1,[2],2,false,ranges('28000',{exclude_primary:false})),true);
  assert.equal(templatePortsValid(ports,1,[2],2,false,ranges('28000',{exclude_primary:true})),false);
  const separate=ranges('28002',{exclude_primary:true});
  assert.deepEqual(templateAdditionalPorts(ports,1,2,[],false,separate),[3]);
  assert.equal(templatePortsValid(ports,1,[3],2,false,separate),true);
  assert.equal(templatePortsValid(ports,1,[2],2,false,separate),false);
  assert.equal(templatePortsValid([{...ports[0]},{...ports[2],ip:'192.0.2.2'}],1,[3],2,false,separate),false);
  assert.equal(templatePrimaryPort(ports,2,false,ranges('28000',{exclude_primary:true})).id,2);
  assert.deepEqual(ranges('0',{exclude_primary:true}),[]);
  assert.equal(templatePortsValid(ports,1,[2],2,false,ranges('0',{exclude_primary:true,allocated_value:false})),false);
});

test('allocated roles cannot reuse explicitly reserved relative ports', () => {
  const ports=[28000,27999,28001].map((port,index)=>({id:index+1,ip:'192.0.2.1',port}));
  const rule={environment:'RCON_PORT',condition:'nonzero',allocated_value:true,exclude_primary:true,exclude_offsets:[-1],minimum:1,maximum:65535,count:3};
  const valid=(port,changes={})=>templatePortsValid(ports,1,[2,3],3,false,templatePortRanges([{...rule,...changes}],{RCON_PORT:port}));
  assert.equal(valid('27999'),false);
  assert.equal(valid('28000'),false);
  assert.equal(valid('28001'),true);
  assert.equal(valid('0'),true);
  assert.equal(valid('27999',{exclude_offsets:[]}),true);
  for(const excluded of [[0],[-1,-1],[65535],[-65535],[0.5],{}])assert.equal(valid('0',{exclude_offsets:excluded}),false);
  assert.equal(valid('0',{allocated_value:false,exclude_primary:false}),false);
});
