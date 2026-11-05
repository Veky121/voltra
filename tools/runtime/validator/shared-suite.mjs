import { readFile, writeFile, readdir, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as session from './campaign-session.mjs';

// Shared service checks run once per served build and suite hash, on a parked,
// owned fixture. They do not replace game-specific native acceptance.
export async function sharedSuite(config) {
  const out = resolve(config.output), path = resolve(out, 'shared-platform.json');
  const fingerprint = createHash('sha256').update(config.build).update(await readFile(new URL(import.meta.url))).digest('hex');
  let prior; try { prior = JSON.parse(await readFile(path)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (prior?.fingerprint === fingerprint && prior.status === 'PASS') return { ...prior, reused: true };
  if (prior && Object.keys(prior.owned ?? {}).length) throw Error('Recover recorded shared-suite resources before retry');
  const lockPath = resolve(out, 'queue.lock');
  const lock = await open(lockPath, 'wx');
  await lock.writeFile(JSON.stringify({ pid: process.pid, scope: 'shared-platform' }));
  const candidates = [];
  for (const name of await readdir(out)) if (name.endsWith('.json')) {
    const r = JSON.parse(await readFile(resolve(out, name)));
    if (r.status === 'PASS' && r.fixture?.server) candidates.push(r);
  }
  const game = candidates.find(r => r.game === 'openttd') ?? candidates.find(r => r.game === 'terraria') ?? candidates[0];
  if (!game) { await lock.close(); await unlink(lockPath); throw Error('Shared suite needs a parked passed fixture'); }
  const report = { build: config.build, fingerprint, fixture: game.fixture.server, started: new Date().toISOString(), status: 'RUNNING', checks: [], owned: {} };
  const save = () => writeFile(path, JSON.stringify(report, null, 2));
  const signal = AbortSignal.timeout(300000);
  let verified = false;
  const base = 'http://127.0.0.1:18099', route = '/api/client/servers/' + report.fixture.uuid;
  async function request(method, p, body, { raw = false, user } = {}) {
    const r = await fetch(base + p, { method, signal, headers: { 'Content-Type': raw ? 'text/plain' : 'application/json', ...(user ? { 'X-Dev-User-ID': String(user) } : {}) }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    if (!r.ok) throw Error(`${method} ${p.split('?')[0]} returned ${r.status}`);
    if (r.status === 204) return null;
    return raw ? r.text() : r.json();
  }
  async function until(fn, description) {
    while (!signal.aborted) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 500)); }
    throw Error('Timeout: ' + description);
  }
  async function check(name, fn) {
    try { report.checks.push({ name, status: 'PASS', evidence: await fn() }); }
    catch (e) { report.checks.push({ name, status: 'FAIL', error: e.message }); throw e; }
    finally { await save(); }
  }
  const state = async () => (await request('GET', route + '/resources')).attributes.current_state;
  const file = '/validator-shared-' + randomUUID() + '.txt';
  const read = f => request('GET', route + '/files/contents?file=' + encodeURIComponent(f), undefined, { raw: true });
  const write = (f, text) => request('POST', route + '/files/write?file=' + encodeURIComponent(f), text, { raw: true });
  try {
    await session.open(config, { out });
    await save();
    const server = (await request('GET', '/api/application/servers/' + report.fixture.id)).attributes;
    if (server.uuid !== report.fixture.uuid || server.name !== report.fixture.name || !server.name.startsWith('validator-')) throw Error('Shared fixture identity mismatch');
    verified = true;
    if (await state() !== 'offline') throw Error('Shared fixture must begin parked');
    await check('files-list-write-read-rename-delete', async () => {
      await write(file, 'original'); report.owned.file = file; await save();
      if (await read(file) !== 'original') throw Error('Write/read mismatch');
      const renamed = file + '.renamed';
      await request('PUT', route + '/files/rename', { root: '/', files: [{ from: file.slice(1), to: renamed.slice(1) }] });
      report.owned.file = renamed; await save();
      const rows = (await request('GET', route + '/files/list?directory=%2F')).data;
      if (!rows.some(x => x.attributes.name === renamed.slice(1)) || await read(renamed) !== 'original') throw Error('Rename/list mismatch');
      await request('POST', route + '/files/delete', { root: '/', files: [renamed.slice(1)] });
      delete report.owned.file; await save();
      const after = (await request('GET', route + '/files/list?directory=%2F')).data;
      if (after.some(x => x.attributes.name === renamed.slice(1))) throw Error('Delete did not remove probe');
      return { verified: true };
    });
    await check('file-reader-permissions', async () => {
      await write(file, 'permission probe'); report.owned.file = file; await save();
      const username = 'validator_' + randomUUID().replaceAll('-', '').slice(0, 12), email = username + '@localhost.invalid';
      const user = (await request('POST', '/api/application/users', { username, email, first_name: 'Validator', last_name: 'Reader', root_admin: false })).attributes;
      report.owned.user = { id: user.id, uuid: user.uuid, username }; await save();
      await request('POST', route + '/users', { email, permissions: ['file.read', 'file.read-content'] });
      report.owned.subuser = true; await save();
      const me = (await request('GET', '/api/client/account', undefined, { user: user.id })).attributes;
      if (me.id !== user.id || me.root_admin !== false) throw Error('Nonadmin identity not selected');
      if (await request('GET', route + '/files/contents?file=' + encodeURIComponent(file), undefined, { raw: true, user: user.id }) !== 'permission probe') throw Error('Allowed read failed');
      const denied = await fetch(base + route + '/files/write?file=' + encodeURIComponent(file), { method: 'POST', signal, headers: { 'Content-Type': 'text/plain', 'X-Dev-User-ID': String(user.id) }, body: 'must not write' });
      await denied.text();
      if (denied.status !== 403 || await read(file) !== 'permission probe') throw Error('Reader write not denied');
      await request('DELETE', route + '/users/' + user.uuid); delete report.owned.subuser; await save();
      await request('DELETE', '/api/application/users/' + user.id); delete report.owned.user; await save();
      return { read: true, writeDenied: 403, identityScope: 'loopback dev user selection; not login/session acceptance' };
    });
    await check('schedule-executes-power-stop', async () => {
      await request('POST', route + '/power', { signal: 'start' });
      await until(async () => await state() === 'running', 'running before scheduled stop');
      const schedule = (await request('POST', route + '/schedules', { name: 'validator-once', minute: '*', hour: '*', day_of_month: '*', month: '*', day_of_week: '*', is_active: false, only_when_online: false })).attributes;
      report.owned.schedule = schedule.id; await save();
      await request('POST', route + '/schedules/' + schedule.id + '/tasks', { action: 'power', payload: 'stop', time_offset: 0, continue_on_failure: false });
      await request('POST', route + '/schedules/' + schedule.id + '/execute', {});
      await until(async () => await state() === 'offline', 'scheduled stop');
      const completed = await until(async () => {
        const s = (await request('GET', route + '/schedules/' + schedule.id)).attributes;
        return !s.is_processing && s.last_run_at ? s : false;
      }, 'schedule completion');
      await request('DELETE', route + '/schedules/' + schedule.id); delete report.owned.schedule; await save();
      return { offline: true, lastRun: completed.last_run_at, scope: 'manual execute through scheduler; wall-clock cron timing separate' };
    });
    await check('backup-restore-content', async () => {
      await write(file, 'before backup');
      const backup = (await request('POST', route + '/backups', { name: 'validator-probe-only', ignored: ['*', '!' + file.slice(1)] })).attributes;
      report.owned.backup = backup.uuid; await save();
      const done = await until(async () => {
        const b = (await request('GET', route + '/backups/' + backup.uuid)).attributes;
        if (b.completed_at && !b.is_successful) throw Error('Backup callback reported failure');
        return b.is_successful && b.completed_at && b;
      }, 'backup completion');
      await write(file, 'changed after backup');
      await request('POST', route + '/backups/' + backup.uuid + '/restore', { truncate: false });
      await until(async () => (await request('GET', '/api/application/servers/' + report.fixture.id)).attributes.status === null, 'restore callback');
      if (await read(file) !== 'before backup') throw Error('Restore did not recover original bytes');
      await request('DELETE', route + '/backups/' + backup.uuid); delete report.owned.backup; await save();
      await request('POST', route + '/files/delete', { root: '/', files: [file.slice(1)] }); delete report.owned.file; await save();
      return { bytes: done.bytes, checksum: done.checksum, restoredContent: true, truncate: false };
    });
    report.status = 'PASS';
  } catch (e) { report.status = 'FAIL'; report.error = e.message; }
  finally {
    // Keep failed suite artifacts and exact ownership for recovery. No broad
    // delete of user accounts, backups, schedules or game files.
    if (verified) {
      try {
        const response = await fetch(base + route + '/power', { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signal: 'stop' }) });
        if (!response.ok) throw Error('Final stop request failed');
        const deadline = Date.now() + 60000;
        let offline = false;
        while (Date.now() < deadline) {
          const s = await fetch(base + route + '/resources', { signal: AbortSignal.timeout(10000) });
          if ((await s.json()).attributes?.current_state === 'offline') { offline = true; break; }
          await new Promise(r => setTimeout(r, 500));
        }
        if (!offline) throw Error('Final stop not confirmed');
        report.parked = true;
      } catch (e) { report.status = 'UNSAFE'; report.parkError = e.message; }
    }
    report.finished = new Date().toISOString(); await save();
    await session.close();
    await lock.close(); await unlink(lockPath);
  }
  return report;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const config = JSON.parse(await readFile(process.argv[2]));
  const report = await sharedSuite(config);
  console.log(JSON.stringify({ status: report.status, checks: report.checks, error: report.error }, null, 2));
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}
