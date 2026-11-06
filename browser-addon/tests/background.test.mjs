import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const {build} = require('esbuild');
const bundle = await build({entryPoints: [fileURLToPath(new URL('../src/background.js', import.meta.url))], bundle: true, write: false, format: 'iife'});
const mod = {module: 'fs25', gameVersion: '25', source: 'https://www.farming-simulator.com/mod.php?mod_id=373433&title=fs2025', url: 'https://cdn26.giants-software.com/modHub/storage/00373433/FS25_test.zip', filename: 'FS25_test.zip'};
const ui = {url: 'chrome-extension://test/app.html'};
const page = {url: mod.source, tab: {id: 7, windowId: 3}, frameId: 0};
const secondMod = {...mod, source:mod.source.replace('373433','373434'), url:mod.url.replace('FS25_test','FS25_other'), filename:'FS25_other.zip'};
function fixture(responseOverride, scenario = {}) {
  let listener;
  const calls = [], levels = [], panels = [];
  const storage = (initial = {}) => {
    const data = structuredClone(initial);
    return {data, setAccessLevel: async value => levels.push(value.accessLevel),
      get: async key => structuredClone(key === null ? data : {[key]: data[key]}),
      set: async value => Object.assign(data, structuredClone(value)),
      remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }};
  };
  const local = storage(scenario.local), session = storage(scenario.session);
  const chrome = {storage: {local, session}, permissions: {contains: async () => scenario.hostPermission !== false},
    runtime: {getURL: path => 'chrome-extension://test/' + path, onMessage: {addListener: fn => { listener = fn; }}},
    sidePanel: {setPanelBehavior: async value => panels.push({behavior:value}), open: async value => panels.push({open:value})}};
  const fetch = async (url, options) => {
    calls.push({url, options});
    if (scenario.failPost && options.method === 'POST') throw new Error('network lost after acceptance');
    if (responseOverride) return typeof responseOverride === 'function' ? responseOverride(url, options) : responseOverride;
    const server = {uuid:'server-1',name:'Existing FS25',egg_features:['voltra_fs25'],status:null};
    const path = new URL(url).pathname;
    let data;
    if (options.method === 'POST') data = {identifier:'job-1'};
    else if (path === '/api/client') data = {data:scenario.secondPage && new URL(url).searchParams.get('page') === '1' ? [] : [{attributes:server}],meta:{pagination:{total_pages:scenario.secondPage ? 2 : 1}}};
    else if (path.endsWith('/files/list')) data = {data:scenario.existingFile ? [{attributes:{name:mod.filename}}] : []};
    else if (path.endsWith('/files/pulls')) data = {transfers:[{identifier:'job-1',state:'complete'}]};
    else data = {attributes:server,meta:{user_permissions:scenario.permissions || ['file.read','file.create']}};
    return {ok:true,json:async()=>data};
  };
  vm.runInNewContext(bundle.outputFiles[0].text, {chrome, fetch, URL, AbortSignal, crypto: webcrypto, console});
  return {calls, levels, local, session, panels, send: (message, sender = ui) => new Promise(resolve => listener(message, sender, resolve))};
}
test('content scripts cannot connect, enumerate servers, poll or install', async () => {
  const f = fixture();
  for (const type of ['connect', 'save-draft', 'remember-server', 'remove-request', 'install-all', 'queue-progress', 'targets', 'progress', 'install', 'init']) assert.equal((await f.send({type}, page)).error, 'forbidden');
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.levels, ['TRUSTED_CONTEXTS', 'TRUSTED_CONTEXTS']);
});

test('failed connection preserves working credentials and remembers new draft across restart', async () => {
  const connection = {panel:'https://old.test',key:'ptlc_original-account-secret'};
  const f = fixture({ok:false,status:401}, {local:{connection}});
  assert.equal((await f.send({type:'connect',panel:'new.test',key:'ptlc_new-account-secret'})).error,'api-401');
  assert.deepEqual(f.local.data.connection,connection);
  const restarted = fixture(undefined,{local:f.local.data});
  const init = (await restarted.send({type:'init'})).data;
  assert.equal(init.panel,'new.test');
  assert.equal(init.activePanel,'https://old.test');
  assert.equal(init.hasSavedKey,true);
  assert.equal(JSON.stringify(init).includes('ptlc_'),false);
  assert.equal((await restarted.send({type:'connect',panel:'new.test',key:''})).error,undefined);
  assert.equal(restarted.local.data.connection.key,'ptlc_new-account-secret');
});

test('queue opens the native side panel, deduplicates clicks and survives restart with selected server', async () => {
  const f = fixture();
  await f.send({type:'connect',panel:'panel.test',key:'ptlc_existing-client-api-key'});
  await Promise.all([f.send({type:'open',mod},page),f.send({type:'open',mod},page)]);
  await f.send({type:'remember-server',server:'server-1'});
  assert.ok(f.panels.some(value=>value.open?.windowId === 3));
  const restarted = fixture(undefined,{local:f.local.data});
  const result = (await restarted.send({type:'init'})).data;
  assert.equal(result.queue.length,1);
  assert.equal(result.lastServer,'server-1');
  assert.equal(result.connected,true);
  await restarted.send({type:'disconnect'});
  const forgotten = (await restarted.send({type:'init'})).data;
  assert.equal(forgotten.hasSavedKey,false);
  assert.equal(forgotten.panel,'https://panel.test');
  assert.equal(forgotten.queue.length,1);
});

test('legacy pending requests migrate without changing saved connection', async () => {
  const connection = {panel:'https://panel.test',key:'ptlc_existing-client-api-key'};
  const f = fixture(undefined,{local:{connection},session:{old:{mod,created:1,job:{identifier:'job-1',server:'server-1',state:'queued'}},lastRequest:'old'}});
  const init = (await f.send({type:'init'})).data;
  assert.equal(init.queue.length,1);
  assert.equal(init.queue[0].job.panel,connection.panel);
  assert.deepEqual(f.local.data.connection,connection);
});

test('batch submits every queued mod once and persists completion', async () => {
  const f = fixture();
  await f.send({type:'connect',panel:'panel.test',key:'ptlc_existing-client-api-key'});
  const first = (await f.send({type:'open',mod},page)).data.id;
  const second = (await f.send({type:'open',mod:secondMod},{...page,url:secondMod.source})).data.id;
  const result = await f.send({type:'install-all',ids:[first,second,first],server:'server-1'});
  assert.equal(result.data.results.length,2);
  assert.ok(result.data.results.every(item=>item.job?.identifier));
  assert.equal(f.calls.filter(call=>call.options.method === 'POST').length,2);
  await f.send({type:'queue-progress'});
  const restarted = fixture(undefined,{local:f.local.data});
  assert.ok((await restarted.send({type:'init'})).data.queue.every(item=>item.job.state === 'complete'));
  await restarted.send({type:'install-all',ids:[first,second],server:'server-1'});
  assert.equal(restarted.calls.length,0);
});

test('ambiguous POST stops a batch and cannot resubmit after restart', async () => {
  const f = fixture(undefined,{failPost:true});
  await f.send({type:'connect',panel:'panel.test',key:'ptlc_existing-client-api-key'});
  const first = (await f.send({type:'open',mod},page)).data.id;
  const second = (await f.send({type:'open',mod:secondMod},{...page,url:secondMod.source})).data.id;
  const result = await f.send({type:'install-all',ids:[first,second],server:'server-1'});
  assert.equal(result.data.results.length,1);
  assert.equal(f.local.data['request:'+first].job.state,'unknown');
  assert.equal(f.local.data['request:'+second].job,undefined);
  const restarted = fixture(undefined,{local:f.local.data});
  assert.equal((await restarted.send({type:'install',id:first,server:'server-1'})).error,'open-mod-again');
  assert.equal(restarted.calls.length,0);
});

test('interrupted submission is marked uncertain and never automatically resumed', async () => {
  const f = fixture(undefined,{local:{'request:interrupted':{mod,created:1,job:{state:'submitting',server:'server-1',panel:'https://panel.test'}}}});
  assert.equal((await f.send({type:'init'})).data.queue[0].job.state,'unknown');
  assert.equal(f.calls.length,0);
});
test('source spoofing cannot open a request', async () => {
  const f = fixture();
  assert.equal((await f.send({type: 'open', mod}, {...page, url: 'https://evil.test/mod.php?mod_id=373433'})).error, 'unsupported-page');
});
test('server discovery follows standard API pagination', async () => {
  const f = fixture(undefined,{secondPage:true});
  await f.send({type:'connect',panel:'panel.test',key:'ptlc_existing-client-api-key'});
  const result = await f.send({type:'targets'});
  assert.equal(result.data.targets.length,1);
  assert.equal(result.data.targets[0].uuid,'server-1');
  assert.ok(f.calls.some(call => new URL(call.url).searchParams.get('page') === '2'));
});
test('missing permissions and existing ZIPs prevent the remote download command', async () => {
  for (const [scenario,expected] of [[{permissions:['file.read']},'server-unavailable'],[{existingFile:true},'file-exists']]) {
    const f = fixture(undefined,scenario);
    await f.send({type:'connect',panel:'panel.test',key:'ptlc_existing-client-api-key'});
    await f.send({type:'open',mod},page);
    const result = await f.send({type:'install',id:f.local.data.lastRequest,server:'server-1'});
    assert.equal(result.error,expected);
    assert.equal(f.calls.filter(call => call.options.method === 'POST').length,0);
  }
});
test('existing API keys connect and saved credentials are retained without exposing them', async () => {
  const f = fixture();
  assert.equal((await f.send({type:'connect',panel:'panel.test',key:'ptlc_ordinary-account-secret'})).error,undefined);
  const result = await f.send({type:'init'});
  assert.equal(result.data.connected,true);
  assert.equal(result.data.panel,'https://panel.test');
  assert.equal(f.local.data.connection.key,'ptlc_ordinary-account-secret');
  assert.equal(JSON.stringify(result).includes('ptlc_'),false);
});
test('explicit UI submits a bounded install once, without cookies or redirects', async () => {
  const f = fixture();
  assert.equal((await f.send({type: 'open', mod}, page)).error, undefined);
  const id = f.local.data.lastRequest;
  await f.send({type: 'connect', panel: 'https://panel.test', key: 'ptlc_existing-client-api-key'});
  const init = await f.send({type: 'init', id});
  assert.equal(init.data.connected, true);
  assert.equal(JSON.stringify(init).includes('ptlc_existing-client-api-key'), false);
  const results = await Promise.all([f.send({type: 'install', id, server: 'server-1'}), f.send({type: 'install', id, server: 'server-1'})]);
  assert.equal(results.filter(r => r.data?.identifier === 'job-1').length, 1);
  const posts = f.calls.filter(c => c.options.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, 'https://panel.test/api/client/servers/server-1/files/pull');
  assert.equal(posts[0].options.credentials, 'omit');
  assert.equal(posts[0].options.redirect, 'manual');
  assert.deepEqual(JSON.parse(posts[0].options.body), {url:mod.url,filename:mod.filename,directory:'/data/mods',tracked:true});
  assert.equal((await f.send({type: 'progress', id})).data.transfer.state, 'complete');
  assert.ok(f.calls.every(call => new URL(call.url).pathname.startsWith('/api/client')));
  assert.ok(f.calls.every(call => !call.url.includes('/addon/')));
  assert.equal((await f.send({type: 'install', id, server: 'server-1'})).error, 'open-mod-again');
  await f.send({type: 'disconnect'});
  assert.equal(f.local.data.connection, undefined);
});
test('own extension window with tab metadata can connect using a bare hostname', async () => {
  const f = fixture();
  const sender = {...ui, url: ui.url + '?id=example', tab: {id: 9}, frameId: 0};
  assert.equal((await f.send({type: 'init'}, sender)).error, undefined);
  assert.equal((await f.send({type: 'connect', panel: 'panel.test', key: 'ptlc_existing-client-api-key'}, sender)).error, undefined);
  assert.equal(f.local.data.connection.panel, 'https://panel.test');
  for (const url of ['chrome-extension://other/app.html', ui.url + '.spoof', mod.source]) {
    assert.equal((await f.send({type: 'init'}, {...sender, url})).error, 'forbidden');
  }
  assert.equal((await f.send({type: 'init'}, {...sender, frameId: 2})).error, 'forbidden');
});
test('login redirects, old backend responses and rejected keys produce bounded error codes', async () => {
  for (const [response, expected] of [
    [{type: 'opaqueredirect', status: 0}, 'panel-login-redirect'],
    [{status: 302}, 'panel-login-redirect'],
    [{ok: false, status: 401}, 'api-401'],
    [{ok: false, status: 404}, 'api-404'],
    [{ok: true, json: async () => ({unexpected: []})}, 'invalid-response'],
    [{ok: true, json: async () => { throw new Error('private provider response'); }}, 'invalid-response'],
  ]) {
    const f = fixture(response);
    const reply = await f.send({type: 'connect', panel: 'panel.test', key: 'ptlc_existing-client-api-key'});
    assert.equal(reply.error, expected);
    assert.equal(f.local.data.connection, undefined);
  }
});
