import {moduleFor, modules} from './modules/index.js';
import {panelURL, panelPermission} from './config.js';

// Content scripts cannot read credentials or pending account/server information.
const ready = Promise.all([
  chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}),
  chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}),
]);
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})
  .catch(() => console.error('Could not configure the Voltra side panel toolbar action.'));
// Extension windows are tabs too. Authenticate the extension document URL,
// rather than rejecting every sender with tab metadata.
const trusted = sender => {
  try {
    const actual = new URL(sender.url);
    const expected = new URL(chrome.runtime.getURL('app.html'));
    return actual.protocol === expected.protocol && actual.host === expected.host &&
      actual.pathname === expected.pathname && (sender.frameId === undefined || sender.frameId === 0);
  } catch { return false; }
};
const submitting = new Set();
let batchRunning = false, queueWrites = Promise.resolve();
let accountWrites = Promise.resolve();
const serializeAccount = action => {
  const result = accountWrites.then(action);
  accountWrites = result.catch(() => {});
  return result;
};
const serializeQueue = action => {
  const result = queueWrites.then(action);
  queueWrites = result.catch(() => {});
  return result;
};
const requestKey = id => `request:${id}`;
const queueItems = async () => Object.entries(await chrome.storage.local.get(null))
  .filter(([key, value]) => key.startsWith('request:') && value?.mod)
  .map(([key, value]) => ({...value, id: key.slice(8)})).sort((a, b) => a.created - b.created);
const readRequest = async id => (await chrome.storage.local.get(requestKey(id)))[requestKey(id)];
const writeRequest = (id, value) => chrome.storage.local.set({[requestKey(id)]: value});
// Preserve requests from the previous session-only build, as well as its unchanged connection key.
const migrated = ready.then(async () => {
  const local = await chrome.storage.local.get(null);
  if (local.queueMigrated) return;
  const session = await chrome.storage.session.get(null);
  const update = {queueMigrated: true};
  for (const [id, value] of Object.entries(session)) {
    if (!value?.mod || local[requestKey(id)]) continue;
    try {
      const mod = moduleFor(value.mod.module)?.validateMod(value.mod);
      if (mod) update[requestKey(id)] = {...value, mod, job: value.job && {...value.job, panel: local.connection?.panel}};
    } catch { /* Ignore invalid legacy requests, never discard saved credentials. */ }
  }
  if (!local.lastRequest && session.lastRequest) update.lastRequest = session.lastRequest;
  await chrome.storage.local.set(update);
});

function pageMod(message, sender) {
  if (!sender.tab || sender.frameId && sender.frameId !== 0 ||
      !sender.url?.startsWith('https://www.farming-simulator.com/mod.php?')) throw new Error('unsupported-page');
  const mod = moduleFor(message.mod?.module)?.validateMod(message.mod);
  if (!mod || new URL(mod.source).href !== new URL(sender.url).href) throw new Error('unsupported-page');
  return mod;
}

async function savedAccount() {
  const {connection, connectionDraft, lastServers = {}} = await chrome.storage.local.get(null);
  return {connection, draft: connectionDraft, lastServers};
}

async function saveDraft(message) {
  const {connection, draft} = await savedAccount();
  const next = {...(draft || connection || {})};
  if (typeof message.panel === 'string') next.panel = message.panel.slice(0, 2048);
  if (typeof message.key === 'string' && message.key.trim()) next.key = message.key.trim().slice(0, 512);
  await chrome.storage.local.set({connectionDraft: next});
  return {hasSavedKey: !!next.key};
}

async function api(path, body, connection) {
  connection ||= (await chrome.storage.local.get('connection')).connection;
  if (!connection) throw new Error('connect-first');
  const origin = panelURL(connection.panel);
  let response;
  try {
    response = await fetch(origin + path, {method: body ? 'POST' : 'GET', credentials: 'omit', redirect: 'manual',
      headers: {Authorization: `Bearer ${connection.key}`, 'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000)});
  } catch { throw new Error('connection-failed'); }
  if (response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) throw new Error('panel-login-redirect');
  // Do not forward raw provider responses, URLs or credentials into UI/history.
  if (!response.ok) throw new Error(`api-${response.status}`);
  let result;
  try { result = await response.json(); } catch { throw new Error('invalid-response'); }
  return result;
}

// Read the normal client API. Only the small picker model crosses into the UI.
async function targets(connection) {
  connection ||= (await savedAccount()).connection;
  const targets = [];
  for (let page = 1; ; page++) {
    const result = await api(`/api/client?per_page=100&page=${page}`, undefined, connection);
    if (!Array.isArray(result?.data)) throw new Error('invalid-response');
    for (const entry of result.data) {
      const server = entry.attributes;
      const module = modules.find(module => module.serverTarget?.(server));
      if (!module) continue;
      let detail;
      try { detail = await api(`/api/client/servers/${encodeURIComponent(server.uuid)}`, undefined, connection); }
      catch (error) { if (error.message === 'api-404') continue; throw error; }
      const target = module.serverTarget(detail.attributes, detail.meta?.user_permissions || []);
      if (target) targets.push(target);
    }
    const totalPages = result.meta?.pagination?.total_pages ?? 1;
    if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 1000) throw new Error('invalid-response');
    if (page >= totalPages) break;
  }
  return {targets};
}

async function install(id, server, connection) {
  const pending = await readRequest(id);
  if (!pending || pending.job || submitting.has(id)) throw new Error('open-mod-again');
  submitting.add(id);
  try {
    const module = moduleFor(pending.mod.module);
    const mod = module.validateMod(pending.mod);
    const available = await targets(connection);
    const target = module.matchTargets(mod, available.targets).find(t => t.uuid === server);
    if (!target || !target.can_install || target.unavailable) throw new Error('server-unavailable');
    const base = `/api/client/servers/${encodeURIComponent(target.uuid)}`;
    const files = await api(`${base}/files/list?directory=${encodeURIComponent(module.directory)}`, undefined, connection);
    if (!Array.isArray(files?.data)) throw new Error('invalid-response');
    if (files.data.some(file => file.attributes?.name?.toLowerCase() === mod.filename.toLowerCase())) throw new Error('file-exists');
    const active = await api(`${base}/files/pulls`, undefined, connection);
    if (!Array.isArray(active?.transfers)) throw new Error('invalid-response');
    if (active.transfers.some(t => t.directory === module.directory && t.name?.toLowerCase() === mod.filename.toLowerCase() && !['complete','failed'].includes(t.state))) throw new Error('already-downloading');
    // Persist before sending. Even a worker/browser restart cannot resubmit an uncertain POST.
    pending.error = null;
    pending.job = {server: target.uuid, panel: connection.panel, state: 'submitting'};
    await writeRequest(id, pending);
    const job = await api(`${base}/files/pull`, {url: mod.url, filename: mod.filename, directory: module.directory, tracked: true}, connection);
    if (!job.identifier) throw new Error('invalid-response');
    pending.job = {...pending.job, identifier: job.identifier, state: 'queued'};
    await writeRequest(id, pending);
    return pending.job;
  } catch (error) {
    pending.error = error.message;
    if (pending.job) pending.job.state = 'unknown';
    else if (error.message === 'file-exists') pending.job = {server, panel: connection.panel, state: 'exists'};
    await writeRequest(id, pending);
    throw error;
  } finally { submitting.delete(id); }
}

async function refreshProgress() {
  const {connection} = await savedAccount();
  if (!connection) throw new Error('connect-first');
  const responses = new Map();
  for (const item of await queueItems()) {
    const job = item.job;
    if (!job?.identifier || job.panel !== connection.panel || ['complete','failed','exists','unknown'].includes(job.state)) continue;
    if (!responses.has(job.server)) responses.set(job.server, await api(`/api/client/servers/${encodeURIComponent(job.server)}/files/pulls`, undefined, connection));
    const transfers = responses.get(job.server)?.transfers;
    if (!Array.isArray(transfers)) throw new Error('invalid-response');
    const transfer = transfers.find(t => t.identifier === job.identifier);
    // An expired transfer record is uncertain, not a reason to send the ZIP again.
    item.job = {...job, state: transfer?.state || 'unknown', received_bytes: transfer?.received_bytes,
      total_bytes: transfer?.total_bytes, size_known: transfer?.size_known};
    await writeRequest(item.id, item);
  }
  return {};
}

async function handle(message, sender) {
  await migrated;
  if (message.type === 'open') {
    const mod = pageMod(message, sender);
    return serializeQueue(async () => {
      const queue = await queueItems();
      const existing = queue.find(item => item.mod.url === mod.url);
      const id = existing?.id || crypto.randomUUID();
      if (!existing) {
        if (queue.length >= 100) throw new Error('queue-full');
        await writeRequest(id, {mod, created: Date.now()});
      }
      await chrome.storage.local.set({lastRequest: id});
      return {id};
    });
  }
  if (!trusted(sender)) throw new Error('forbidden');
  const id = message.id || (await chrome.storage.local.get('lastRequest')).lastRequest;
  const pending = id && await readRequest(id);
  if (message.type === 'init') {
    await accountWrites;
    const {connection, draft, lastServers} = await savedAccount();
    const queue = await queueItems();
    for (const item of queue) {
      if (item.job?.state === 'submitting' && !submitting.has(item.id)) {
        item.job.state = 'unknown';
        await writeRequest(item.id, item);
      }
    }
    return {id, panel: draft?.panel ?? connection?.panel ?? '', activePanel: connection?.panel || '',
      connected: !!connection, hasDraft: !!draft, hasSavedKey: !!(draft?.key || connection?.key),
      lastServer: lastServers[`${connection?.panel}|${pending?.mod?.module || 'fs25'}`], pending,
      queue, batchRunning};
  }
  if (message.type === 'save-draft') return serializeAccount(() => saveDraft(message));
  if (message.type === 'connect') {
    return serializeAccount(async () => {
      if (batchRunning || submitting.size) throw new Error('batch-running');
      await saveDraft(message);
      const {draft} = await savedAccount();
      const panel = panelURL(draft.panel);
      if (!/^[\x21-\x7e]{20,512}$/.test(draft.key || '')) throw new Error('invalid-key');
      if (!await chrome.permissions.contains({origins: [panelPermission(panel)]})) throw new Error('permission-required');
      const candidate = {panel, key: draft.key};
      // Test separately; failed edits must never replace the working connection.
      const result = await api('/api/client?per_page=1&page=1', undefined, candidate);
      if (!Array.isArray(result?.data)) throw new Error('invalid-response');
      await chrome.storage.local.set({connection: candidate});
      await chrome.storage.local.remove('connectionDraft');
      return {panel};
    });
  }
  if (message.type === 'disconnect') {
    return serializeAccount(async () => {
      if (batchRunning || submitting.size) throw new Error('batch-running');
      const {connection, draft} = await savedAccount();
      await chrome.storage.local.set({connectionDraft: {panel: draft?.panel ?? connection?.panel ?? ''}});
      await chrome.storage.local.remove('connection');
      return {};
    });
  }
  if (message.type === 'remember-server') {
    return serializeAccount(async () => {
      const {connection, lastServers} = await savedAccount();
      if (!connection || typeof message.server !== 'string' || message.server.length > 100) throw new Error('server-unavailable');
      lastServers[`${connection.panel}|${pending?.mod?.module || 'fs25'}`] = message.server;
      await chrome.storage.local.set({lastServers});
      return {};
    });
  }
  if (message.type === 'targets') return targets();
  if (message.type === 'remove-request') {
    if (batchRunning || submitting.has(id)) throw new Error('batch-running');
    if (pending?.job && !['complete','failed','exists','unknown'].includes(pending.job.state)) throw new Error('check-voltra-files');
    await chrome.storage.local.remove(requestKey(id));
    return {};
  }
  if (message.type === 'install-all') {
    if (batchRunning || submitting.size) throw new Error('batch-running');
    if (!Array.isArray(message.ids) || !message.ids.length || message.ids.length > 100) throw new Error('invalid-queue');
    batchRunning = true;
    try {
      await accountWrites;
      const {connection} = await savedAccount();
      if (!connection) throw new Error('connect-first');
      const results = [];
      // Snapshot exactly what the user submitted. New website clicks never join an active batch.
      for (const id of [...new Set(message.ids)]) {
        try { results.push({id, job: await install(id, message.server, connection)}); }
        catch (error) {
          results.push({id, error: error.message});
          if (['api-401','api-403','api-429','connection-failed','panel-login-redirect'].includes(error.message)) break;
        }
      }
      return {results};
    } finally { batchRunning = false; }
  }
  if (message.type === 'install') {
    if (batchRunning) throw new Error('batch-running');
    const {connection} = await savedAccount();
    if (!connection) throw new Error('connect-first');
    return install(id, message.server, connection);
  }
  if (message.type === 'queue-progress') return refreshProgress();
  if (message.type === 'progress') {
    if (!pending?.job?.identifier) throw new Error('check-voltra-files');
    const {transfers} = await api(`/api/client/servers/${encodeURIComponent(pending.job.server)}/files/pulls`);
    return {transfer: transfers?.find(t => t.identifier === pending.job.identifier)};
  }
  throw new Error('unsupported-action');
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  let opening = Promise.resolve();
  if (message.type === 'open') {
    try {
      pageMod(message, sender);
      // Preserve the content-script click gesture: open before any storage await.
      opening = chrome.sidePanel.open({windowId: sender.tab.windowId})
        .catch(() => { throw new Error('side-panel-unavailable'); });
    } catch (error) { reply({error: error.message}); return false; }
  }
  Promise.all([handle(message, sender), opening]).then(([data]) => reply({data}), error => reply({error: error.message}));
  return true;
});
