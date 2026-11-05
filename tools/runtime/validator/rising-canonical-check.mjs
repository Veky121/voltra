/** Canonical Rising Java setup gates. No runtime work occurs on import.
 * Root must pin the reviewed candidate17 build/snapshot before execution.
 */
import { resolve } from 'node:path';
import { hash } from './runner.mjs';
import { campaign as h, receipt } from './campaign-session.mjs';
export const RISING_BUILD = 'c86a1b2a87fb7ec733c10caa2ff8e56ce3464b8eefd49fe5c0dfd73d49c2f0a4';
export const RISING_SNAPSHOT = 'C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-17/build-input-1793671959207';
export const RISING_RETRY18_BUILD = '248f83a9ae1acc2db8248993823d07e427ff26954e2549c89143c1470dacd0e7';
export const RISING_RETRY18_SNAPSHOT = 'C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-19/build-input-1793672787914';
export const RISING_RETRY20_BUILD = 'f78390ea7a4ab8d11352ba1698255879ddf46794a84545a792a1249ad31e4b45';
export const RISING_RETRY20_SNAPSHOT = 'C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-21/build-input-1793674979520';
export const isRisingId = id => ['rising-legacy-canonical','rising-legacy-retry18-canonical','rising-legacy-retry20-canonical'].includes(id);
export const risingBuildFor = id => id === 'rising-legacy-canonical' ? RISING_BUILD : id === 'rising-legacy-retry18-canonical' ? RISING_RETRY18_BUILD : id === 'rising-legacy-retry20-canonical' ? RISING_RETRY20_BUILD : undefined;
export const risingSnapshot = build => build === RISING_BUILD ? RISING_SNAPSHOT : /^[a-f0-9]{64}$/.test(RISING_RETRY18_BUILD) && build === RISING_RETRY18_BUILD ? RISING_RETRY18_SNAPSHOT : build === RISING_RETRY20_BUILD ? RISING_RETRY20_SNAPSHOT : undefined;
export const isRisingBuild = value => /^[a-f0-9]{64}$/.test(value ?? '') && Boolean(risingSnapshot(value));
export const risingIdentity = (id, build) => isRisingId(id) && isRisingBuild(build) && risingBuildFor(id) === build;
const recipe = 'rising_world/legacy/egg-rising-world-legacy.json';
const priorPath = resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/rising-world-java-live-acceptance.json');
const priorSHA = '2c416b904917e7bf9ea3ecaae85f08d6d116eaf5fa651a3382913974523ae632';
const sorted = v => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])) : v;
export function verifyRisingPrior(ctx, report, raw, pin, frozen) {
  const p = h.profileFromRuntime(recipe, receipt);
  if (!isRisingBuild(ctx.build) || receipt?.binary_sha256 !== ctx.build || resolve(receipt.snapshot) !== resolve(risingSnapshot(ctx.build))
    || !risingIdentity(ctx.game.id, ctx.build) || resolve(pin.path) !== priorPath || pin.sha256 !== priorSHA || hash(raw) !== priorSHA
    || report.catalog_path !== recipe || report.uuid !== 'd2d5d488-07b4-45e0-bf2d-639263d9b805' || report.node !== 202
    || report.java_preflight?.publisher_classes?.jar_sha256 !== 'b0d507b90b80846d5bdac97a146e2486b0b2b290d82e205e854debdd7235f5d4') throw Error('Exact historical Rising Java receipt required');
  if (hash(JSON.stringify(sorted(p))) !== frozen?.profileSHA256 || hash(p.egg.scripts.installation.script) !== frozen?.scriptSHA256)
    throw Error('Reviewed current Rising profile/script differs');
  if (p.required_ports !== 7 || p.consecutive_ports !== true || p.consecutive_ports_count !== 6 || p.consecutive_primary_offset !== 1)
    throw Error('Canonical Rising requires seven ports, six-port block starting primary minus one');
  if (frozen.nativeCurrentPending !== true || frozen.historicalSourceEquivalent !== false)
    throw Error('Historical helpers changed: explicit current-native-pending acknowledgement required');
  const pins = {
    '.voltra/java_games_runtime.py':ctx.build === RISING_RETRY20_BUILD ? 'eeb230d77ba00d6bd566859acb505d8bb84ff65ec0561793336b83c31aee3925' : '2bb493df4f69c0d55987e786c63766ab0a971c500f17f93c4616b8bb7dcf3534',
    '.voltra/java_games_install.py':ctx.build === RISING_BUILD ? 'a8ea49fdc75f19848530a54d45d330d94ee82724d6a9710318cd5c57ff878436' : '7d9bc8c64b8eae88e1cabbc3ed65f90bb0d4e09577d00a95789b4796c0fbfb3c',
    '.voltra/native_console.py':'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5'
  };
  const emitted = Object.fromEntries([...p.egg.scripts.installation.script.matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>[m[1],hash(m[3]+'\n')]));
  for (const [path,sha] of Object.entries(pins)) if (emitted[path] !== sha) throw Error('Reviewed Rising helper changed: '+path);
}
export function verifyRisingAllocation(rows) {
  const primary = rows.filter(r=>r.is_default);
  if (rows.length !== 7 || primary.length !== 1 || new Set(rows.map(r=>r.port)).size !== 7 || new Set(rows.map(r=>r.ip)).size !== 1
    || rows.some(r=>!Number.isSafeInteger(r.port)||r.port<1024||r.port>65535)) throw Error('Rising exact seven same-IP allocations required');
  const p=primary[0].port, block=Array.from({length:6},(_,i)=>p-1+i);
  if (block.some(port=>!rows.some(r=>r.port===port)) || rows.filter(r=>!block.includes(r.port)).length!==1) throw Error('Rising primary-minus-one block and separate RCON required');
}
export function verifyRisingExposure(body) {
  for (const [key,type] of Object.entries({server_name:'text',settings_max_players:'number'})) {
    const rows=body.fields.filter(f=>f.key===key);
    if(rows.length!==1||rows[0].type!==type||rows[0].readonly===true) throw Error('Rising typed existing publisher field missing: '+key);
  }
  for(const field of body.fields) if(!['server_name','settings_max_players'].includes(field.key) && field.readonly!==true) throw Error('Rising managed setting unexpectedly writable');
}
