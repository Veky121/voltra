import {extension} from './platform.js';
import {notifications} from '../../web/src/notificationEvents.ts';
import {moduleFor} from './modules/index.js';
import {panelURL, panelPermission, transferProgress} from './config.js';

const $ = id => document.getElementById(id);
let id = new URL(location.href).searchParams.get('id');
let connected = false, busy = false, timer;
const explanations = {
  'storage-unavailable': 'Could not save extension settings. Check browser storage permissions and reopen Voltra Companion.',
  'queue-full': 'The queue holds 100 mods. Remove completed items before adding more.',
  'batch-running': 'Wait for the current queue submission to finish.',
  'side-panel-unavailable': 'Open Voltra Companion from the browser toolbar to view your saved queue.',
  'check-voltra-files': 'This transfer is still active or uncertain. Check Voltra Files first.',
  'invalid-panel': 'Enter an HTTPS panel origin. Localhost HTTP is allowed for development.',
  'invalid-key': 'Paste the API key from Voltra Account > API keys.',
  'api-401': 'The API key expired or was rejected. Check the key from Voltra Account > API keys.',
  'api-403': 'Access was denied. Check the key, account and server file permissions.',
  'api-404': 'The API route or server was not found. Check the panel address and refresh servers.',
  'api-409': 'The server is unavailable for file changes. Check installation, maintenance and transfer status in Voltra.',
  'api-400': 'The ZIP may already exist or the mod link is unsupported. Review the server Files page.',
  'api-429': 'Too many downloads. Wait a minute before trying again.',
  'connection-failed': 'Could not reach Voltra. Check the panel address, certificate and network, then reconnect.',
  'forbidden': 'This extension window was rejected. Reload the updated Voltra extension, close this window and reopen it.',
  'permission-required': 'Panel access was not granted. Click Connect again and allow access to the panel host.',
  'panel-login-redirect': 'Cloudflare Access or the panel redirected this API request to browser sign-in. The access gateway must allow API-key requests to reach Voltra.',
  'invalid-response': 'The panel did not return the expected API response. Check the panel address and access gateway.',
  'file-exists': 'This mod ZIP already exists. Review it in Voltra Files before replacing it.',
  'already-downloading': 'This ZIP is already downloading. Check its progress in Voltra Files.',
  'extension-unavailable': 'The extension background worker did not respond. Reload Voltra Companion in your browser extension settings and reopen this window.',
};
function failure(error, context = 'action') {
  notifications.publish({tone: 'error', title: context === 'connect' ? 'Could not connect to Voltra' : undefined,
    message: explanations[error.message] || (context === 'connect' ? 'The connection failed before it could be verified. Reload the extension, then check the panel address and API key. No mod download was submitted.' : 'The operation could not be confirmed. Check Voltra Files before submitting again.')});
}
// Use Voltra's shared event store. The standalone extension supplies one temporary host.
const island = $('notification-island');
let expiry;
notifications.subscribe(() => {
  clearTimeout(expiry);
  const snapshot = notifications.getSnapshot();
  const event = snapshot.events.find(e => e.id === snapshot.activeId);
  island.hidden = !event;
  if (!event) return;
  island.querySelector('strong').textContent = event.title;
  island.querySelector('p').textContent = event.message;
  island.querySelector('button').onclick = () => notifications.dismiss(event.id);
  expiry = setTimeout(() => notifications.dismiss(event.id), event.tone === 'error' ? 12000 : 6500);
});
async function send(type, extra = {}) {
  let reply;
  try { reply = await extension.runtime.sendMessage({type, id, ...extra}); }
  catch { throw new Error('extension-unavailable'); }
  if (!reply || typeof reply !== 'object') throw new Error('extension-unavailable');
  if (reply.error) throw new Error(reply.error);
  return reply.data;
}

let queue = [], available = [], lastServer, editing = false, hasSavedKey = false;
let activePanel = '', remoteBatch = false, refreshTimer, polling = false, initialized = false;
let viewRefresh = Promise.resolve(), draftSave = Promise.resolve();
const inFlight = item => item.job?.identifier && !['complete', 'failed', 'exists', 'unknown'].includes(item.job.state);
const readyItems = () => queue.filter(item => !item.job);

function renderAccount() {
  $('connection').hidden = connected && !editing;
  $('account').hidden = !connected;
  $('connected').textContent = `Connected to ${activePanel}`;
  $('cancel-edit').hidden = !connected;
  $('key').placeholder = hasSavedKey ? 'Saved key (leave blank to keep it)' : 'Paste your API key';
  $('key').required = !hasSavedKey;
  $('disconnect').hidden = !hasSavedKey && !connected;
  $('edit').disabled = busy || remoteBatch;
  $('destination').hidden = !queue.length || !connected;
}
function renderTargets() {
  const selected = $('servers').value || lastServer;
  const mods = readyItems().map(item => item.mod);
  const matches = available.filter(target => mods.every(mod => moduleFor(mod.module).matchTargets(mod, [target]).length));
  $('servers').replaceChildren();
  for (const target of matches) {
    const option = document.createElement('option');
    option.value = target.uuid;
    option.disabled = !target.can_install || target.unavailable;
    option.textContent = target.name + (option.disabled ? ' (unavailable)' : '');
    $('servers').append(option);
  }
  const enabled = [...$('servers').options].filter(option => !option.disabled);
  const chosen = enabled.find(option => option.value === selected) || enabled[0];
  if (chosen) $('servers').value = chosen.value;
  $('empty').hidden = !!chosen;
  $('servers').disabled = busy || remoteBatch;
  $('install').disabled = busy || remoteBatch || !chosen || !connected || !mods.length;
  $('install').textContent = busy || remoteBatch ? 'Submitting queue...' : `Add ${mods.length || 'all'} ${mods.length === 1 ? 'mod' : 'mods'} to server`;
}
function renderQueue() {
  $('queue').replaceChildren();
  $('count').textContent = queue.length;
  $('help').hidden = queue.length > 0;
  for (const item of queue) {
    const row = document.createElement('li'); row.className = 'queue-item';
    const title = document.createElement('strong'); title.textContent = item.mod.title;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${item.mod.title} from queue`);
    remove.disabled = busy || remoteBatch || !!item.job && !['complete','failed','exists','unknown'].includes(item.job.state);
    if (item.job?.state === 'unknown') remove.textContent = 'Dismiss record';
    remove.onclick = async () => { try { await send('remove-request', {id:item.id}); await refreshState(); } catch(error) { failure(error); } };
    const detail = document.createElement('p'); detail.textContent = `FS25 / ${item.mod.modVersion || 'Unknown version'} / ${item.mod.filename}`;
    const status = document.createElement('p');
    const states = {complete:'Downloaded', exists:'Already on server', failed:'Download failed. Check Voltra Files.', unknown:'Not confirmed. Check Voltra Files before adding again.', submitting:'Submitting. Reopen Voltra Files if this does not finish.'};
    status.textContent = item.job ? states[item.job.state] || `Download: ${item.job.state || 'queued'}` : item.error ? 'Not sent. Ready to retry.' : 'Ready';
    row.append(title, remove, detail, status);
    if (inFlight(item)) {
      const bar = document.createElement('progress'); bar.max = 100; bar.setAttribute('aria-label', `${item.mod.title} download progress`);
      const progress = transferProgress(item.job);
      if (progress !== null) bar.value = progress;
      row.append(bar);
    }
    $('queue').append(row);
  }
  renderAccount(); renderTargets();
}
async function refreshState() {
  const action = async () => {
    const result = await send('init', {id:null});
    id = result.id; queue = result.queue || []; connected = result.connected;
    activePanel = result.activePanel; hasSavedKey = result.hasSavedKey;
    lastServer = result.lastServer; remoteBatch = result.batchRunning;
    if (!initialized) {
      $('panel').value = result.panel;
      editing = result.hasDraft;
      $('saved').textContent = hasSavedKey ? 'API key remembered in this browser.' : '';
      initialized = true;
    }
    renderQueue();
    schedulePoll();
  };
  viewRefresh = viewRefresh.then(action, action);
  return viewRefresh;
}
async function targets() {
  if (!connected) return;
  const result = await send('targets');
  available = result.targets; renderTargets();
}
function rememberDraft() {
  const fields = {panel:$('panel').value, key:$('key').value};
  $('saved').textContent = 'Saving...';
  const action = async () => {
    const result = await send('save-draft', fields);
    hasSavedKey = result.hasSavedKey;
    $('saved').textContent = 'Settings saved in this browser.';
    $('key').required = !hasSavedKey;
  };
  draftSave = draftSave.then(action, action);
  draftSave.catch(error => { $('saved').textContent = ''; failure(error); });
  return draftSave;
}
$('panel').addEventListener('input', rememberDraft);
$('key').addEventListener('input', rememberDraft);
$('panel').addEventListener('blur', () => {
  if (!$('panel').value.trim()) return;
  try { $('panel').value = panelURL($('panel').value); void rememberDraft(); } catch { /* Connect validates incomplete addresses. */ }
});
$('connection').onsubmit = async event => {
  event.preventDefault();
  try {
    const panel = panelURL($('panel').value);
    $('panel').value = panel;
    // Request the host permission in the click gesture, before awaiting saved drafts.
    const permission = extension.permissions.request({origins:[panelPermission(panel)]});
    $('connection-fields').disabled = true;
    await rememberDraft();
    if (!await permission) throw new Error('permission-required');
    const result = await send('connect', {panel, key:$('key').value.trim()});
    $('key').value = ''; editing = false;
    $('panel').value = result.panel;
    await refreshState(); await targets();
    notifications.publish({tone:'success', message:'Connected. Your API address and key are remembered.'});
  } catch (error) { failure(error, 'connect'); }
  finally { $('connection-fields').disabled = false; }
};
$('edit').onclick = async () => {
  try {
    const result = await send('init');
    $('panel').value = result.panel; editing = true; renderAccount();
  } catch(error) { failure(error); }
};
$('cancel-edit').onclick = () => { editing = false; renderAccount(); };
$('disconnect').onclick = async () => {
  try {
    await draftSave;
    await send('disconnect'); clearTimeout(timer);
    $('key').value = ''; hasSavedKey = false; editing = true;
    $('saved').textContent = 'Key removed. Your API address and queue are kept.';
    await refreshState();
    notifications.publish({message:'Saved key removed from this browser. Your queue is kept.'});
  } catch(error) { failure(error); }
};
$('servers').onchange = () => send('remember-server', {server:$('servers').value}).catch(failure);
$('refresh').onclick = () => targets().catch(failure);
$('install').onclick = async () => {
  if (busy || remoteBatch || !connected || !$('servers').value) return;
  const ids = readyItems().map(item=>item.id), server = $('servers').value;
  if (!ids.length) return;
  busy = true; renderQueue();
  try {
    await send('remember-server', {server});
    const result = await send('install-all', {ids, server});
    const sent = result.results.filter(item=>item.job).length;
    const failed = result.results.find(item=>item.error);
    notifications.publish({tone:failed ? 'error' : 'success', message:failed
      ? `${sent} of ${ids.length} downloads submitted. ${explanations[failed.error] || 'Review the queue and Voltra Files before retrying.'}`
      : `${sent} ${sent === 1 ? 'download' : 'downloads'} submitted.`});
  } catch(error) { failure(error); }
  finally { busy = false; try { await refreshState(); await poll(); } catch(error) { failure(error); } }
};
function schedulePoll() {
  clearTimeout(timer);
  if (connected && (remoteBatch || queue.some(inFlight))) timer = setTimeout(poll, 4000);
}
async function poll() {
  if (polling || !connected) return;
  polling = true;
  try {
    const oldStates = new Map(queue.map(item=>[item.id,item.job?.state]));
    await send('queue-progress'); await refreshState();
    const completed = queue.filter(item=>item.job?.state === 'complete' && oldStates.get(item.id) !== 'complete').length;
    const failed = queue.some(item=>item.job?.state === 'failed' && oldStates.get(item.id) !== 'failed');
    if (completed) notifications.publish({tone:'success', message:`${completed} ${completed === 1 ? 'mod ZIP downloaded' : 'mod ZIPs downloaded'}. Activate in the game when ready.`});
    if (failed) notifications.publish({tone:'error', message:'A mod download failed. Check Voltra Files before retrying.'});
  } catch(error) { clearTimeout(timer); failure(error); }
  finally { polling = false; }
}
function queueChanged() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(()=>refreshState().catch(failure), 100);
}
extension.runtime.onMessage.addListener(message => {
  if (message?.type === 'queue-changed') queueChanged();
});
extension.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !Object.keys(changes).some(key=>key.startsWith('request:') || key === 'lastRequest')) return;
  queueChanged();
});
async function init() { await refreshState(); await targets(); await poll(); }
init().catch(failure);
