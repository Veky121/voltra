// Run from ptero-go. Creates only the dedicated file-manager acceptance node,
// Wings container and server. It never restarts an existing unrelated service.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const base = process.env.FILE_MANAGER_BASE || 'http://127.0.0.1:8098';
const directory = '.local/file-manager';
const reportPath = 'artifacts/file-manager-acceptance.json';
const container = 'pteroclone-file-manager-wings';
const rootDirectory = '/var/lib/voltra-file-manager';
const report = { started_at: new Date().toISOString(), base, checks: [], observations: [
  'Uses a dedicated local test node and Wings container. Existing Wings, game servers and remote homelab services are untouched.',
  'Uploads stage on panel disk, then stream to Wings. Pause/resume applies to browser-to-panel chunks; final forwarding can be retried.',
  'Stock Wings does not support byte Range; the panel emulates single ranges by streaming/discarding the prefix.',
] };
const attrs = value => value?.attributes ?? value;
const rows = value => value.data.map(attrs);
const assert = (value, message) => { if (!value) throw Error(message); };
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function save() { await mkdir('artifacts', { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2)); }
async function api(method, route, body) {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw Error(`${method} ${route}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}
async function check(name, action) {
  const start = Date.now();
  try { const result = await action(); report.checks.push({ name, passed: true, duration_ms: Date.now() - start, ...result }); console.log(`${name}: passed`); await save(); return result; }
  catch (error) { report.checks.push({ name, passed: false, duration_ms: Date.now() - start, error: error.message }); await save(); throw error; }
}
async function until(action, name, timeout = 90000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { try { const value = await action(); if (value) return value; } catch (error) { last = error; } await delay(500); }
  throw Error(`Timed out waiting for ${name}${last ? ': ' + last.message : ''}`);
}
await mkdir(directory, { recursive: true });
let server;
const route = suffix => `/api/client/servers/${server.uuid}${suffix}`;
const block = Buffer.alloc(8 << 20);
for (let index = 0; index < block.length; index++) block[index] = (index * 31 + 17) % 251;
function bytesAt(offset, length) {
  if (offset % block.length === 0 && length === block.length) return block;
  const result = Buffer.allocUnsafe(length);
  for (let copied = 0; copied < length;) { const position = (offset + copied) % block.length; const n = Math.min(length - copied, block.length - position); block.copy(result, copied, position, position + n); copied += n; }
  return result;
}
async function createUpload(name, size, target = '/') {
  const metadata = Object.entries({ filename: name, directory: target }).map(([key, value]) => `${key} ${Buffer.from(value).toString('base64')}`).join(',');
  const response = await fetch(base + route('/files/transfers'), { method: 'POST', headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': String(size), 'Upload-Metadata': metadata } });
  assert(response.status === 201, `tus create ${response.status}: ${await response.text()}`);
  const location = new URL(response.headers.get('Location'), base); assert(location.origin === new URL(base).origin, 'Unexpected upload origin'); return location.href;
}
async function headUpload(location) {
  const response = await fetch(location, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } });
  assert(response.status === 200, `tus HEAD ${response.status}`); return Number(response.headers.get('Upload-Offset'));
}
async function patchUpload(location, offset, body) {
  const response = await fetch(location, { method: 'PATCH', headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' }, body });
  assert(response.status === 204, `tus PATCH at ${offset}: ${response.status} ${await response.text()}`); return Number(response.headers.get('Upload-Offset'));
}
async function completeUpload(location) {
  const response = await fetch(location + '/complete', { method: 'POST' });
  if (response.status !== 200) throw Error(`complete ${response.status}: ${await response.text()}`);
  return attrs(await response.json());
}
async function uploadBuffer(name, content, target = '/') {
  const location = await createUpload(name, content.length, target);
  for (let offset = 0; offset < content.length; offset += block.length) await patchUpload(location, offset, content.subarray(offset, offset + block.length));
  return { location, completed: await completeUpload(location) };
}
function interruptPatch(location) {
  return new Promise(resolve => {
    const request = http.request(location, { method: 'PATCH', headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream', 'Content-Length': String(block.length) } });
    let sent = 0; const timer = setInterval(() => { if (sent >= (1 << 20)) { clearInterval(timer); request.destroy(); resolve(sent); return; } request.write(block.subarray(sent, sent + (64 << 10))); sent += 64 << 10; }, 10);
    request.on('error', () => { clearInterval(timer); resolve(sent); });
    request.on('response', response => { response.resume(); response.on('end', () => { clearInterval(timer); resolve(sent); }); });
  });
}
function tarOfDirectory(count) {
  const parts = [];
  const string = (buffer, offset, length, value) => buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8');
  for (let index = 0; index < count; index++) {
    const name = `many/file-${String(index).padStart(4, '0')}.txt`, content = Buffer.from(`entry ${index}\n`), header = Buffer.alloc(512);
    string(header, 0, 100, name); string(header, 100, 8, '0000644\0'); string(header, 108, 8, '0000000\0'); string(header, 116, 8, '0000000\0');
    string(header, 124, 12, content.length.toString(8).padStart(11, '0') + '\0'); string(header, 136, 12, '00000000000\0'); header.fill(32, 148, 156); header[156] = 48;
    string(header, 257, 6, 'ustar\0'); string(header, 263, 2, '00'); const checksum = header.reduce((sum, value) => sum + value, 0); string(header, 148, 8, checksum.toString(8).padStart(6, '0') + '\0 ');
    parts.push(header, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  parts.push(Buffer.alloc(1024)); return Buffer.concat(parts);
}

try {
  await check('dedicated_runtime_setup', async () => {
    const account = attrs(await api('GET', '/api/client/account'));
    let location = rows(await api('GET', '/api/application/locations')).find(value => value.short === 'FILE-MANAGER');
    if (!location) location = attrs(await api('POST', '/api/application/locations', { short: 'FILE-MANAGER', long: 'Isolated file manager acceptance fixtures' }));
    let node = rows(await api('GET', '/api/application/nodes')).find(value => value.name === 'File manager acceptance Wings');
    if (!node) node = attrs(await api('POST', '/api/application/nodes', { name: 'File manager acceptance Wings', description: 'Owned exclusively by tools/runtime/file-manager-acceptance.mjs', location_id: location.id, fqdn: '127.0.0.1', scheme: 'http', memory: 2048, memory_overallocate: 0, disk: 20480, disk_overallocate: 0, upload_size: 2048, daemon_listen: 18087, daemon_sftp: 12027, daemon_base: rootDirectory + '/volumes', allowed_origins: [base] }));
    const configuration = attrs(await api('GET', `/api/application/nodes/${node.id}/configuration`));
    configuration.remote = `http://host.docker.internal:${new URL(base).port || 80}`; configuration.allowed_origins = [base]; configuration.api = { ...configuration.api, host: '0.0.0.0', port: 18087, upload_limit: 2048 };
    configuration.system = { ...configuration.system, root_directory: rootDirectory, data: rootDirectory + '/volumes', log_directory: rootDirectory + '/logs', backup_directory: rootDirectory + '/backups', archive_directory: rootDirectory + '/archives', tmp_directory: rootDirectory + '/tmp' };
    configuration.docker = { ...configuration.docker, network: { name: 'pteroclone_go', network_mode: 'pteroclone_go', interface: '172.30.84.1', interfaces: { v4: { subnet: '172.30.84.0/24', gateway: '172.30.84.1' }, v6: { subnet: 'fdba:17c8:6c96::/64', gateway: 'fdba:17c8:6c96::1' } } } };
    const existingContainer = docker(['ps', '-a', '--filter', `name=^${container}$`, '--format', '{{.Names}}']);
    if (!existingContainer) {
      await writeFile(directory + '/wings.json', JSON.stringify(configuration, null, 2), { mode: 0o600 });
      docker(['run', '-d', '--name', container, '-p', '127.0.0.1:18087:18087', '-p', '127.0.0.1:12027:12027', '-v', `${resolve(directory + '/wings.json')}:/etc/pterodactyl/config.yml`, '-v', '/var/run/docker.sock:/var/run/docker.sock', '-v', '/run/wings:/run/wings', '-v', `${rootDirectory}:${rootDirectory}`, 'pteroclone-wings:local', '--config', '/etc/pterodactyl/config.yml']);
    } else if (docker(['inspect', '--format', '{{.State.Running}}', container]) !== 'true') docker(['start', container]);
    await until(() => api('GET', `/api/admin/nodes/${node.id}/system-information`), 'dedicated Wings readiness');
    let allocations = rows(await api('GET', `/api/application/nodes/${node.id}/allocations?per_page=100`));
    if (!allocations.some(value => value.port === 25596)) { await api('POST', `/api/application/nodes/${node.id}/allocations`, { ip: '0.0.0.0', ports: ['25596'] }); allocations = rows(await api('GET', `/api/application/nodes/${node.id}/allocations?per_page=100`)); }
    server = rows(await api('GET', '/api/application/servers?per_page=100')).find(value => value.name === 'File manager acceptance' && value.node === node.id);
    if (!server) server = attrs(await api('POST', '/api/application/servers', { name: 'File manager acceptance', user: account.id, egg: 325, docker_image: 'pteroclone-smoke:local', startup: 'echo VOLTRA_READY; sleep infinity', environment: {}, skip_scripts: true, start_on_completion: false, limits: { memory: 256, swap: 0, disk: 10240, io: 500, cpu: 100 }, feature_limits: { databases: 0, allocations: 0, backups: 0 }, allocation: { default: allocations.find(value => value.port === 25596).id } }));
    await until(async () => { server = attrs(await api('GET', `/api/application/servers/${server.id}`)); return server.status === null; }, 'dedicated server installed');
    report.resources = { location_id: location.id, node_id: node.id, server_id: server.id, server_uuid: server.uuid, daemon: container, daemon_port: 18087, sftp_port: 12027 };
    await writeFile(directory + '/fixtures.json', JSON.stringify(report.resources, null, 2));
    const capabilities = attrs(await api('GET', route('/files/transfers'))); assert(capabilities.max_file_size >= (1 << 30), 'Node upload limit is below 1 GiB');
    return { ...report.resources, upload_limit_bytes: capabilities.max_file_size };
  });
  const largeName = 'acceptance-1GiB.bin'; const total = 1024 ** 3;
  let largeLocation, largeDigest;
  await check('real_1GiB_interrupted_resume_and_finalize', async () => {
    largeLocation = await createUpload(largeName, total);
    const attempted = await interruptPatch(largeLocation);
    await delay(300); let offset = await headUpload(largeLocation);
    assert(offset > 0 && offset < block.length, `Interruption did not preserve a partial chunk: ${offset}, attempted ${attempted}`);
    const resumedOffset = offset;
    const stale = await fetch(largeLocation, { method: 'PATCH', headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' }, body: Buffer.from('bad') }); assert(stale.status === 409, 'Stale offset was accepted'); await stale.text();
    const expected = createHash('sha256'); for (let position = 0; position < total; position += block.length) expected.update(block); largeDigest = expected.digest('hex');
    while (offset < total) { const length = Math.min(block.length, total - offset); const next = await patchUpload(largeLocation, offset, bytesAt(offset, length)); assert(next === offset + length, 'Wrong acknowledged offset'); offset = next; if (offset % (128 << 20) < block.length) console.log(`uploaded ${Math.round(offset / (1 << 20))} MiB`); }
    assert(await headUpload(largeLocation) === total, 'Final offset mismatch');
    const completed = await completeUpload(largeLocation); assert(completed.size === total && completed.status === 'completed', 'Completion receipt mismatch');
    const repeated = await completeUpload(largeLocation); assert(repeated.id === completed.id, 'Completion retry changed transfer ID');
    return { bytes: total, interrupted_offset: resumedOffset, expected_sha256: largeDigest, complete_retry_idempotent: true };
  });
  await check('real_1GiB_streamed_download_sha256', async () => {
    const response = await fetch(base + route('/files/download-stream?file=' + encodeURIComponent('/' + largeName))); assert(response.ok, `Download ${response.status}`);
    assert(Number(response.headers.get('Content-Length')) === total, 'Download length header mismatch'); assert(response.headers.get('Content-Disposition')?.startsWith('attachment;'), 'Missing native download disposition');
    const hash = createHash('sha256'); let received = 0; for await (const chunk of response.body) { hash.update(chunk); received += chunk.length; }
    const actual = hash.digest('hex'); assert(received === total && actual === largeDigest, `Download checksum or length mismatch ${received} ${actual}`); return { bytes: received, actual_sha256: actual, matched: true };
  });
  await check('real_download_range_bytes', async () => {
    const start = (total - (2 << 20)) + 17, length = 123457;
    const response = await fetch(base + route('/files/download-stream?file=' + encodeURIComponent('/' + largeName)), { headers: { Range: `bytes=${start}-${start + length - 1}` } });
    assert(response.status === 206, `Range ${response.status}`); const data = Buffer.from(await response.arrayBuffer()); assert(data.equals(bytesAt(start, length)), 'Range bytes mismatch'); assert(response.headers.get('Content-Range') === `bytes ${start}-${start + length - 1}/${total}`, 'Content-Range mismatch'); return { offset: start, bytes: length, matched: true, backend_prefix_discard: true };
  });
  await check('real_zero_byte_unicode_overwrite_and_cancel', async () => {
    await uploadBuffer('empty.txt', Buffer.alloc(0));
    const unicode = '日本語 café #%.txt'; await uploadBuffer(unicode, Buffer.from('first')); const overwrite = await uploadBuffer(unicode, Buffer.from('replacement contents')); await completeUpload(overwrite.location);
    const text = await fetch(base + route('/files/download-stream?file=' + encodeURIComponent('/' + unicode))); assert(await text.text() === 'replacement contents', 'Unicode overwrite mismatch');
    const cancel = await createUpload('cancelled.bin', block.length); await patchUpload(cancel, 0, block.subarray(0, 4096)); const removed = await fetch(cancel, { method: 'DELETE', headers: { 'Tus-Resumable': '1.0.0' } }); assert(removed.status === 204, `Cancel ${removed.status}`); assert((await fetch(cancel, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } })).status === 404, 'Cancelled upload still exists');
    const files = rows(await api('GET', route('/files/list?directory=/'))); assert(files.some(file => file.name === 'empty.txt' && file.size === 0), 'Zero byte target missing'); assert(!files.some(file => file.name === 'cancelled.bin'), 'Cancelled upload exposed a target'); return { zero_byte_file: true, unicode_overwrite: true, retry_complete: true, cancellation: true };
  });
  await check('real_directory_1205_entries_no_cutoff', async () => {
    const count = 1205; await uploadBuffer('listing.tar', tarOfDirectory(count)); await api('POST', route('/files/decompress'), { root: '/', file: 'listing.tar' });
    const files = rows(await api('GET', route('/files/list?directory=/many'))); assert(files.length === count, `Listing truncated to ${files.length}`); const names = new Set(files.map(file => file.name)); assert(names.has('file-0000.txt') && names.has('file-1204.txt'), 'Listing endpoints missing'); return { entries: files.length, first_and_last_present: true };
  });
  await check('real_linux_filename_and_directory_roundtrip', async () => {
    const name = 'line\nbreak\\config.txt', target = '/nested\\folder\nname', content = Buffer.from('Linux names survive exactly');
    await uploadBuffer(name, content, target);
    const entries = rows(await api('GET', route('/files/list?directory=' + encodeURIComponent(target)))); assert(entries.some(file => file.name === name), 'Linux filename changed in listing');
    const response = await fetch(base + route('/files/download-stream?file=' + encodeURIComponent(target + '/' + name))); assert(response.ok, `Linux filename download ${response.status}`);
    assert(Buffer.from(await response.arrayBuffer()).equals(content), 'Linux filename download content changed');
    assert(!/[\r\n]/.test(response.headers.get('Content-Disposition') || ''), 'Unsafe attachment header'); return { newline_and_backslash_filename: true, newline_and_backslash_directory: true, exact_bytes: true };
  });
  report.passed = true; report.completed_at = new Date().toISOString(); await save(); console.log(JSON.stringify({ passed: true, report: reportPath, resources: report.resources }));
} catch (error) { report.passed = false; report.completed_at = new Date().toISOString(); report.error = error.message; await save(); console.error(error.message); process.exitCode = 1; }
