import test from 'node:test';
import assert from 'node:assert/strict';
import {activeSteamJob, checkDue, managedSteamServer, memoryMiB, gameMemoryBudget, gameInitialNode, quickSettings, safeFolderLink, steamJobLabel, steamMemoryWarning, stoppedServer} from '../src/client/gameSetupModel.ts';

test('setup selects a viable node and caps memory to available capacity', () => {
  const nodes=[{id:1,name:'Missing ports',setup_available:false,available_memory:32768},{id:2,name:'Ready',setup_available:true,available_memory:8192}];
  assert.equal(gameInitialNode(nodes).id,2);
  assert.equal(gameInitialNode([{id:1,name:'No ports',free_allocations:0},{id:2,name:'Ready',free_allocations:1}]).id,2);
  assert.equal(gameMemoryBudget(131072,nodes[1]),8192);
  assert.equal(gameMemoryBudget(4096,nodes[1]),4096);
  assert.equal(gameMemoryBudget(4096,{id:1,name:'Overallocated',available_memory:-512}),0);
  assert.equal(gameMemoryBudget(4096),4096);
  assert.equal(gameInitialNode([]),undefined);
});

test('memory conversion rejects partial MiB and invalid budgets', () => {
  assert.equal(memoryMiB('16'), 16384);
  assert.equal(memoryMiB('0.5'), 512);
  for (const value of ['', ' ', 'no', 'Infinity', '-2', '0', '1.0001']) assert.equal(memoryMiB(value), null);
});
test('folder shortcuts preserve Files directory routing and reject unsafe paths', () => {
  assert.equal(safeFolderLink('abc', 'FactoryGame/Saved/SaveGames/server/My Session'), '/server/abc/files?directory=%2FFactoryGame%2FSaved%2FSaveGames%2Fserver%2FMy+Session');
  for (const path of ['', '/save/../secret', 'C:\\data', '/a\u0000b']) assert.equal(safeFolderLink('abc', path), null);
});
test('settings payload follows field allowlist, types and number/select bounds', () => {
  const fields = [{key:'ServerName',label:'Name',type:'text',value:'Old'}, {key:'ExpRate',label:'Experience rate',type:'number',value:1,min:0.1,max:20}, {key:'bIsUseBackupSaveData',label:'Backups',type:'boolean',value:false}, {key:'DeathPenalty',label:'Penalty',type:'select',value:'All',options:[{value:'All',label:'All'},{value:'None',label:'None'}]}];
  assert.deepEqual(quickSettings(fields, {ServerName:'New',ExpRate:'1.5',bIsUseBackupSaveData:true,DeathPenalty:'None',unexpected:'never sent'}), {ServerName:'New',ExpRate:1.5,bIsUseBackupSaveData:true,DeathPenalty:'None'});
  for (const value of ['', 'NaN', '0', '21']) assert.throws(() => quickSettings(fields, {ExpRate:value}), /Experience rate/);
  assert.throws(() => quickSettings(fields, {DeathPenalty:'invented'}), /Penalty/);
});
test('mutating controls require fresh confirmed stopped telemetry', () => {
  assert.equal(stoppedServer('offline', 1, '', null), true);
  assert.equal(stoppedServer('stopped', 1, '', null), true);
  for (const args of [['unknown',1,'',null],['running',1,'',null],['offline',0,'',null],['offline',1,'disconnected',null],['offline',1,'','installing']]) assert.equal(stoppedServer(...args), false);
});
test('partial settings preserve missing native game defaults', () => {
  const fields = [{key:'ServerName',label:'Name',type:'text',value:'Old'}, {key:'ExpRate',label:'Experience',type:'number',value:null}, {key:'bIsUseBackupSaveData',label:'Backups',type:'boolean',value:null}];
  assert.deepEqual(quickSettings(fields, {ServerName:'New',ExpRate:null,bIsUseBackupSaveData:null}), {ServerName:'New'});
  assert.deepEqual(quickSettings(fields, {ServerName:'Old',bIsUseBackupSaveData:false}), {bIsUseBackupSaveData:false});
});
test('start intent labels server preparation without claiming a game update', () => {
  assert.equal(steamJobLabel({operation:'start',stage:'checking'}), 'Preparing server');
  assert.equal(steamJobLabel({operation:'start',stage:'restarting'}), 'Preparing restart');
  assert.equal(steamJobLabel({operation:'install',stage:'waiting_bootstrap'}), 'Installing game');
});
test('active jobs block maintenance until terminal or completed', () => {
  assert.equal(activeSteamJob({status:'queued'}), true);
  assert.equal(activeSteamJob({status:'running'}), true);
  for (const status of ['succeeded','failed','cancelled','interrupted']) assert.equal(activeSteamJob({status}), false);
  assert.equal(activeSteamJob({status:'running',completed_at:'2026-10-22T06:00:00Z'}), false);
  assert.equal(activeSteamJob(null), false);
});
const steamStatus = {mode:'on_start',last_checked_at:'2026-10-22T06:00:00Z',last_attempt_at:'2026-10-22T06:00:00Z',last_failed_at:null,check_interval_seconds:3600,jobs:[]};
const localTime = value => new Date(value).toLocaleString();

test('Palworld warns for valid RAM below the API default without changing the minimum', () => {
  const options = {name:'Palworld',defaults:{memory:16384},minimum_memory:8192,maximum_memory:131072};
  assert.match(steamMemoryWarning(options, memoryMiB('8')), /Palworld defaults to 16 GiB.*risk of crashes/);
  assert.match(steamMemoryWarning(options, memoryMiB('15.5')), /16 GiB/);
  for (const value of ['16','32','7','bad','']) assert.equal(steamMemoryWarning(options, memoryMiB(value)), null);
  assert.match(steamMemoryWarning({...options,name:'Satisfactory',defaults:{memory:12288}},8192), /Satisfactory defaults to 12 GiB/);
});

test('attempts never imply failure, including a first check and an older API without failed-at', () => {
  assert.equal(checkDue({...steamStatus,last_attempt_at:'2026-10-22T06:10:00Z'}), `Next automatic check eligible ${localTime('2026-10-22T07:00:00Z')}.`);
  assert.equal(checkDue({...steamStatus,last_failed_at:undefined,last_checked_at:null,last_attempt_at:'2026-10-22T06:10:00Z'}), 'No successful check yet.');
});

test('active queued and running jobs suppress failure/cooldown claims, including history fallback', () => {
  const status = {...steamStatus,last_checked_at:null,last_attempt_at:'2026-10-22T06:00:00Z',last_failed_at:'2026-10-22T05:59:00Z'};
  for (const state of ['queued','running']) {
    const job = {status:state,operation:'check'};
    const expected = `Steam maintenance is ${state === 'queued' ? 'queued' : 'in progress'}. Automatic checks wait for the current job to finish.`;
    assert.equal(checkDue({...status,current_job:job}), expected);
    assert.equal(checkDue({...status,current_job:{status:'failed'},jobs:[job]}), expected);
  }
});

test('a slow failed check retries from failure completion, not attempt start', () => {
  const status = {...steamStatus,last_checked_at:null,last_attempt_at:'2026-10-22T06:00:00Z',last_failed_at:'2026-10-22T06:10:00Z',current_job:{status:'failed'}};
  assert.equal(checkDue(status), `Failed checks retry after ${localTime('2026-10-22T06:15:00Z')}.`);
});

test('failed manual checks preserve the longer successful-check cooldown', () => {
  assert.equal(checkDue({...steamStatus,last_attempt_at:'2026-10-22T06:01:00Z',last_failed_at:'2026-10-22T06:10:00Z'}), `Failed checks retry after ${localTime('2026-10-22T07:00:00Z')}.`);
  assert.equal(checkDue({...steamStatus,last_failed_at:'2026-10-22T06:59:00Z'}), `Failed checks retry after ${localTime('2026-10-22T07:04:00Z')}.`);
});

test('successful checks supersede failures and apply the backend interval fallback', () => {
  for (const failed of ['2026-10-22T05:59:00Z','2026-10-22T06:00:00Z',null,'invalid']) assert.equal(checkDue({...steamStatus,last_failed_at:failed}), `Next automatic check eligible ${localTime('2026-10-22T07:00:00Z')}.`);
  assert.equal(checkDue({...steamStatus,check_interval_seconds:7200}), `Next automatic check eligible ${localTime('2026-10-22T08:00:00Z')}.`);
  assert.equal(checkDue({...steamStatus,check_interval_seconds:0}), `Next automatic check eligible ${localTime('2026-10-22T07:00:00Z')}.`);
  assert.equal(checkDue({...steamStatus,mode:'off',last_failed_at:'2026-10-22T06:10:00Z'}), 'Automatic checks are off.');
});
test('managed Steam navigation follows backend capabilities without a second game registry', () => {
  assert.equal(managedSteamServer({game:'future-profile',steam_managed:true}),true);
  assert.equal(managedSteamServer({game:'7days',steam_managed:true}),true);
  assert.equal(managedSteamServer({game:'palworld',egg_features:['steam']}),true);
  assert.equal(managedSteamServer({game:'custom',egg_features:['steam'],steam_managed:false}),false);
  assert.equal(managedSteamServer({game:'minecraft'}),false);
  assert.equal(managedSteamServer({}),false);
});
