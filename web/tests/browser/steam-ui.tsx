import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import Client from '../../src/Client';
import '../../src/styles.css';
import '../../src/theme.css';

// These fixtures exist only on the isolated :5189 Vite server.
const item = (object: string, attributes: any) => ({object, attributes});
const params = new URLSearchParams(location.search);
type Scenario = {admin?: boolean; game?: string; permissions?: string[]; state?: string; node?: boolean; folders?: boolean; failedSave?: boolean; installFail?: boolean; activeJob?: boolean; noNodes?: boolean; noInstall?: boolean; missing?: boolean; jobOperation?: string; lifecycle?: string; uninstalled?: boolean; nullFields?: boolean; jobLogs?: boolean; jobStatus?: 'queued' | 'running'; steamTimes?: {last_checked_at?: string | null; last_attempt_at?: string | null; last_failed_at?: string | null}};
let scenario: Scenario = {}, calls: {path: string; method: string; body: any}[] = [];
let revision = 'revision-1';
let fields = basicFields('palworld');
let mode = 'on_start', interval = 3600;
function basicFields(game: string) {
  return game === 'satisfactory' ? [] : game === 'minecraft' ? [{key:'motd',label:'Message of the day',type:'text',value:'Hello'},{key:'max-players',label:'Maximum players',type:'number',value:20,min:1,max:100},{key:'view-distance',label:'View distance',type:'number',value:8},{key:'server-port',label:'Game port',type:'number',value:25565,readonly:true}] : [{key:'ServerName',label:'Server name',type:'text',value:'Palworld server'},{key:'ServerPlayerMaxNum',label:'Maximum players',type:'number',value:32,min:1,max:32},{key:'ServerPassword',label:'Server password',type:'text',secret:true,value:''},{key:'ExpRate',label:'Experience rate',type:'number',value:1,min:0.1,max:20},{key:'DeathPenalty',label:'Death penalty',type:'select',value:'All',options:[{value:'All',label:'Drop everything'},{value:'None',label:'Keep everything'}]},{key:'bIsUseBackupSaveData',label:'Backup saves',type:'boolean',value:true}];
}
function quick() {return item('game_quick_setup', {game:scenario.game || 'palworld', file:'/server.properties', documents:[{path:'/server.properties',label:'server.properties'}], fields, folders:scenario.folders === false ? [] : [{label:'Saved games',path:'/Pal/Saved/SaveGames',description:'Upload an existing save here.'}], help:scenario.game === 'satisfactory' ? [{label:'Server Manager',text:'Use the built-in in-game Server Manager to claim the server and create a session.'}] : [], requires_stop:true,revision});}
const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = String(input), method = init?.method || 'GET';
  if (!path.startsWith('/api/')) throw new Error(`Unexpected fixture request ${path}`);
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({path, method, body});
  let status = 200, data: any;
  const game = path.includes('/satisfactory') ? 'satisfactory' : scenario.game || 'palworld';
  if (path === '/api/client/game-library/minecraft') data = item('minecraft_options',{latest:'1.21',versions:['1.21'],can_install:true,nodes:[{id:7,name:'Fixture host',automatic_ports:true}],loaders:[{id:'vanilla',name:'Vanilla'}],runtimes:[]});
  else if (path === '/api/client/game-library/templates/simple') data = item('template_options',{id:'simple',name:'Custom game',category:'other',available:true,source:'https://example.com',nodes:[{id:7,name:'Fixture host',automatic_ports:true}],images:[{label:'Default',value:'fixture:latest'}],defaults:{memory:1024,disk:10240},variables:[
    {env_variable:'CUSTOM_GAME_OPTION',name:'Gameplay option',description:'',default_value:'default',rules:'required|string',user_viewable:true},
    {env_variable:'MINECRAFT_VERSION',name:'Game version',description:'',default_value:'1.21',rules:'required|string',user_viewable:true},
    {env_variable:'REQUIRED_KEY',name:'Required installation key',description:'',default_value:'',rules:'required|string|min:4',user_viewable:true},
  ]});
  else if (path.match(/\/game-library\/steam\/[^/]+$/)) data = item('steam_game_options', {id:game,name:game === 'satisfactory' ? 'Satisfactory' : 'Palworld',can_install:!scenario.noInstall,nodes:scenario.noNodes ? [] : [{id:7,name:'Linux node'}],defaults:{memory:16384,max_players:game === 'satisfactory' ? 4 : 32},minimum_memory:8192,maximum_memory:65536,minimum_players:1,maximum_players:game === 'satisfactory' ? 4 : 32,presets:[{value:'default',label:'Standard'}],help:[]});
  else if (path.endsWith('/ports')) data = item('game_port_plan',{ip:'127.0.0.1',ports:[{role:'game',preferred_port:8211,port:8211}],detail:'Fixture available ports'});
  else if (path.endsWith('/install')) {if (scenario.installFail) {status = 503; data = {errors:[{detail:'Temporary install failure'}]};} else data = item('game_installation',{identifier:'fixture',name:body.name,status:'installing'});}
  else if (path === '/api/client/account') data = item('account',{root_admin:scenario.admin === true});
  else if (path.endsWith('/startup') && method === 'GET') data = {object:'list',data:[
    item('egg_variable',{env_variable:'MINECRAFT_VERSION',name:'Minecraft version',rules:'required|string',default_value:'1.21',server_value:'1.21',is_editable:true}),
    item('egg_variable',{env_variable:'CUSTOM_GAME_OPTION',name:'Custom game option',rules:'required|string',default_value:'default',server_value:'default',is_editable:true}),
  ],meta:{java_managed:true,raw_startup_command:'run {{CUSTOM_GAME_OPTION}}'}};
  else if (path.endsWith('/startup/variable')) data = item('egg_variable',{env_variable:body.key,name:body.key === 'CUSTOM_GAME_OPTION' ? 'Custom game option' : 'Minecraft version',rules:'required|string',default_value:'default',server_value:body.value,is_editable:true});
  else if (path.endsWith('/java')) data = item('java_settings',{config:{enabled:false},egg:{enabled:false},runtimes:[],effective:{},can_update:false});
  else if (path.startsWith('/api/application/servers/7?')) data = item('server',{id:7,identifier:'fixture',uuid:'fixture-uuid',name:'Isolated game fixture',egg:2,container:{installed:true,environment:{}}});
  else if (path.endsWith('/resources')) data = item('stats',{current_state:scenario.state || 'offline',resources:{}});
  else if (path.endsWith('/game-settings/folders')) data = item('game_settings_folders',{folders:quick().attributes.folders});
  else if (new URL(path,location.href).pathname.endsWith('/game-settings')) {
    if (scenario.missing) {status = 404; data = {errors:[{detail:'Game settings are not generated yet'}]};}
    else if (method === 'PUT' && scenario.failedSave) {status = 409; data = {errors:[{detail:'Configuration changed. Reload current settings before saving.'}]};}
    else {if (method === 'PUT') {fields = fields.map(field => ({...field,value:Object.hasOwn(body.settings,field.key) ? body.settings[field.key] : field.value})); revision = 'revision-2';} data = quick();}
  } else if (path.endsWith('/steam')) {
    if (method === 'PATCH') {mode = body.mode; interval = body.check_interval_seconds;}
    const logs = scenario.jobLogs ? [{stage:'downloading',detail:'Safe download progress',created_at:'2026-10-22T06:00:00Z'}] : undefined;
    data = item('steam_status',{supported:true,game,app_id:2394010,branch:'public',mode,check_interval_seconds:interval,last_checked_at:'2026-10-22T06:00:00Z',last_attempt_at:'2026-10-22T06:00:00Z',last_failed_at:null,...scenario.steamTimes,installed_build:scenario.uninstalled ? '' : '123',latest_build:'124',update_available:true,needs_repair:!!scenario.uninstalled,current_job:scenario.activeJob ? {id:'job-1',operation:scenario.jobOperation || 'update',status:scenario.jobStatus || 'running',stage:'downloading',detail:'Downloading game files',created_at:'2026-10-22T06:00:00Z',logs} : null,jobs:scenario.jobLogs ? [{id:'old-job',operation:'check',status:'succeeded',stage:'complete',detail:'Checked Steam',created_at:'2026-10-22T05:00:00Z',completed_at:'2026-10-22T05:00:10Z',logs}] : [],node_available:scenario.node !== false});
  } else if (path.endsWith('/steam/private')) data = item('private_steam_status',{supported:false,private_content:false});
  else if (/\/steam\/(check|update|verify)$/.test(path)) {status = 202; data = item('steam_job',{id:'job-2',operation:path.split('/').at(-1),status:'queued'});}
  else if (/\/servers\/[^/]+$/.test(path)) data = {...item('server',{internal_id:7,identifier:'fixture',uuid:'fixture-uuid',name:'Isolated game fixture',game:scenario.game || 'palworld',status:scenario.lifecycle || null,limits:{memory:16384},permissions:scenario.permissions || ['*']}),meta:{user_permissions:scenario.permissions || ['*']}};
  else if (path.includes('/files/list')) data = {object:'list',data:[]};
  else if (path === '/api/client') data = {object:'list',data:[]};
  else {status = 404; data = {errors:[{detail:`Unmocked endpoint ${method} ${path}`}]};}
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
};
window.fetch = fakeFetch;
const root = createRoot(document.getElementById('root')!);
let mount = 0;
async function show(path: string, next: Scenario = {}) {
  scenario = next; calls = []; revision = 'revision-1'; fields = basicFields(next.game || 'palworld'); mode = 'on_start'; interval = 3600;
  if (next.nullFields) fields = fields.map(field => field.key === 'ExpRate' || field.type === 'boolean' ? {...field,value:null} : field) as any;
  await act(async () => {root.render(<MemoryRouter key={++mount} initialEntries={[path]}><Client/></MemoryRouter>);});
  // Server lookup, telemetry and page data mount in separate effect turns.
  for (let turn = 0; turn < 4; turn++) await act(async () => {await new Promise(resolve => setTimeout(resolve, 90));});
}
const assert = (condition: unknown, message: string) => {if (!condition) throw new Error(message);};
const button = (label: string) => [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent === label) as HTMLButtonElement;
const input = (label: string) => {const node = (document.querySelector(`[aria-label=${JSON.stringify(label)}]`) || [...document.querySelectorAll('label')].find(node => node.querySelector('span')?.textContent === label)?.querySelector('input,select')) as HTMLElement; return (node?.matches('input,select') ? node : node?.querySelector('input,select')) as HTMLInputElement;};
async function change(label: string, value: string) {
  const element = input(label);
  assert(element, `Missing input ${label}`);
  await act(async () => {Object.getOwnPropertyDescriptor(element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true}));});
}
async function click(label: string) {assert(button(label), `Missing button ${label}`); await act(async () => {button(label).click();});}
async function narrowLayout() {
  // Measure the rendered DOM and actual styles at a 390px CSS viewport. This
  // avoids depending on host-preview resizing, which may report the old size.
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:390px;height:844px;position:fixed;left:-2000px;border:0';
  const ready = new Promise<void>(resolve => {frame.onload = () => resolve();});
  frame.srcdoc = `<!doctype html><html><head>${[...document.querySelectorAll('style')].map(style => style.outerHTML).join('')}</head><body><div id="root">${document.getElementById('root')!.innerHTML}</div></body></html>`;
  document.body.append(frame); await ready;
  const doc = frame.contentDocument!, viewport = frame.contentWindow!.innerWidth;
  const overflow = doc.documentElement.scrollWidth > viewport;
  const columns = [...doc.querySelectorAll('.steam-form-grid,.game-quick-layout,.steam-maintenance-layout')].map(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
  frame.remove();
  assert(viewport === 390 && !overflow && columns.every(count => count === 1), 'Narrow viewport overflow or layout columns');
}

async function suite() {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const results: {name: string; passed: boolean; error?: string}[] = [];
  async function test(name: string, fn: () => Promise<void>) {if (params.get('scope') === 'simplification' && !name.startsWith('Simplification:')) return; if (params.get('scope') === 'settings' && !/Quick setup|native|Revision|quick settings|file content|Folders link|Missing game files|Satisfactory directs|settings fill|switch/i.test(name)) return; try {await fn(); results.push({name,passed:true});} catch (error) {results.push({name,passed:false,error:String(error)});}}
  await test('Simplification: creation defers gameplay controls and preserves API defaults', async () => {
    await show('/game-library/palworld',{installFail:true});
    assert(!input('Maximum players') && !input('Server password') && !input('Preset'), 'Creation still asks for gameplay settings');
    await click('Create server');
    const request=calls.find(call=>call.path.endsWith('/install'))!;
    assert(request.body.max_players === 32 && request.body.preset === 'default' && !request.body.server_password, 'Creation defaults changed');
  });
  await test('Simplification: Minecraft creation defers gameplay but still requires EULA acceptance', async () => {
    await show('/game-library/minecraft',{installFail:true});
    assert(!input('Maximum players') && !input('Game mode') && !input('Difficulty'), 'Minecraft still asks for gameplay options');
    assert(button('Install Minecraft').disabled, 'EULA bypassed');
    await act(async()=>{(document.querySelector('.mc-eula [role=switch]') as HTMLButtonElement).click();});
    await click('Install Minecraft');
    const request=calls.find(call=>call.path.endsWith('/install'))!;
    assert(request.body.max_players===20 && request.body.game_mode==='survival' && request.body.difficulty==='normal' && request.body.accept_eula===true, 'Minecraft defaults or agreement changed');
  });
  await test('Simplification: templates defer valid game defaults and retain required installation inputs', async () => {
    await show('/game-library/template/simple',{installFail:true});
    assert(!input('Gameplay option') && input('Game version') && input('Required installation key'), 'Template fields not simplified');
    assert(button('Create server').disabled, 'Missing required key allowed');
    await change('Required installation key','valid-key');
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,350));});
    assert(input('Required installation key'), 'Corrected required field disappeared');
    await click('Create server');
    const request=calls.find(call=>call.path.endsWith('/install'))!;
    assert(request.body.environment.CUSTOM_GAME_OPTION==='default' && request.body.environment.REQUIRED_KEY==='valid-key', 'Deferred template defaults missing');
  });
  await test('Simplification: game options are outside admin tools for every game family', async () => {
    for (const game of ['minecraft','palworld','satisfactory','custom-template']) {
      await show('/server/fixture/settings',{game});
      assert(input('Custom game option'), 'Custom game option unavailable for '+game);
      assert(!input('Minecraft version'), 'Runtime option leaked into Game settings');
      assert(![...document.querySelectorAll('a')].some(a=>a.textContent === 'Admin tools'), 'Admin sidebar remains');
      const fields=calls.filter(call=>call.path.endsWith('/startup'));
      assert(fields.length===1, 'Multiple startup editors loaded');
    }
  });
  await test('Simplification: owner can edit custom game options using existing permissions', async () => {
    await show('/server/fixture/settings',{permissions:['startup.read','startup.update']});
    await change('Custom game option','changed');
    const control=input('Custom game option');
    await act(async()=>{control.closest('form')!.requestSubmit();});
    assert(calls.some(call=>call.method==='PUT' && call.body.key==='CUSTOM_GAME_OPTION' && call.body.value==='changed'), 'Custom game option did not save');
    assert(!calls.some(call=>call.path.startsWith('/api/application')), 'Owner accessed admin APIs');
  });
  await test('Simplification: runtime is available to members without administrator APIs', async () => {
    await show('/server/fixture/runtime',{permissions:['startup.read','startup.update']});
    assert(input('Minecraft version') && !input('Custom game option'), 'Runtime split is incorrect');
    assert(!calls.some(call=>call.path.startsWith('/api/application')), 'Member requested admin APIs');
    assert(![...document.querySelectorAll('button')].some(b=>b.textContent==='Resources'), 'Member exposed to resources');
  });
  await test('Simplification: administrator has the same runtime editor and advanced resource tabs', async () => {
    await show('/server/fixture/runtime',{admin:true});
    assert(input('Minecraft version') && !input('Custom game option'), 'Administrator runtime differs');
    for (const label of ['Runtime','Resources','Mounts','Advanced','Management']) assert(button(label), 'Missing tab '+label);
    assert(document.querySelectorAll('input[name="MINECRAFT_VERSION"]').length===1, 'Runtime editor duplicated');
  });
  await test('Simplification: old game, startup, and admin links reach canonical editors', async () => {
    for (const path of ['quick-setup','startup','settings/startup','admin-tools']) {
      await show('/server/fixture/'+path);
      assert(input(path==='quick-setup' ? 'Custom game option' : 'Minecraft version'), 'Legacy link failed '+path);
    }
  });
  await test('Simplification: read-only game access cannot save startup variables', async () => {
    await show('/server/fixture/settings',{permissions:['startup.read']});
    assert(input('Custom game option').disabled, 'Read-only variable writable');
    assert(!calls.some(call=>call.method!=='GET'), 'Read-only view mutated data');
  });
  await test('Palworld defaults and idempotent install retry', async () => {
    await show('/game-library/palworld',{installFail:true});
    assert(input('Memory (GiB)').value === '16', 'Memory default is not API driven');
    await click('Create server'); await click('Create server');
    const requests = calls.filter(call => call.path.endsWith('/install'));
    assert(requests.length === 2 && requests[0].body.request_id === requests[1].body.request_id, 'Retries changed request ID');
    assert(requests[0].body.memory === 16384 && requests[0].body.node_id === 7 && requests[0].body.preset === 'default', 'Install request shape mismatch');
  });
  await test('Changed install values receive new request ID', async () => {const previous = calls.find(call => call.path.endsWith('/install'))!.body.request_id; await change('Server name','New server'); await click('Create server'); assert(calls.filter(call => call.path.endsWith('/install')).at(-1)!.body.request_id !== previous, 'Changed install reused ID');});
  await test('Palworld warns below 16 GiB, permits 8 GiB and removes the warning at default or above', async () => {
    await show('/game-library/palworld',{installFail:true});
    assert(!document.getElementById('steam-memory-warning'), 'Warning shown at default RAM');
    await change('Memory (GiB)','8');
    const warning = document.getElementById('steam-memory-warning');
    assert(warning?.textContent?.includes('Palworld defaults to 16 GiB') && warning.textContent.includes('risk of crashes'), 'Missing below-default RAM warning');
    assert(input('Memory (GiB)').getAttribute('aria-describedby') === warning?.id, 'Warning not associated with RAM input');
    assert(!button('Create server').disabled, 'Warning blocks valid minimum RAM');
    await click('Create server');
    assert(calls.find(call => call.path.endsWith('/install'))?.body.memory === 8192, 'Minimum RAM selection changed in request');
    for (const memory of ['16','32']) {await change('Memory (GiB)',memory); assert(!document.getElementById('steam-memory-warning') && !input('Memory (GiB)').hasAttribute('aria-describedby'), 'RAM warning remained at default or above');}
  });
  await test('No capable node blocks provisioning', async () => {await show('/game-library/satisfactory',{noNodes:true}); assert(button('Create server').disabled, 'Install enabled without node'); assert(document.body.textContent?.includes('No connected compatible'), 'Missing node guidance');});
  await test('Create permission blocks provisioning', async () => {await show('/game-library/palworld',{noInstall:true}); assert(button('Create server').disabled, 'Install enabled without permission');});
  await test('Satisfactory directs players to built-in Server Manager', async () => {await show('/server/fixture/quick-setup',{game:'satisfactory',folders:false}); assert(document.body.textContent?.includes('No generated server configuration'), 'Missing configuration guidance'); assert(!button('Save settings'), 'Satisfactory invents setting controls'); assert(document.body.textContent?.includes('Folders appear after'), 'Missing folder empty state');});
  await test('Quick setup PUT sends official changed keys and optimistic revision', async () => {await show('/server/fixture/quick-setup'); await change('Server name','My pals'); await click('Save settings'); const request = calls.find(call => call.method === 'PUT')!; assert(request.body.revision === 'revision-1' && request.body.settings.ServerName === 'My pals' && !Object.hasOwn(request.body.settings,'ExpRate'), 'Quick settings shape mismatch'); assert(document.body.textContent?.includes('Saved. Applies'), 'Missing save success');});
  await test('Missing native settings keep game defaults when another field changes', async () => {await show('/server/fixture/quick-setup',{nullFields:true}); assert((document.getElementById('game-property-ExpRate') as HTMLInputElement).value === '', 'Null number displayed literally'); await change('Server name','Keep defaults'); await click('Save settings'); const request = calls.find(call => call.method === 'PUT')!; assert(Object.keys(request.body.settings).join() === 'ServerName', 'Missing defaults overwritten');});
  await test('Revision conflicts preserve draft and offer reload', async () => {await show('/server/fixture/quick-setup',{failedSave:true}); await change('Server name','Keep draft'); await click('Save settings'); assert(input('Server name').value === 'Keep draft', 'Conflict lost draft'); assert(button('Reload current settings'), 'Missing reload');});
  await test('Running game blocks quick settings saves', async () => {await show('/server/fixture/quick-setup',{state:'running'}); assert(input('Server name').matches(':disabled') && button('Save settings').disabled, 'Running settings writable');});
  await test('Read-only permission blocks quick settings saves', async () => {await show('/server/fixture/quick-setup',{permissions:['file.read-content','file.read']}); assert(button('Save settings').disabled, 'Read-only settings writable');});
  await test('No file content grant does not request game settings', async () => {await show('/server/fixture/quick-setup',{permissions:['file.read']}); assert(!calls.some(call => call.path.includes('/game-settings')), 'Unauthorized GET');});
  await test('Folders link to existing Files directory route', async () => {await show('/server/fixture/quick-setup'); const link = [...document.querySelectorAll('a')].find(node => node.textContent?.startsWith('Saved games'))!; assert(link.getAttribute('href') === '/server/fixture/files?directory=%2FPal%2FSaved%2FSaveGames', 'Folder route mismatch');});
  await test('Minecraft native properties use shared quick form', async () => {await show('/server/fixture/quick-setup',{game:'minecraft'}); await change('Server message','Welcome'); await click('Save settings'); assert(calls.find(call => call.method === 'PUT')!.body.settings.motd === 'Welcome', 'Minecraft native key mismatch');});
  await test('Missing game files render actionable state', async () => {await show('/server/fixture/quick-setup',{missing:true}); assert(document.body.textContent?.includes('Game settings are not generated yet'), 'Missing game-file guidance'); assert(!button('Save settings'), 'Missing files form remains writable');});
  await test('Running game can check but cannot update or repair', async () => {await show('/server/fixture/steam',{state:'running'}); assert(!button('Check now').disabled && button('Update').disabled && button('Verify and repair files').disabled, 'Running maintenance guards wrong'); await click('Check now'); assert(calls.some(call => call.path.endsWith('/steam/check') && call.method === 'POST'), 'Check API not called');});
  await test('Stopped game update and verify call real API paths', async () => {await show('/server/fixture/steam'); await click('Update'); await click('Verify and repair files'); assert(calls.some(call => call.path.endsWith('/steam/update')) && calls.some(call => call.path.endsWith('/steam/verify')), 'Maintenance API shape mismatch'); assert(!calls.some(call => call.path.endsWith('/power') && call.method === 'POST'), 'Maintenance stopped or started server');});
  await test('Active jobs show progress and block overlapping actions', async () => {await show('/server/fixture/steam',{activeJob:true}); assert(document.querySelector('progress') && document.body.textContent?.includes('Downloading game files'), 'Missing job stage'); assert(button('Check now').disabled && button('Update').disabled, 'Overlapping action allowed');});
  await test('First check and retry show current job instead of claiming a failure cooldown', async () => {
    for (const jobStatus of ['queued','running'] as const) {
      await show('/server/fixture/steam',{activeJob:true,jobOperation:'check',jobStatus,steamTimes:{last_checked_at:null,last_attempt_at:'2026-10-22T06:00:00Z',last_failed_at:jobStatus === 'queued' ? null : '2026-10-22T05:59:00Z'}});
      const cooldown = document.querySelector('.steam-cooldown')?.textContent;
      assert(cooldown?.includes(jobStatus === 'queued' ? 'queued' : 'in progress') && !cooldown.includes('Failed checks retry'), 'Active check described as failed');
    }
  });
  await test('Slow failure cooldown starts at failure and preserves the successful-check interval', async () => {
    await show('/server/fixture/steam',{steamTimes:{last_checked_at:null,last_attempt_at:'2026-10-22T06:00:00Z',last_failed_at:'2026-10-22T06:10:00Z'}});
    assert(document.querySelector('.steam-cooldown')?.textContent === `Failed checks retry after ${new Date('2026-10-22T06:15:00Z').toLocaleString()}.`, 'Retry uses attempt start instead of failure time');
    await show('/server/fixture/steam',{steamTimes:{last_attempt_at:'2026-10-22T06:01:00Z',last_failed_at:'2026-10-22T06:10:00Z'}});
    assert(document.querySelector('.steam-cooldown')?.textContent === `Failed checks retry after ${new Date('2026-10-22T07:00:00Z').toLocaleString()}.`, 'Failed manual check bypasses successful cooldown');
  });
  await test('Successful check supersedes a prior failure in cooldown text', async () => {
    await show('/server/fixture/steam',{steamTimes:{last_checked_at:'2026-10-22T06:20:00Z',last_attempt_at:'2026-10-22T06:15:00Z',last_failed_at:'2026-10-22T06:10:00Z'}});
    assert(document.querySelector('.steam-cooldown')?.textContent === `Next automatic check eligible ${new Date('2026-10-22T07:20:00Z').toLocaleString()}.`, 'Old failure hides successful check cooldown');
  });
  await test('Safe job logs exist for active and recent jobs and remain collapsed', async () => {await show('/server/fixture/steam',{activeJob:true,jobLogs:true}); const logs = [...document.querySelectorAll<HTMLDetailsElement>('.steam-job-log')]; assert(logs.length === 2 && logs.every(log => !log.open), 'Job logs missing or expanded automatically'); logs[0].open = true; assert(logs[0].textContent?.includes('Safe download progress'), 'Safe progress log missing');});
  await test('Start intents show preparing server', async () => {await show('/server/fixture/steam',{activeJob:true,jobOperation:'start'}); assert(document.body.textContent?.includes('Preparing server') && !document.body.textContent?.includes('Updating game'), 'Start intent mislabeled');});
  await test('Initial installation shows progress before Wings bootstrap completes', async () => {await show('/server/fixture/steam',{activeJob:true,jobOperation:'install',lifecycle:'installing',uninstalled:true}); assert(document.querySelector('progress') && document.body.textContent?.includes('Installing game'), 'Bootstrap progress hidden'); assert(document.body.textContent?.includes('initial installation is incomplete') && !document.body.textContent?.includes('interrupted'), 'Initial install described as interrupted update');});
  await test('Successful provisioning opens Steam installation progress', async () => {await show('/game-library/palworld'); await click('Create server'); for(let turn=0;turn<3;turn++) await act(async()=>{}); assert(document.body.textContent?.includes('Steam maintenance'), 'Install did not open progress page');});
  await test('Disconnected node disables maintenance', async () => {await show('/server/fixture/steam',{node:false}); assert(button('Check now').disabled, 'Disconnected check enabled');});
  await test('Steam read permission hides write actions', async () => {await show('/server/fixture/steam',{permissions:['startup.read']}); assert(!button('Check now') && button('Save automatic settings').disabled, 'Read-only Steam writable');});
  await test('Automatic mode and cooldown PATCH exact shape', async () => {await show('/server/fixture/steam'); await change('Automatic mode','scheduled'); await change('Check interval (minutes)','120'); await click('Save automatic settings'); const request = calls.find(call => call.method === 'PATCH')!; assert(request.body.mode === 'scheduled' && request.body.check_interval_seconds === 7200, 'Automatic settings shape mismatch');});
  await test('Quick settings sections retain every unsaved draft', async () => {await show('/server/fixture/quick-setup',{game:'minecraft'});await change('Server message','New message');await change('View distance','12');assert(input('Server message').value==='New message','Section edit lost draft');await click('Save settings');const settings=calls.find(call=>call.method==='PUT')!.body.settings;assert(settings.motd==='New message'&&settings['view-distance']==='12','Save lost a hidden category change');});
  await test('Game settings fill the width and folders follow below', async () => {await show('/server/fixture/quick-setup');const settings=document.querySelector('.game-settings-card')!.getBoundingClientRect(),layout=document.querySelector('.game-quick-layout')!.getBoundingClientRect(),folders=document.querySelector('.game-folders')!.getBoundingClientRect();assert(settings.width===layout.width,'Settings lost width to a sidebar');assert(folders.top>=settings.bottom,'Folders are beside settings');});
  await test('Boolean settings use an accessible switch and save a boolean', async () => {await show('/server/fixture/quick-setup');const control=document.querySelector('[role=switch][aria-label="Backup saves"]') as HTMLButtonElement;assert(control?.getAttribute('aria-checked')==='true','Missing enabled switch');await act(async()=>{control.click()});await click('Save settings');assert(calls.find(call=>call.method==='PUT')?.body.settings.bIsUseBackupSaveData===false,'Switch lost boolean encoding');});
  await test('Compact setup fits a 390px viewport', async () => {await show('/game-library/palworld'); await narrowLayout();});
  await test('Quick settings and folders stack at 390px', async () => {await show('/server/fixture/quick-setup'); await narrowLayout();});
  await test('Steam maintenance fits a 390px viewport', async () => {await show('/server/fixture/steam'); await narrowLayout();});
  await act(async () => {root.unmount();});
  (globalThis as any).__steamUIResults = results;
  document.body.style.cssText = 'overflow:auto;padding:24px;font-family:system-ui';
  document.body.innerHTML = `<h1>Steam UI tests: ${results.filter(result => result.passed).length}/${results.length} passed</h1><p>Isolated browser mocks. No real backend, authentication changes or game installs.</p><pre>${JSON.stringify(results,null,2)}</pre>`;
}
if (params.has('suite')) void suite();
else void show(params.get('path') || '/game-library/palworld', {game:params.get('game') || 'palworld',state:params.get('state') || 'offline',folders:!params.has('empty'),activeJob:params.has('job')});






