import { assert, attrs, rows, baseURL, request, runID, Suite } from './common.mjs';

const suite = new Suite('Dedicated real Wings runtime');
if (!process.env.PARITY_SERVER || process.env.PARITY_ALLOW_RUNTIME !== '1') {
  suite.blocked('runtime.explicit-dedicated-server', 'operations', 'Set PARITY_SERVER to a disposable rewrite server and PARITY_ALLOW_RUNTIME=1 to enable power and backup restoration.');
  await suite.finish('runtime.json');
} else {
  const server = `/api/client/servers/${encodeURIComponent(process.env.PARITY_SERVER)}`;
  const dir = runID;
  const directory = `/${dir}`;
  let backup, archive;
  const get = async p => (await request('GET', p)).data;
  const post = async (p, d = {}) => (await request('POST', p, d)).data;
  const write = async (filename, content) => request('POST', `${server}/files/write?file=${encodeURIComponent(filename)}`, content, { headers: { 'Content-Type': 'text/plain' } });
  const read = async filename => (await request('GET', `${server}/files/contents?file=${encodeURIComponent(filename)}`)).data;
  const resources = async () => attrs(await get(`${server}/resources`));
  const poll = async (description, predicate, limit = 45000) => {
    const deadline = Date.now() + limit;
    do { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 500)); } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${description}`);
  };
  const power = async signal => {
    await post(`${server}/power`, { signal });
    await poll(signal === 'stop' || signal === 'kill' ? 'offline state' : 'running state', async () => (await resources()).current_state === (signal === 'stop' || signal === 'kill' ? 'offline' : 'running'));
  };
  async function signedURL(route) {
    const data = attrs(await get(route)); const url = new URL(data.url, baseURL);
    assert.equal(url.origin, new URL(baseURL).origin, 'Daemon links should use the same-origin local proxy');
    return url;
  }
  await suite.check('runtime.resources-live', 'operations', 'Real Wings exposes resource data with daemon state and resource counters', async () => {
    const data = await resources(); assert.ok(['offline', 'starting', 'running', 'stopping'].includes(data.current_state));
    for (const field of ['memory_bytes', 'cpu_absolute', 'disk_bytes']) assert.equal(typeof data.resources[field], 'number');
    // Reference StatsTransformer deliberately flattens Wings network counters.
    assert.equal(typeof data.resources.network_rx_bytes, 'number'); assert.equal(typeof data.resources.network_tx_bytes, 'number');
  }, ['GET /api/client/servers/{server}/resources']);
  await suite.check('runtime.power-start-stop-restart', 'operations', 'Power requests produce real running/offline transitions rather than accepted stub responses', async () => {
    await power('start'); const firstUptime = (await resources()).resources.uptime;
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.ok((await resources()).resources.uptime >= firstUptime);
    await poll('running uptime sample', async () => (await resources()).resources.uptime > 3000);
    const beforeRestart = (await resources()).resources.uptime;
    await post(`${server}/power`, { signal: 'restart' });
    await poll('restart to reset daemon uptime', async () => {
      const data = await resources(); return data.current_state === 'running' && data.resources.uptime < beforeRestart;
    });
    await power('stop'); await power('start');
  }, ['POST /api/client/servers/{server}/power']);
  await suite.check('runtime.power-invalid', 'operations', 'Unknown power signals reject validation', async () => {
    await request('POST', `${server}/power`, { signal: 'destroy' }, { status: [400, 422] });
  });
  await suite.check('runtime.websocket-console-command-stats', 'operations', 'Websocket authenticates with Wings, streams console output and proves both HTTP and socket commands reached the real process', async () => {
    const connection = (await get(`${server}/websocket`)).data;
    assert.ok(connection.token); assert.ok(connection.socket);
    const messages = []; let socketError = false;
    const socket = new WebSocket(connection.socket);
    socket.addEventListener('error', () => { socketError = true; });
    socket.addEventListener('message', event => { try { messages.push(JSON.parse(event.data)); } catch {} });
    try {
      await poll('websocket open', async () => { assert.equal(socketError, false); return socket.readyState === WebSocket.OPEN; }, 15000);
      socket.send(JSON.stringify({ event: 'auth', args: [connection.token] }));
      await poll('Wings websocket authentication success', async () => messages.some(x => x.event === 'auth success'), 15000);
      const httpMarker = `${runID}-http-command`;
      await post(`${server}/command`, { command: httpMarker });
      await poll('HTTP console command echo', async () => messages.some(x => x.event === 'console output' && x.args?.some(arg => String(arg).includes(`received:${httpMarker}`))), 15000);
      const socketMarker = `${runID}-socket-command`;
      socket.send(JSON.stringify({ event: 'send command', args: [socketMarker] }));
      await poll('socket console command echo', async () => messages.some(x => x.event === 'console output' && x.args?.some(arg => String(arg).includes(`received:${socketMarker}`))), 15000);
      socket.send(JSON.stringify({ event: 'send stats', args: [] }));
      await poll('resource event', async () => messages.some(x => x.event === 'stats'), 15000);
      return { real_process_command_echoes: 2, websocket_auth: 'verified', stats_stream: 'verified' };
    } finally { socket.close(); }
  }, ['GET /api/client/servers/{server}/websocket', 'POST /api/client/servers/{server}/command']);
  await suite.check('runtime.mkdir-files', 'operations', 'Directory creation and daemon writes persist exact file bytes', async () => {
    await post(`${server}/files/create-folder`, { root: '/', name: dir });
    await write(`${directory}/proof.txt`, `${runID}\nbackup-original\n`);
    assert.equal(await read(`${directory}/proof.txt`), `${runID}\nbackup-original\n`);
  }, ['POST /api/client/servers/{server}/files/create-folder']);
  await suite.check('runtime.file-copy', 'operations', 'Daemon copy creates another real file with identical content', async () => {
    await post(`${server}/files/copy`, { location: `${directory}/proof.txt` });
    const actual = rows(await get(`${server}/files/list?directory=${encodeURIComponent(directory)}`));
    const copy = actual.find(x => x.name !== 'proof.txt' && x.is_file);
    assert.ok(copy, 'Copy must create a second file'); assert.equal(await read(`${directory}/${copy.name}`), `${runID}\nbackup-original\n`);
  }, ['POST /api/client/servers/{server}/files/copy']);
  await suite.check('runtime.chmod', 'operations', 'chmod changes the daemon file metadata', async () => {
    await post(`${server}/files/chmod`, { root: directory, files: [{ file: 'proof.txt', mode: '600' }] });
    const actual = rows(await get(`${server}/files/list?directory=${encodeURIComponent(directory)}`)).find(x => x.name === 'proof.txt');
    assert.match(String(actual.mode_bits ?? actual.mode), /600|rw-------/);
  }, ['POST /api/client/servers/{server}/files/chmod']);
  await suite.check('runtime.download-signed-real-content', 'operations', 'Signed file download retrieves actual file content through the local panel proxy', async () => {
    const url = await signedURL(`${server}/files/download?file=${encodeURIComponent(`${directory}/proof.txt`)}`);
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) }); assert.equal(response.status, 200);
    assert.equal(await response.text(), `${runID}\nbackup-original\n`);
    const tampered = new URL(url); tampered.searchParams.set('token', 'invalid');
    assert.ok([401, 403].includes((await fetch(tampered)).status));
  }, ['GET /api/client/servers/{server}/files/download']);
  await suite.check('runtime.upload-multipart', 'operations', 'Signed multipart upload creates a file that can be read from Wings', async () => {
    const url = await signedURL(`${server}/files/upload`); url.searchParams.set('directory', directory);
    const form = new FormData(); form.append('files', new Blob([`${runID}\nupload-proof\n`]), 'uploaded.txt');
    const response = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) });
    assert.ok([200, 204].includes(response.status)); assert.equal(await read(`${directory}/uploaded.txt`), `${runID}\nupload-proof\n`);
  }, ['GET /api/client/servers/{server}/files/upload']);
  await suite.check('runtime.archive-restore', 'operations', 'Archive and extraction operate on real daemon files', async () => {
    archive = attrs(await post(`${server}/files/compress`, { root: directory, files: ['proof.txt'] }));
    assert.ok(archive.name); await post(`${server}/files/delete`, { root: directory, files: ['proof.txt'] });
    await post(`${server}/files/decompress`, { root: directory, file: archive.name });
    assert.equal(await read(`${directory}/proof.txt`), `${runID}\nbackup-original\n`);
  }, ['POST /api/client/servers/{server}/files/compress', 'POST /api/client/servers/{server}/files/decompress']);
  await suite.check('runtime.path-boundary', 'operations', 'Path traversal cannot reveal host system files', async () => {
    for (const filename of ['../../../../etc/passwd', '/proc/self/environ', '../config.yml']) {
      // Wings safe-path resolution may emit500; PHP also maps it to a safe502.
      const response = await request('GET', `${server}/files/contents?file=${encodeURIComponent(filename)}`, undefined, { status: [400, 403, 404, 502] });
      assert.ok(Array.isArray(response.data.errors));
      if (response.status === 502) assert.equal(response.data.errors[0].code, 'DaemonRequestException');
      assert.doesNotMatch(JSON.stringify(response.data), /root:x:0:0|BEGIN (?:OPENSSH |RSA )?PRIVATE KEY|"stack"|"trace"/);
    }
  });
  await suite.check('runtime.backup-completion', 'operations', 'A real local backup completes through the authenticated Wings callback with size/checksum', async () => {
    backup = attrs(await post(`${server}/backups`, { name: runID, ignored: '', is_locked: false })); assert.ok(backup.uuid);
    await poll('Wings backup completion', async () => {
      backup = attrs(await get(`${server}/backups/${backup.uuid}`)); return backup.completed_at !== null && backup.completed_at !== undefined;
    });
    assert.equal(backup.is_successful, true); assert.ok(backup.bytes > 0); assert.ok(backup.checksum);
  }, ['POST /api/client/servers/{server}/backups', 'GET /api/client/servers/{server}/backups/{backup}', 'POST /api/remote/backups/{backup}']);
  if (backup) {
    const route = `${server}/backups/${backup.uuid}`;
    await suite.check('runtime.backup-lock', 'operations', 'Locked backups reject deletion and unlock restores manageability', async () => {
      await post(`${route}/lock`); assert.equal(attrs(await get(route)).is_locked, true);
      await request('DELETE', route, undefined, { status: [400, 403, 409, 422] });
      await post(`${route}/lock`); assert.equal(attrs(await get(route)).is_locked, false);
    }, ['POST /api/client/servers/{server}/backups/{backup}/lock']);
    await suite.check('runtime.backup-download', 'operations', 'Backup download returns an actual gzip archive rather than a token-only success', async () => {
      const response = await fetch(await signedURL(`${route}/download`), { signal: AbortSignal.timeout(15000) }); assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer()); assert.ok(bytes.length > 20); assert.equal(bytes.subarray(0, 2).toString('hex'), '1f8b');
    }, ['GET /api/client/servers/{server}/backups/{backup}/download']);
    await suite.check('runtime.backup-restore-file', 'operations', 'Restoring a completed backup recovers the original bytes after a subsequent edit', async () => {
      await power('stop'); await write(`${directory}/proof.txt`, 'changed-after-backup');
      await post(`${route}/restore`, { truncate: false });
      await poll('restored file bytes', async () => {
        try { return await read(`${directory}/proof.txt`) === `${runID}\nbackup-original\n`; } catch { return false; }
      });
      await poll('restoring status cleared', async () => attrs(await get(server)).status !== 'restoring_backup');
      await power('start');
    }, ['POST /api/client/servers/{server}/backups/{backup}/restore', 'POST /api/remote/backups/{backup}/restore']);
    await suite.check('runtime.backup-delete', 'operations', 'Deleting the temporary backup removes its persisted record', async () => {
      if (attrs(await get(route)).is_locked) await post(`${route}/lock`);
      await request('DELETE', route); await request('GET', route, undefined, { status: [404] });
    }, ['DELETE /api/client/servers/{server}/backups/{backup}']);
  }
  await suite.check('runtime.cleanup-files', 'cleanup', 'Delete only the scratch directory owned by this run', async () => {
    await post(`${server}/files/delete`, { root: '/', files: [dir] });
    assert.ok(!rows(await get(`${server}/files/list`)).some(x => x.name === dir));
  });
  await suite.finish('runtime.json');
}
