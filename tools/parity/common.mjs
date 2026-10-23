import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export { assert };
export const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const reference = path.resolve(project, '../pterodactyl-vite');
export const artifact = path.join(project, 'artifacts/parity');
export const baseURL = process.env.PARITY_BASE_URL || 'http://127.0.0.1:8088';
const target = new URL(baseURL);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
  throw new Error('Parity mutations are restricted to the local rewrite app.');
}
if (target.port === '8090') throw new Error('Never mutate the reference PHP app.');
export const runID = `parity-${Date.now()}-${process.pid}`;

export async function jsonFile(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}
export async function loadJSON(file) { return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
export function attrs(value) { return value?.attributes ?? value; }
export function rows(value) {
  assert.equal(value?.object, 'list', 'Response must retain the list envelope');
  assert.ok(Array.isArray(value.data), 'Response data must be an array');
  return value.data.map(attrs);
}
export function sanitize(value) {
  return String(value).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(password|secret|token|authorization|daemon_token)(["\s:=]+)[^\s,;}]+/gi, '$1$2[redacted]')
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgresql://[redacted]@')
    .slice(0, 800);
}
export async function request(method, endpoint, body, options = {}) {
  const headers = { Accept: 'application/json', ...options.headers };
  if (options.userID !== undefined) {
    headers[process.env.PARITY_DEV_USER_HEADER || 'X-Dev-User-ID'] = String(options.userID);
  }
  let payload;
  if (body !== undefined) {
    if (typeof body === 'string' || Buffer.isBuffer(body)) payload = body;
    else { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  }
  const response = await fetch(new URL(endpoint, baseURL), {
    method, headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(options.timeout || 30000),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  const expected = options.status || [200, 201, 202, 204];
  if (!expected.includes(response.status)) {
    const detail = data?.errors?.map(e => `${e.code}: ${e.detail}`).join('; ') || `content-type ${response.headers.get('content-type')}`;
    throw new Error(`${method} ${endpoint.split('?')[0]}: expected ${expected.join('/')} received ${response.status}; ${sanitize(detail)}`);
  }
  return { status: response.status, data, headers: response.headers };
}
export class Suite {
  constructor(name) { this.name = name; this.checks = []; this.started = new Date().toISOString(); }
  async check(id, feature, description, test, sourceRoutes = []) {
    const start = performance.now();
    try {
      const evidence = await test();
      this.checks.push({ id, feature, description, status: 'passed', duration_ms: Math.round(performance.now() - start), source_routes: sourceRoutes, evidence: evidence ?? null });
      console.log(`PASS ${id}`);
      return true;
    } catch (error) {
      this.checks.push({ id, feature, description, status: 'failed', duration_ms: Math.round(performance.now() - start), source_routes: sourceRoutes, detail: sanitize(error.message) });
      console.log(`FAIL ${id}: ${sanitize(error.message)}`);
      return false;
    }
  }
  blocked(id, feature, reason) {
    this.checks.push({ id, feature, status: 'blocked', detail: reason, source_routes: [] });
    console.log(`BLOCKED ${id}: ${reason}`);
  }
  async finish(filename) {
    const counts = this.checks.reduce((a, x) => (a[x.status] = (a[x.status] || 0) + 1, a), {});
    const report = { schema_version: 1, suite: this.name, run_id: runID, started_at: this.started, completed_at: new Date().toISOString(), base_url: baseURL, counts, full_parity_verified: false, checks: this.checks };
    await jsonFile(path.join(artifact, filename), report);
    console.log(JSON.stringify({ suite: this.name, counts, report: `artifacts/parity/${filename}` }));
    if (counts.failed || counts.blocked) process.exitCode = 1;
    return report;
  }
}
