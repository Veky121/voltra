// Astroneer readiness diagnostics. Default plan/self-test never touch runtime.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  root, runtime, api, docker, digest, verifyRuntime, activeLease, claimNative, acquireInstaller, releaseInstaller, releaseGate, waitNativeInstaller,
  profileFromRuntime, createNativeFixture, containers, proveInstaller,
  observePower, installerGate,
} from './campaign-native-20261029.mjs';

export const recipe = 'astroneer/egg-astroneer-dedicated-server.json';
export const owner = 'astroneer_native';
export const request = {game: recipe, owner, memory_mib: 4096, disk_mib: 24576, ports: 1};
const logName = '/home/container/Astro/Saved/Logs/Astro.log';
const base = path.join(root, '.local/game-parity-20261029/astroneer-native');
const reportFile = path.join(root, 'artifacts/game-parity-20261029/astroneer-native-readiness.json');
const approvedFixture = {uuid: 'ade0b289-f128-4cf9-8f3b-9c0ca4ef94e4', id: 35, node: 1, egg: 30};

async function assertFailedFixture(state) {
  const server = (await api('/api/application/servers/' + state.server.id)).attributes;
  for (const [key, value] of Object.entries(approvedFixture)) if (server[key] !== value) throw Error('Root-approved failed fixture identity differs: ' + key);
  if (server.status !== 'install_failed' || server.container?.installed !== 0) throw Error('Exact failed initial installation state required');
  const owned = containers().filter(container => container.Name.includes(server.uuid));
  if (owned.some(container => container.State.Running || container.State.Pid !== 0)) throw Error('Owned game/installer process still active');
  return {server_uuid: server.uuid, server_id: server.id, node: server.node, egg: server.egg, status: server.status, installed: server.container.installed, containers: owned.map(container => ({id: container.Id, name: container.Name, state: container.State.Status, running: container.State.Running, pid: container.State.Pid}))};
}

export function assertAstroneerLease(lease) {
  if (lease.game !== recipe || lease.owner !== owner || lease.status !== 'active' || lease.memory_mib !== 4096 || lease.disk_mib < 24576 || !Array.isArray(lease.ports) || lease.ports.length !== 1 || !Number.isSafeInteger(lease.ports[0]) || lease.ports[0] < 29100 || lease.ports[0] > 29199) throw Error('Coordinator-owned bounded Astroneer lease required');
  return lease;
}

function statePath(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Exact coordinator lease UUID required');
  return path.join(base, id, 'state.json');
}
function save(state) {
  const file = statePath(state.lease.lease_id);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', {mode: 0o600});
  fs.renameSync(temporary, file);
}
function attemptFolder(state) {
  const folder = path.dirname(statePath(state.lease.lease_id));
  if (!state.installer_attempt) return folder;
  if (!/^repair-[a-f0-9-]{36}$/.test(state.installer_attempt)) throw Error('Unsafe repair attempt identity');
  const target = path.join(folder, state.installer_attempt); fs.mkdirSync(target, {recursive: true}); return target;
}
function readPrivateJSON(file) {
  const target = path.resolve(file);
  if (!target.startsWith(path.resolve(runtime) + path.sep) && !target.startsWith(path.resolve(base) + path.sep)) throw Error('Private campaign runtime JSON path required');
  const resolved = fs.realpathSync(target);
  if ((!resolved.startsWith(fs.realpathSync(runtime) + path.sep) && !(fs.existsSync(base) && resolved.startsWith(fs.realpathSync(base) + path.sep))) || !fs.lstatSync(target).isFile()) throw Error('Private input must be a confined regular file');
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

async function context(id, {existing = true} = {}) {
  const queue = JSON.parse(fs.readFileSync(path.join(runtime, 'queue.json')));
  if (queue.activation_pause) throw Error('Coordinator activation pause is active');
  const lease = assertAstroneerLease(activeLease(id, owner, queue));
  const receipt = await verifyRuntime();
  const state = existing ? JSON.parse(fs.readFileSync(statePath(id))) : {lease, runtime: {source_fingerprint: receipt.source_fingerprint, binary_sha256: receipt.binary_sha256}};
  if (existing && (state.lease.lease_id !== id || state.lease.owner !== owner || state.runtime.source_fingerprint !== receipt.source_fingerprint || state.runtime.binary_sha256 !== receipt.binary_sha256)) throw Error('Native fixture does not belong to current root snapshot');
  if (state.server && (!/^[a-f0-9-]{36}$/.test(state.server.uuid) || !Number.isSafeInteger(state.server.id))) throw Error('Invalid owned server identity');
  return {lease, receipt, state};
}

export function classifyReadinessEvidence(capture, startedAt, primary) {
  const started = Date.parse(startedAt);
  const fresh = capture.log?.exists === true && Number.isFinite(started) && capture.log.mtime_ms >= started && capture.log.bytes > 0 && capture.log.offset === 0;
  const nativeListener = capture.sockets?.some(socket => socket.protocol.startsWith('udp') && socket.port === primary && socket.native_pids.length > 0) === true;
  return {fresh_complete_native_log: fresh, independent_native_udp_listener: nativeListener,
    candidate_ready_signal_review_possible: fresh && nativeListener, gameplay_verified: false, readiness_marker_selected: false};
}

export function replaceNativePublicIP(source, address) {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address) || address.split('.').some(part => Number(part) > 255)) throw Error('Canonical IPv4 required');
  const text = source.toString('utf8');
  if (!Buffer.from(text).equals(source)) throw Error('Native INI is not lossless UTF-8');
  let section = '', count = 0;
  const updated = text.split(/(?<=\n)/).map(raw => {
    const line = raw.replace(/[\r\n]+$/, ''), ending = raw.slice(line.length);
    const header = line.replace(/^\ufeff/, '').match(/^\s*\[([^\]]+)\]/);
    if (header) {section = header[1].toLowerCase(); return raw;}
    if (section !== '/script/astro.astroserversettings') return raw;
    const scalar = line.match(/^([ \t]*PublicIP[ \t]*=[ \t]*)([0-9.]+)([ \t]*(?:[;#].*)?)$/i);
    if (!scalar) return raw;
    count++; return scalar[1] + address + scalar[3] + ending;
  }).join('');
  if (count !== 1) throw Error('One unambiguous native PublicIP required');
  return Buffer.from(updated);
}

async function nativeINI(state) {
  const url = 'http://127.0.0.1:18099/api/client/servers/' + state.server.uuid + '/files/contents?file=' + encodeURIComponent('/Astro/Saved/Config/WindowsServer/AstroServerSettings.ini');
  const response = await fetch(url);
  if (!response.ok) throw Error('Owned native INI read failed: HTTP ' + response.status);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > 1024*1024) throw Error('Native INI exceeds bounded capture limit');
  return body;
}
async function writeNativeINI(state, body) {
  const response = await fetch('http://127.0.0.1:18099/api/client/servers/' + state.server.uuid + '/files/write?file=' + encodeURIComponent('/Astro/Saved/Config/WindowsServer/AstroServerSettings.ini'), {method: 'POST', headers: {'Content-Type': 'application/octet-stream'}, body});
  if (!response.ok) throw Error('Owned native INI write failed: HTTP ' + response.status);
}

// Runs only inside the exact owned game container. Reads fixed native log and
// process/socket metadata; never prints raw cmdlines, settings or credentials.
export const capturePython = String.raw`import base64,json,os,pathlib,time
def native_command(command):
 arguments=command.lower().split(b'\0')
 names=[argument.replace(b'\\',b'/').rsplit(b'/',1)[-1] for argument in arguments if argument]
 allowed=(b'astroserver-win64-shipping.exe',b'wine',b'wine64',b'wine64-preloader',b'wine-preloader')
 return bool(names and names[0] in allowed and b'astroserver-win64-shipping.exe' in names)
def socket_rows(text,protocol,native):
 rows=[]
 for line in text.splitlines()[1:]:
  columns=line.split()
  if len(columns)<10: continue
  port=int(columns[1].rsplit(':',1)[1],16);inode=columns[9]
  owners=[pid for pid,inodes in native.items() if inode in inodes]
  rows.append({'protocol':protocol,'port':port,'state':columns[3],'inode':inode,'native_pids':owners})
 return rows
root=pathlib.Path('/home/container').resolve()
target=root/'Astro/Saved/Logs/Astro.log'
if target.is_symlink() or not target.resolve().is_relative_to(root): raise ValueError('Unsafe native log path')
result={'observed_at_ms':int(time.time()*1000),'log':{'exists':False},'sockets':[],'native_processes':[]}
if target.exists():
 if not target.is_file(): raise ValueError('Native log is not a regular file')
 stat=target.stat();limit=8*1024*1024;offset=max(0,stat.st_size-limit)
 with target.open('rb') as stream:
  stream.seek(offset);body=stream.read(limit+1)
 if len(body)>limit: raise ValueError('Native log grew beyond capture limit')
 result['log']={'exists':True,'mtime_ms':stat.st_mtime_ns//1000000,'inode':stat.st_ino,'bytes':len(body),'file_bytes':stat.st_size,'offset':offset,'content_base64':base64.b64encode(body).decode('ascii')}
native={}
for proc in pathlib.Path('/proc').glob('[0-9]*'):
 try:
  if int(proc.name)==os.getpid(): continue
  if not native_command((proc/'cmdline').read_bytes()): continue
  pid=int(proc.name);native[pid]=set();result['native_processes'].append({'pid':pid,'binary':'AstroServer-Win64-Shipping.exe'})
  for fd in (proc/'fd').iterdir():
   try:
    link=os.readlink(fd)
    if link.startswith('socket:['): native[pid].add(link[8:-1])
   except OSError: pass
 except (OSError,ValueError): pass
for protocol in ('udp','udp6','tcp','tcp6'):
 table=pathlib.Path('/proc/net')/protocol
 if not table.exists(): continue
 result['sockets'].extend(socket_rows(table.read_text(),protocol,native))
print(json.dumps(result))`;

export const quarantinePython = String.raw`import hashlib,json,os,pathlib,stat
uuid='ade0b289-f128-4cf9-8f3b-9c0ca4ef94e4'
root=pathlib.Path('/server');host=pathlib.Path('/volumes')/uuid
if host.is_symlink() or not host.is_dir() or root.stat().st_ino!=host.stat().st_ino or root.stat().st_dev!=host.stat().st_dev:raise ValueError('Owned volume identity differs')
def strict(relative,must_exist=True):
 current=root
 for part in pathlib.PurePosixPath(relative).parts:
  if part in ('.','..') or part.startswith('/'):raise ValueError('Unsafe repair path')
  current=current/part
  if current.is_symlink():raise ValueError('Repair path cannot traverse symlinks')
  if not current.resolve().is_relative_to(root.resolve()):raise ValueError('Repair path leaves owned volume')
 if must_exist and not current.exists():raise ValueError('Expected repair source absent')
 return current
source_name='.voltra/proton/GE-Proton11-9';destination_name='.voltra/proton-quarantine/failed-initial-GE-Proton11-9'
source=strict(source_name);destination=strict(destination_name,False)
if not source.is_dir() or destination.exists():raise ValueError('Repair source/destination state differs')
if strict('.voltra/proton/release.json',False).exists():raise ValueError('Refuse quarantining receipted runtime')
expected={'proton':'907e63fe43e8f10b2c35bce4b3c6f382f6b72254891d97ae29c52ed58508a59f','files/lib/wine/x86_64-unix/lsteamclient.so':'fc6cf76d9e3029c445988ff8d9a2b358d38f873ad72d96f454b6e42405054d6a'}
def file_hash(file):
 digest=hashlib.sha256()
 with file.open('rb') as stream:
  for block in iter(lambda:stream.read(1048576),b''):digest.update(block)
 return digest.hexdigest()
for relative,wanted in expected.items():
 target=strict(source_name+'/'+relative)
 if not target.is_file() or file_hash(target)!=wanted:raise ValueError('Partial runtime hash differs')
def manifest(folder,excluded=(),directories=False):
 rows={}
 for current,dirs,files in os.walk(folder,followlinks=False):
  current=pathlib.Path(current)
  for name in list(dirs):
   item=current/name;relative=item.relative_to(folder).as_posix()
   if any(relative==prefix or relative.startswith(prefix+'/') for prefix in excluded):dirs.remove(name);continue
   if item.is_symlink():files.append(name);dirs.remove(name)
   elif directories:
    info=item.stat();rows[relative]={'kind':'directory','mode':stat.S_IMODE(info.st_mode),'uid':info.st_uid,'gid':info.st_gid}
  for name in sorted(files):
   item=current/name;relative=item.relative_to(folder).as_posix()
   if any(relative==prefix or relative.startswith(prefix+'/') for prefix in excluded):continue
   info=item.lstat();entry={'mode':stat.S_IMODE(info.st_mode),'uid':info.st_uid,'gid':info.st_gid}
   if stat.S_ISLNK(info.st_mode):entry.update(kind='symlink',target=os.readlink(item))
   elif stat.S_ISREG(info.st_mode):entry.update(kind='file',bytes=info.st_size,sha256=file_hash(item))
   else:raise ValueError('Unexpected special file in owned volume')
   rows[relative]=entry
 return dict(sorted(rows.items()))
excluded=(source_name,destination_name)
before_retained=manifest(root,excluded);before_ge=manifest(source,directories=True)
destination.parent.mkdir(exist_ok=True)
strict('.voltra/proton-quarantine')
os.rename(source,destination)
after_retained=manifest(root,excluded);after_ge=manifest(destination,directories=True)
if before_retained!=after_retained or before_ge!=after_ge:raise ValueError('Post-quarantine preservation proof differs; retain both manifests for review')
print(json.dumps({'moved':True,'source':source_name,'destination':destination_name,'before_retained':before_retained,'after_retained':after_retained,'before_ge':before_ge,'after_ge':after_ge}))`;

function writeReport(state, capture) {
  const previous = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : {};
  const result = {...previous, recipe, lease_id: state.lease.lease_id, server_uuid: state.server.uuid,
    status: capture.power?.current_state === 'offline' ? 'Native start attempted; process now offline, diagnose captured native output' : 'Native diagnostic captured; readiness review remains separate',
    runtime: state.runtime, resources: request,
    repair_install_outcome: state.install_outcome, quarantine_result: state.quarantine,
    native_start_attempted: Boolean(state.start_requested_at),
    native_log: capture.log, sockets: capture.sockets, native_processes: capture.native_processes,
    power: capture.power, container_exit: capture.container_exit, console_logs: capture.console_logs,
    evidence: classifyReadinessEvidence(capture, state.container_started_at, state.lease.ports[0]),
    source: {publisher_setup: 'https://blog.astroneer.space/p/astroneer-dedicated-server-details/', native_log_path: logName},
    five_gates: {install: 'pending', setup: 'pending', console: 'diagnostic only', settings: 'pending', lifecycle: 'pending'},
    native_acceptance: false, player_acceptance: false,
    observations: [...(previous.observations || []), {at: new Date().toISOString(), log: capture.log, power: capture.power, exit: capture.container_exit, evidence: classifyReadinessEvidence(capture, state.container_started_at, state.lease.ports[0])}]};
  fs.writeFileSync(reportFile, JSON.stringify(result, null, 2) + '\n');
  return result;
}

function captureConsole(container, folder) {
  const result = spawnSync('docker', ['--context', 'desktop-linux', 'logs', '--timestamps', '--tail', '5000', container.Id], {windowsHide: true, maxBuffer: 8*1024**2});
  const output = {};
  for (const stream of ['stdout', 'stderr']) {
    const content = result[stream] || Buffer.alloc(0), file = path.join(folder, 'native-console-' + stream + '-' + Date.now() + '.log');
    fs.writeFileSync(file, content, {mode: 0o600});
    output[stream] = {private_path: file, bytes: content.length, sha256: digest(content)};
  }
  return {...output, client_exit_code: result.status, capture_error: result.error?.code || null, tail_limit_lines: 5000};
}

export function selfTest() {
  const lease = {...request, lease_id: '00000000-0000-4000-8000-000000000000', status: 'active', ports: [29150]};
  assertAstroneerLease(lease);
  for (const invalid of [{owner: 'other'}, {game: 'other'}, {memory_mib: 8192}, {disk_mib: 8192}, {status: 'released'}, {ports: [8777]}, {ports: [29150, 29151]}]) assert.throws(() => assertAstroneerLease({...lease, ...invalid}));
  const started = '2026-10-29T12:00:00Z';
  const sample = {log: {exists: true, bytes: 80, mtime_ms: Date.parse(started) + 1000, offset: 0}, sockets: [{protocol: 'udp', port: 29150, native_pids: [100]}]};
  assert.equal(classifyReadinessEvidence(sample, started, 29150).candidate_ready_signal_review_possible, true);
  assert.equal(classifyReadinessEvidence({...sample, sockets: [{protocol: 'udp', port: 29150, native_pids: []}]}, started, 29150).candidate_ready_signal_review_possible, false);
  assert.equal(classifyReadinessEvidence({...sample, log: {...sample.log, mtime_ms: Date.parse(started) - 1}}, started, 29150).candidate_ready_signal_review_possible, false);
  assert.equal(classifyReadinessEvidence({...sample, log: {...sample.log, offset: 1}}, started, 29150).candidate_ready_signal_review_possible, false);
  assert.equal(classifyReadinessEvidence(sample, 'invalid', 29150).fresh_complete_native_log, false);
  assert.equal(classifyReadinessEvidence(sample, started, 29151).independent_native_udp_listener, false);
  assert.equal(classifyReadinessEvidence(sample, started, 29150).gameplay_verified, false);
  const ini = Buffer.from(';keep\r\n[/Script/Astro.AstroServerSettings]\r\nPublicIP =127.0.0.1 ;note\r\nOwnerGuid=0\r\n');
  assert.equal(replaceNativePublicIP(ini, '192.0.2.1').toString(), ini.toString().replace('127.0.0.1', '192.0.2.1'));
  assert.throws(() => replaceNativePublicIP(ini, '1.2.3.4\nInjected=1'));
  assert.throws(() => replaceNativePublicIP(Buffer.concat([ini, Buffer.from('PublicIP=1.1.1.1\n')]), '192.0.2.1'));
  const fixtureCode = `import ast,sys
tree=ast.parse(sys.stdin.read())
functions=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in ('native_command','socket_rows')]
namespace={}
exec(compile(ast.Module(body=functions,type_ignores=[]),'capture-pure-functions','exec'),namespace)
native=namespace['native_command'];sockets=namespace['socket_rows']
assert not native(b'/usr/bin/python3\\0-c\\0mentions astroserver-win64-shipping.exe\\0')
assert not native(b'/usr/bin/python3\\0proton\\0run\\0AstroServer-Win64-Shipping.exe\\0')
assert native(b'wine64\\0Z:\\\\home\\\\container\\\\AstroServer-Win64-Shipping.exe\\0')
assert native(b'/home/container/AstroServer-Win64-Shipping.exe\\0-log\\0')
rows=sockets('header\\n 0: 00000000:71DE 00000000:0000 07 00000000:00000000 00:00000000 00000000 1000 0 12345\\n','udp',{42:{'12345'}})
assert rows[0]['port']==29150 and rows[0]['native_pids']==[42]
assert sockets('header\\n 0: 00000000:71DE 00000000:0000 07 00000000:00000000 00:00000000 00000000 1000 0 12345\\n','udp',{42:{'other'}})[0]['native_pids']==[]
print('six-pure-capture-fixtures-passed')`;
  const syntax = spawnSync('python', ['-B', '-c', fixtureCode], {input: capturePython, encoding: 'utf8', windowsHide: true});
  assert.equal(syntax.status, 0, syntax.stderr);
  return {assertions: 18, capture_script_syntax: 'passed; six pure process/socket fixtures executed without native capture I/O', runtime_mutations: 0, native_games_started: 0};
}

function cacheCandidates() {
  const folders = ['.local/space-survival', '.local/game-parity-20261029/astroneer-cache'];
  const candidates = [];
  for (const folder of folders) {
    const absolute = path.join(root, folder);
    if (!fs.existsSync(absolute)) continue;
    for (const name of fs.readdirSync(absolute)) {
      const file = path.join(absolute, name);
      if (/astroneer|728470/i.test(name) && /\.(zip|tar|gz|xz|7z)$/i.test(name) && fs.lstatSync(file).isFile()) candidates.push({path: folder + '/' + name, bytes: fs.statSync(file).size});
    }
  }
  return {folders_inspected: folders, candidates, verified_payload_available: false, note: 'Names/size alone do not prove payload identity. No cache is copied without root-reviewed manifest/hash.'};
}

export async function main(args) {
  const [command = 'plan', id, input] = args;
  if (command === 'plan') return {request, required_operator_fields: ['PUBLIC_IP', 'OWNER_NAME', 'OWNER_GUID'],
    acquisition: 'Coordinator lease/installer handoff required; app728470 Windows dedicated payload, pinned shared Proton. No licence, account or publisher agreement fabricated.',
    evidence: 'Fresh complete Astro.log plus allocated UDP socket associated with native AstroServer process; manually review actual native event before selecting marker.',
    cache: cacheCandidates(),
    commands: ['self-test', 'claim', 'create LEASE PRIVATE_INPUT_JSON', 'inspect-installer LEASE', 'start LEASE', 'capture LEASE', 'capture-offline LEASE', 'stop LEASE'],
    installer_gate: 'Coordinator must attach durable Docker wait/log capture and use shared releaseGate after live hard-limit proof. This harness deliberately does not release a gate or installer slot.',
    cleanup: 'Root/coordinator uses shared campaign ownership cleanup after diagnostic. Harness never releases a lease or deletes resources.'};
  if (command === 'self-test') return selfTest();
  if (command === 'claim') {
    await verifyRuntime();
    const lease = assertAstroneerLease(claimNative(request));
    fs.mkdirSync(base, {recursive: true});
    fs.writeFileSync(path.join(base, 'lease-' + lease.lease_id + '.json'), JSON.stringify(lease, null, 2) + '\n', {mode: 0o600});
    return {lease, fixture_created: false, acquisition_started: false};
  }
  if (command === 'installer-acquire') {
    await context(id, {existing: false});
    const slot = acquireInstaller(id, owner), inputFile = path.join(path.dirname(statePath(id)), 'input.json');
    fs.mkdirSync(path.dirname(inputFile), {recursive: true});
    fs.writeFileSync(inputFile, JSON.stringify({slot, environment: {PUBLIC_IP: '127.0.0.1', OWNER_NAME: 'ParityAstroneer', OWNER_GUID: '0', SERVER_PWD: '', AUTO_UPDATE: '0', VOLTRA_STEAM_AUTO_UPDATE: '0'}}, null, 2) + '\n', {mode: 0o600});
    return {lease_id: id, input_file: inputFile, installer_slot_acquired: true};
  }
  if (command === 'adopt-snapshot') {
    const queue = JSON.parse(fs.readFileSync(path.join(runtime, 'queue.json')));
    if (queue.activation_pause) throw Error('Coordinator activation pause remains active');
    assertAstroneerLease(activeLease(id, owner, queue));
    const receipt = await verifyRuntime();
    if (receipt.binary_sha256 !== input || !/^[a-f0-9]{64}$/.test(input || '')) throw Error('Exact root-approved new binary hash required');
    const state = JSON.parse(fs.readFileSync(statePath(id)));
    if (state.lease.lease_id !== id || state.server.uuid !== approvedFixture.uuid) throw Error('Wrong stored owned fixture');
    const proof = await assertFailedFixture(state), profile = profileFromRuntime(recipe, receipt);
    const script = profile.egg.scripts.installation.script;
    if (!/^apt-get install .*\blibvulkan1\b/m.test(script) || !script.includes('Astroneer installer requires libvulkan1 before acquisition') || !script.includes('GE-Proton provisioning requires installer package libvulkan1')) throw Error('New frozen dependency repair absent');
    state.runtime_history ??= []; state.runtime_history.push(state.runtime); state.runtime = receipt;
    state.root_resume_proof = {...proof, adopted_at: new Date().toISOString(), binary_sha256: receipt.binary_sha256}; save(state);
    return state.root_resume_proof;
  }
  if (!['create', 'public-ip-prepare', 'public-ip-run', 'public-ip-restore', 'diagnostic-ids', 'diagnostic-trace', 'diagnostic-no-log', 'diagnostic-bin-cwd', 'diagnostic-with-log', 'restore-startup', 'reinstall-repair', 'inspect-installer', 'installer-logs', 'installer-wait', 'release-gate', 'installer-release', 'install-status', 'diagnose-files', 'runtime-metadata', 'collect-native-logs', 'quarantine-partial-ge', 'start', 'capture', 'capture-offline', 'stop'].includes(command)) throw Error('Unknown bounded Astroneer diagnostic action');
  const {lease, receipt, state} = await context(id, {existing: command !== 'create'});
  if (command === 'create') {
    if (fs.existsSync(statePath(id))) throw Error('Owned state already exists; inspect before retry');
    const options = readPrivateJSON(input);
    const slot = options.slot;
    if (slot?.lease_id !== id || slot.owner !== owner) throw Error('Coordinator installer slot required');
    const env = options.environment || {};
    for (const key of ['PUBLIC_IP', 'OWNER_NAME', 'OWNER_GUID']) if (typeof env[key] !== 'string' || !env[key]) throw Error('Explicit operator test field required: ' + key);
    if (Object.keys(env).some(key => /STEAM_(USER|PASS|AUTH)|LICENSE|SERIAL|DLC_PRODUCT_KEY/.test(key))) throw Error('Private acquisition prerequisites require root secret handling');
    const profile = profileFromRuntime(recipe, receipt);
    if (profile.agreements?.length) throw Error('Publisher consent must be resolved by root');
    state.slot = slot;
    save(state);
    await createNativeFixture({lease, slot, profile, environment: {...env, AUTO_UPDATE: '0', VOLTRA_STEAM_AUTO_UPDATE: '0'}, name: 'Campaign Astroneer readiness', onStep: async partial => {Object.assign(state, partial); save(state);}});
    return {prepared: true, lease_id: id, server_uuid: state.server.uuid, installer_gate_released: false};
  }
  if (!state.server) throw Error('No owned server recorded');
  if (command === 'public-ip-prepare' || command === 'public-ip-restore') {
    const server = (await api('/api/application/servers/' + state.server.id)).attributes, profile = profileFromRuntime(recipe, receipt);
    if (server.uuid !== approvedFixture.uuid || server.node !== 1 || server.egg !== 30 || server.container.startup_command !== profile.egg.startup || (await observePower(state)).current_state !== 'offline') throw Error('Canonical exact owned offline fixture required');
    if (command === 'public-ip-prepare') {
      if (state.public_ip_probe) throw Error('Only one root-approved valid PublicIP trial; existing receipt requires review');
      const original = await nativeINI(state), folder = path.dirname(statePath(id)), backup = path.join(folder, 'public-ip-original.ini');
      fs.writeFileSync(backup, original, {mode: 0o600});
      const lookupCode = "import urllib.request,ipaddress,json,datetime\naddress=urllib.request.urlopen('https://api4.ipify.org',timeout=15).read(64).decode('ascii').strip()\nparsed=ipaddress.IPv4Address(address)\nassert parsed.is_global\nprint(json.dumps({'address':str(parsed),'url':'https://api4.ipify.org','at':datetime.datetime.now(datetime.timezone.utc).isoformat()}))";
      const lookup = JSON.parse(docker(['run', '--rm', '--pull', 'never', '--network', 'voltra-parity-20261029', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '128m', '--memory-swap', '128m', '--cpus', '1', '--pids-limit', '64', 'sha256:27b7c9d4f13ca20bb1170148f02095d50a5dfce1f7f2dabf5ca273727e43b7ea', 'python3', '-B', '-c', lookupCode]));
      const lookupFile = path.join(folder, 'public-ip-lookup.json'); fs.writeFileSync(lookupFile, JSON.stringify(lookup, null, 2), {mode: 0o600});
      const updated = replaceNativePublicIP(original, lookup.address);
      state.public_ip_probe = {approved_trials: 1, lookup_private_path: lookupFile, original_private_path: backup, original_sha256: digest(original), modified_sha256: digest(updated), startup_kept: profile.egg.startup, prepared_at: new Date().toISOString(), deadline_seconds: 58}; save(state);
      await writeNativeINI(state, updated);
      if (digest(await nativeINI(state)) !== digest(updated)) throw Error('Modified native PublicIP readback mismatch');
      return {prepared: true, private_address_recorded: true, only_native_public_ip_changed: true, original_sha256: digest(original), modified_sha256: digest(updated)};
    }
    if (!state.public_ip_probe) throw Error('No owned PublicIP backup receipt');
    const original = fs.readFileSync(state.public_ip_probe.original_private_path);
    if (digest(original) !== state.public_ip_probe.original_sha256) throw Error('Original INI backup hash differs');
    await writeNativeINI(state, original);
    if (digest(await nativeINI(state)) !== state.public_ip_probe.original_sha256) throw Error('Exact native INI restoration failed');
    state.public_ip_probe.restored_at = new Date().toISOString(); save(state);
    return {original_ini_exactly_restored: true, canonical_startup_unchanged: true};
  }
  if (command === 'public-ip-run') {
    if (!state.public_ip_probe || state.public_ip_probe.started_at) throw Error('Exactly one prepared PublicIP trial required');
    const server = (await api('/api/application/servers/' + state.server.id)).attributes;
    if (server.uuid !== approvedFixture.uuid || server.node !== 1 || server.egg !== 30 || server.container.startup_command !== state.public_ip_probe.startup_kept || (await observePower(state)).current_state !== 'offline' || digest(await nativeINI(state)) !== state.public_ip_probe.modified_sha256) throw Error('Prepared canonical isolated PublicIP state differs');
    const started = Date.now(), observed = [];
    state.start_requested_at = new Date(started).toISOString(); state.public_ip_probe.started_at = state.start_requested_at; save(state);
    const p = '/api/client/servers/' + state.server.uuid + '/power';
    let stopRequested = false, killed = false;
    const stopTimer = setTimeout(() => {stopRequested = true; api(p, 'POST', {signal: 'stop'}).catch(() => {});}, 50000);
    const killTimer = setTimeout(() => {killed = true; api(p, 'POST', {signal: 'kill'}).catch(() => {});}, 58000);
    try {
      await api(p, 'POST', {signal: 'start'}); console.log(JSON.stringify({public_ip_trial_started: true, deadline_seconds: 58}));
      while (Date.now() - started < 59000) {
        const sample = await observePower(state); observed.push(sample);
        if (sample.current_state === 'offline' && Date.now() - started > 3000) break;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    } finally {
      clearTimeout(stopTimer); clearTimeout(killTimer);
      const final = await observePower(state); observed.push(final);
      if (final.current_state !== 'offline') {killed = true; await api(p, 'POST', {signal: 'kill'});}
      const outcome = {started_at: new Date(started).toISOString(), completed_at: new Date().toISOString(), elapsed_ms: Date.now() - started, stop_requested: stopRequested, forced_kill_requested: killed, samples: observed};
      fs.writeFileSync(path.join(path.dirname(statePath(id)), 'public-ip-run-outcome.json'), JSON.stringify(outcome, null, 2), {mode: 0o600});
      const latest = JSON.parse(fs.readFileSync(statePath(id))); latest.public_ip_probe.outcome = outcome; save(latest);
    }
    return {public_ip_trial_terminal: true, observed_ms: Date.now() - started, stop_requested: stopRequested, forced_kill_requested: killed};
  }
  if (command === 'diagnostic-ids' || command === 'diagnostic-trace' || command === 'diagnostic-no-log' || command === 'diagnostic-bin-cwd' || command === 'diagnostic-with-log' || command === 'restore-startup') {
    const server = (await api('/api/application/servers/' + state.server.id)).attributes;
    if (server.uuid !== approvedFixture.uuid || server.id !== approvedFixture.id || server.node !== 1 || server.egg !== 30 || server.container?.installed !== 1 || (await observePower(state)).current_state !== 'offline') throw Error('Exact owned installed/offline fixture required');
    if (command === 'diagnostic-ids') {
      if (state.diagnostic_startup && !state.diagnostic_restored_at) throw Error('Diagnostic startup already pending; inspect existing receipt');
      const profile = profileFromRuntime(recipe, receipt);
      if (server.container.startup_command !== profile.egg.startup) throw Error('Unexpected startup override already present');
      const startup = profile.egg.startup.replace('exec python3 ', 'exec env SteamGameId=728470 SteamAppId=728470 python3 ');
      if (startup === profile.egg.startup) throw Error('Exact diagnostic startup transform failed');
      state.diagnostic_startup = {original: profile.egg.startup, startup, purpose: 'Enable pinned Proton own diagnostic log; fixture-only runtime variant', requested_at: new Date().toISOString()}; delete state.diagnostic_restored_at; save(state);
      await api('/api/application/servers/' + state.server.id + '/startup', 'PATCH', {startup});
      return {diagnostic_startup_installed: true, canonical_recipe_changed: false};
    }
    if (!state.diagnostic_startup || server.container.startup_command !== state.diagnostic_startup.startup) throw Error('Exact owned diagnostic startup required before update/restore');
    if (command === 'diagnostic-with-log') {
      if (!state.diagnostic_startup.startup.includes(' env -C /home/container/Astro/Binaries/Win64 ') || state.diagnostic_startup.startup.endsWith(' -log')) throw Error('Exact binary-CWD no-log diagnostic required');
      const startup = state.diagnostic_startup.startup + ' -log';
      state.diagnostic_startup.variants ??= []; state.diagnostic_startup.variants.push({startup: state.diagnostic_startup.startup, replaced_at: new Date().toISOString()}); state.diagnostic_startup.startup = startup; save(state);
      await api('/api/application/servers/' + state.server.id + '/startup', 'PATCH', {startup}); return {canonical_log_flag_restored_in_diagnostic: true};
    }
    if (command === 'diagnostic-bin-cwd') {
      const startup = state.diagnostic_startup.startup.replace(' env -u PYTHONHOME ', ' env -C /home/container/Astro/Binaries/Win64 -u PYTHONHOME ');
      if (startup === state.diagnostic_startup.startup) throw Error('Exact root-CWD diagnostic required');
      state.diagnostic_startup.variants ??= []; state.diagnostic_startup.variants.push({startup: state.diagnostic_startup.startup, replaced_at: new Date().toISOString()}); state.diagnostic_startup.startup = startup; save(state);
      await api('/api/application/servers/' + state.server.id + '/startup', 'PATCH', {startup});
      return {diagnostic_binary_cwd_installed: true, other_conditions_unchanged: true};
    }
    if (command === 'diagnostic-no-log') {
      if (!state.diagnostic_startup.startup.endsWith(' -log')) throw Error('Exact log-enabled diagnostic required');
      const startup = state.diagnostic_startup.startup.slice(0, -5);
      state.diagnostic_startup.variants ??= []; state.diagnostic_startup.variants.push({startup: state.diagnostic_startup.startup, replaced_at: new Date().toISOString()}); state.diagnostic_startup.startup = startup; save(state);
      await api('/api/application/servers/' + state.server.id + '/startup', 'PATCH', {startup});
      return {diagnostic_log_flag_removed: true, reason: 'Match pinned upstream direct Proton argv; preserve all other trace conditions'};
    }
    if (command === 'diagnostic-trace') {
      const startup = 'exec timeout --signal=TERM --kill-after=10s 90s env -u PYTHONHOME -u PYTHONPATH -u LD_PRELOAD -u WINEPREFIX -u STEAM_USER -u STEAM_PASS -u STEAM_AUTH -u SRCDS_BETAPASS HOME=/home/container SteamGameId=728470 SteamAppId=728470 WINEDEBUG=+timestamp,+seh,+debugstr,+loaddll PROTON_LOG=1 PROTON_LOG_DIR=/home/container STEAM_COMPAT_CLIENT_INSTALL_PATH=/home/container/.steam/steam STEAM_COMPAT_DATA_PATH=/home/container/.steam/steam/steamapps/compatdata/728470 LD_LIBRARY_PATH=/home/container/.voltra/proton/lib:/home/container/.steam/sdk64 /home/container/.voltra/proton/GE-Proton11-9/proton run /home/container/Astro/Binaries/Win64/AstroServer-Win64-Shipping.exe -log';
      state.diagnostic_startup.variants ??= []; state.diagnostic_startup.variants.push({startup: state.diagnostic_startup.startup, replaced_at: new Date().toISOString()}); state.diagnostic_startup.startup = startup; state.diagnostic_startup.trace_deadline_seconds = 90; save(state);
      await api('/api/application/servers/' + state.server.id + '/startup', 'PATCH', {startup});
      return {diagnostic_trace_installed: true, canonical_recipe_changed: false, bounded_seconds: 90};
    }
    await api('/api/application/servers/' + state.server.id + '/startup', 'PATCH', {startup: state.diagnostic_startup.original});
    state.diagnostic_restored_at = new Date().toISOString(); save(state); return {canonical_startup_restored: true};
  }
  if (command === 'runtime-metadata') {
    const actual = containers().find(container => container.Name === '/' + state.server.uuid);
    if (!actual) throw Error('Owned native container required');
    const nativeUser = JSON.parse(docker(['inspect', '--format', '{{json .Config.User}}', actual.Id]));
    if (!/^\d+:\d+$/.test(nativeUser)) throw Error('Numeric owned UID/GID required');
    const config = JSON.parse(fs.readFileSync(path.join(runtime, 'wings-private.json'))), volume = path.posix.join(config.system.data, state.server.uuid);
    if (!volume.startsWith('/var/lib/voltra-parity-20261029/volumes/')) throw Error('Campaign volume required');
    const code = `import pathlib,json,re,hashlib
root=pathlib.Path('/server');result={'appids':{},'root_executables':[],'proton_source':[]}
config=root/'Astro/Config/BinaryConfig.ini'
result['binary_config']={'exists':config.is_file(),'relative_lookup_from_root_confined':(root/'../../../Astro/Config/BinaryConfig.ini').resolve().is_relative_to(root),'relative_lookup_from_binary_dir_exists':(root/'Astro/Binaries/Win64/../../../Astro/Config/BinaryConfig.ini').is_file()}
if config.is_file():result['binary_config']['sha256']=hashlib.sha256(config.read_bytes()).hexdigest()
for name in ['steam_appid.txt','Astro/steam_appid.txt','Astro/Binaries/Win64/steam_appid.txt']:
 file=root/name
 if file.is_file() and not file.is_symlink():
  value=file.read_text().strip();result['appids'][name]=value if re.fullmatch(r'[0-9]{1,10}',value) else 'noncanonical-content-not-exposed'
for file in sorted(root.glob('*.exe')):result['root_executables'].append({'name':file.name,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
file=root/'.voltra/proton/GE-Proton11-9/proton'
for index,line in enumerate(file.read_text().splitlines(),1):
 if any(key in line for key in ['SteamGameId','SteamAppId','PROTON_LOG','log_file']):result['proton_source'].append({'line':index,'text':line})
print(json.dumps(result))`;
    const result = JSON.parse(docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', nativeUser, '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--pids-limit', '64', '--mount', `type=bind,source=${volume},target=/server,readonly`, 'sha256:27b7c9d4f13ca20bb1170148f02095d50a5dfce1f7f2dabf5ca273727e43b7ea', 'python3', '-B', '-c', code]));
    state.runtime_metadata = result; save(state); return result;
  }
  if (command === 'collect-native-logs') {
    const actual = containers().find(container => container.Name === '/' + state.server.uuid);
    if (!actual) throw Error('Exact owned native container required');
    const nativeUser = JSON.parse(docker(['inspect', '--format', '{{json .Config.User}}', actual.Id]));
    if (!/^\d+:\d+$/.test(nativeUser)) throw Error('Exact owned native numeric UID/GID required');
    const privateConfig = JSON.parse(fs.readFileSync(path.join(runtime, 'wings-private.json'))), volume = path.posix.join(privateConfig.system.data, state.server.uuid);
    if (!volume.startsWith('/var/lib/voltra-parity-20261029/volumes/')) throw Error('Campaign volume required');
    const code = `import pathlib,json,base64
root=pathlib.Path('/server');candidates=set(root.glob('*.log'))
for folder in [root/'Astro',root/'.steam/steam/steamapps/compatdata/728470/pfx/drive_c/users']:
 if folder.is_dir():candidates.update(folder.rglob('*.log'))
result=[];total=0
for file in sorted(candidates):
 if file.is_symlink() or not file.resolve().is_relative_to(root) or not file.is_file():continue
 if len(result)>=50:raise ValueError('Native log count limit exceeded')
 info=file.stat();maximum=4*1024*1024
 with file.open('rb') as stream:data=stream.read(maximum+1)
 if len(data)>maximum:raise ValueError('Native diagnostic log exceeds limit')
 total+=len(data)
 if total>16*1024*1024:raise ValueError('Total diagnostic capture exceeds limit')
 result.append({'source':file.relative_to(root).as_posix(),'bytes':len(data),'mtime_ms':info.st_mtime_ns//1000000,'content_base64':base64.b64encode(data).decode('ascii')})
print(json.dumps(result))`;
    const captured = JSON.parse(actual.State.Running ? docker(['exec', actual.Id, '/usr/bin/python3', '-B', '-c', code.replace("pathlib.Path('/server')", "pathlib.Path('/home/container')")]) : docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', nativeUser, '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--pids-limit', '64', '--mount', `type=bind,source=${volume},target=/server,readonly`, 'sha256:27b7c9d4f13ca20bb1170148f02095d50a5dfce1f7f2dabf5ca273727e43b7ea', 'python3', '-B', '-c', code]));
    const stamp = Date.now();
    for (const [index, log] of captured.entries()) {
      const content = Buffer.from(log.content_base64, 'base64'), target = path.join(path.dirname(statePath(id)), `native-alternate-${stamp}-${index}.log`);
      fs.writeFileSync(target, content, {mode: 0o600}); delete log.content_base64; log.private_path = target; log.sha256 = digest(content);
    }
    state.alternate_logs = captured; save(state);
    const report = JSON.parse(fs.readFileSync(reportFile)); report.alternate_native_logs = captured; fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    return {captured, game_state: actual.State.Status, native_uid_gid: nativeUser};
  }
  if (command === 'reinstall-repair') {
    await assertFailedFixture(state);
    if (!state.quarantine?.moved || !state.quarantine.retained_manifest_equal || !state.quarantine.ge_manifest_equal) throw Error('Root-approved exact GE quarantine proof required');
    const options = readPrivateJSON(input), slot = options.slot;
    const queue = JSON.parse(fs.readFileSync(path.join(runtime, 'queue.json')));
    if (slot?.lease_id !== id || slot.owner !== owner || slot.token !== queue.installer_slot?.token || queue.installer_slot.owner !== owner) throw Error('Fresh owned installer slot required');
    const profile = profileFromRuntime(recipe, receipt);
    const oldEgg = (await api('/api/admin/eggs/' + approvedFixture.egg)).attributes;
    state.installer_history ??= []; state.installer_history.push({slot: state.slot, proof: state.installer_proof, outcome: state.install_outcome, capture_folder: attemptFolder(state)});
    state.slot = slot; state.installer_attempt = 'repair-' + slot.token;
    fs.writeFileSync(path.join(attemptFolder(state), 'egg-before.json'), JSON.stringify(oldEgg, null, 2), {mode: 0o600}); save(state);
    const script = installerGate(profile.egg.scripts.installation.script, slot.token);
    if (!/^apt-get install .*\blibvulkan1\b/m.test(script)) throw Error('Repaired installer dependency absent');
    await api('/api/admin/eggs/' + approvedFixture.egg, 'PATCH', {script_install: script, script_entry: profile.egg.scripts.installation.entrypoint, script_container: profile.egg.scripts.installation.container, startup: profile.egg.startup});
    state.repair_egg_updated_at = new Date().toISOString(); state.repair_installer_sha256 = digest(script); save(state);
    await api('/api/application/servers/' + approvedFixture.id + '/reinstall', 'POST');
    state.reinstall_requested_at = new Date().toISOString(); save(state);
    return {reinstall_requested: true, server_uuid: state.server.uuid, owned_egg: approvedFixture.egg, attempt: state.installer_attempt};
  }
  if (command === 'quarantine-partial-ge') {
    if (state.quarantine?.moved) throw Error('Approved quarantine already recorded; inspect receipt before any repeat');
    const proof = await assertFailedFixture(state);
    const privateConfig = JSON.parse(fs.readFileSync(path.join(runtime, 'wings-private.json')));
    if (privateConfig.system.data !== '/var/lib/voltra-parity-20261029/volumes') throw Error('Root-approved data root differs');
    const volume = privateConfig.system.data + '/' + approvedFixture.uuid;
    const result = JSON.parse(docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--pids-limit', '64', '--mount', `type=bind,source=${privateConfig.system.data},target=/volumes,readonly`, '--mount', `type=bind,source=${volume},target=/server`, 'sha256:27b7c9d4f13ca20bb1170148f02095d50a5dfce1f7f2dabf5ca273727e43b7ea', 'python3', '-B', '-c', quarantinePython]));
    const manifests = {};
    for (const name of ['before_retained', 'after_retained', 'before_ge', 'after_ge']) {
      const content = JSON.stringify(result[name], null, 2) + '\n', file = path.join(path.dirname(statePath(id)), 'quarantine-' + name + '.json');
      fs.writeFileSync(file, content, {mode: 0o600}); manifests[name] = {private_path: file, sha256: digest(content), entries: Object.keys(result[name]).length}; delete result[name];
    }
    state.quarantine = {...result, manifests, absence_active_proof: proof, at: new Date().toISOString(), retained_manifest_equal: manifests.before_retained.sha256 === manifests.after_retained.sha256, ge_manifest_equal: manifests.before_ge.sha256 === manifests.after_ge.sha256}; save(state);
    return state.quarantine;
  }
  if (command === 'diagnose-files') {
    const privateConfig = JSON.parse(fs.readFileSync(path.join(runtime, 'wings-private.json')));
    const volume = path.posix.join(privateConfig.system.data, state.server.uuid);
    if (!volume.startsWith('/var/lib/voltra-parity-20261029/') || !volume.endsWith('/' + state.server.uuid)) throw Error('Exact owned campaign volume required');
    const code = `import pathlib,json,hashlib
root=pathlib.Path('/server')
names=['.voltra/proton/GE-Proton11-9/proton','.voltra/proton/GE-Proton11-9/files/lib/wine/x86_64-unix/lsteamclient.so','.voltra/proton/lib/libvulkan.so.1','.voltra/proton/release.json','.steam/sdk64/steamclient.so','Astro/Binaries/Win64/AstroServer-Win64-Shipping.exe','Astro/Saved/Config/WindowsServer/Engine.ini','Astro/Saved/Config/WindowsServer/AstroServerSettings.ini']
result={'volume_owner':{'uid':root.stat().st_uid,'gid':root.stat().st_gid},'proton_parent_owner':{'uid':(root/'.voltra/proton').stat().st_uid,'gid':(root/'.voltra/proton').stat().st_gid}}
for name in names:
 p=root/name
 result[name]={'exists':p.exists(),'regular_file':p.is_file()}
 if p.is_file():
  data=p.read_bytes();result[name].update(bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
  if name.endswith('steamclient.so'):result[name]['steamutils011']=b'SteamUtils011' in data
print(json.dumps(result))`;
    const result = JSON.parse(docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--pids-limit', '64', '--mount', `type=bind,source=${volume},target=/server,readonly`, 'sha256:27b7c9d4f13ca20bb1170148f02095d50a5dfce1f7f2dabf5ca273727e43b7ea', 'python3', '-B', '-c', code]));
    state.file_diagnosis = {at: new Date().toISOString(), files: result}; save(state);
    return state.file_diagnosis;
  }
  if (command === 'installer-release') { releaseInstaller(state.slot); state.slot_released_at = new Date().toISOString(); save(state); return {released: true}; }
  if (command === 'install-status') {
    const status = (await api('/api/application/servers/' + state.server.id)).attributes;
    state.install_outcome = {at: new Date().toISOString(), status: status.status, installed: status.container?.installed}; save(state);
    return state.install_outcome;
  }
  if (command === 'installer-logs' || command === 'installer-wait') {
    if (!state.installer_proof?.id) throw Error('Installer proof required before attachment');
    const kind = command === 'installer-logs' ? 'logs' : 'wait', folder = attemptFolder(state);
    const output = path.join(folder, 'installer-' + kind + '.log'), fd = fs.openSync(output, 'w', 0o600);
    const child = spawn('docker', ['--context', 'desktop-linux', ...(kind === 'logs' ? ['logs', '--follow', '--timestamps'] : ['wait']), state.installer_proof.id], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    const attachment = {kind, container_id: state.installer_proof.id, pid: child.pid, output, attached_at: new Date().toISOString()};
    const receiptFile = path.join(folder, 'installer-' + kind + '-attachment.json');
    let marker = '', bytes = 0;
    child.on('spawn', () => { if (kind === 'wait') { fs.writeFileSync(receiptFile, JSON.stringify(attachment), {mode: 0o600}); console.log(JSON.stringify({attached: kind, pid: child.pid})); } });
    const receive = chunk => { fs.writeSync(fd, chunk); bytes += chunk.length; if (kind === 'logs' && !attachment.resource_gate_seen) {marker += chunk.toString('utf8'); if (marker.includes('CAMPAIGN_RESOURCE_GATE')) {attachment.resource_gate_seen = true; fs.writeFileSync(receiptFile, JSON.stringify(attachment), {mode: 0o600}); console.log(JSON.stringify({attached: kind, pid: child.pid, resource_gate_seen: true}));} marker = marker.slice(-4096);} };
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    return await new Promise((resolve, reject) => {child.on('error', error => {fs.closeSync(fd); reject(error);}); child.on('close', code => {fs.closeSync(fd); fs.writeFileSync(receiptFile, JSON.stringify({...attachment, client_exit_code: code, completed_at: new Date().toISOString(), bytes}), {mode: 0o600}); resolve({kind, client_exit_code: code, bytes, private_output: output});});});
  }
  const all = containers();
  const installer = all.find(container => container.Name.includes(state.server.uuid) && container.Name.includes('installer') && container.State.Running);
  if (command === 'inspect-installer') {
    const actual = installer || (await waitNativeInstaller(state)).container;
    const proof = proveInstaller(actual, lease);
    state.installer_proof = proof;
    save(state);
    return {proof, gate_released: false};
  }
  if (command === 'release-gate') {
    if (!installer) throw Error('Owned live gated installer not found');
    for (const kind of ['logs', 'wait']) {
      const attached = JSON.parse(fs.readFileSync(path.join(attemptFolder(state), 'installer-' + kind + '-attachment.json')));
      if (attached.container_id !== installer.Id || attached.completed_at || !Number.isInteger(attached.pid) || kind === 'logs' && !attached.resource_gate_seen) throw Error('Actual live capture attachment required: ' + kind);
      process.kill(attached.pid, 0);
    }
    releaseGate(installer, lease, state.slot.token); state.gate_released_at = new Date().toISOString(); save(state);
    return {gate_released: true, installer_id: installer.Id};
  }
  if (command === 'start') {
    if (installer) throw Error('Installer still active');
    const status = (await api('/api/application/servers/' + state.server.id)).attributes;
    if (status.uuid !== state.server.uuid || status.status === 'install_failed' || status.container?.installed !== 1) throw Error('Owned installer has not succeeded');
    const power = await observePower(state);
    if (power.current_state !== 'offline') throw Error('Native fixture must be offline before start');
    state.start_requested_at = new Date().toISOString(); save(state);
    await api('/api/client/servers/' + state.server.uuid + '/power', 'POST', {signal: 'start'});
    return {requested: 'start', at: state.start_requested_at};
  }
  if (command === 'stop') {
    await api('/api/client/servers/' + state.server.uuid + '/power', 'POST', {signal: 'stop'});
    state.stop_requested_at = new Date().toISOString(); save(state);
    return {requested: 'stop', clean_exit_or_save_verified: false};
  }
  if (command === 'capture-offline') {
    const power = await observePower(state);
    if (power.current_state !== 'offline') throw Error('Offline diagnostic capture requires actual offline state');
    const response = await fetch('http://127.0.0.1:18099/api/client/servers/' + state.server.uuid + '/files/contents?file=' + encodeURIComponent('/Astro/Saved/Logs/Astro.log'));
    const capture = {log: {exists: false}, sockets: [], native_processes: [], power};
    if (response.ok) {
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 8*1024**2) throw Error('Offline native log exceeds private capture limit'); chunks.push(chunk); }
      const content = Buffer.concat(chunks), privateLog = path.join(path.dirname(statePath(id)), 'Astro.offline.capture.log');
      fs.writeFileSync(privateLog, content, {mode: 0o600});
      capture.log = {exists: true, bytes, sha256: digest(content), private_path: privateLog, freshness: 'offline API capture has no inode/mtime proof'};
    } else if (response.status !== 404) capture.log = {exists: null, api_error_status: response.status, freshness: 'not established'};
    const stopped = all.find(item => item.Name === '/' + state.server.uuid);
    if (stopped) {capture.container_exit = {id: stopped.Id, running: stopped.State.Running, exit_code: stopped.State.ExitCode, oom_killed: stopped.State.OOMKilled, finished_at: stopped.State.FinishedAt}; capture.console_logs = captureConsole(stopped, path.dirname(statePath(id)));}
    state.capture = capture; save(state);
    const report = writeReport(state, capture);
    return {lease_id: id, offline_diagnostic: true, evidence: report.evidence, report: reportFile};
  }
  const container = all.find(item => item.Name === '/' + state.server.uuid && item.State.Running);
  if (!container || !state.start_requested_at || Date.parse(container.State.StartedAt) < Date.parse(state.start_requested_at) - 1000) throw Error('Fresh owned running game container required');
  const capture = JSON.parse(docker(['exec', container.Id, '/usr/bin/python3', '-B', '-c', capturePython]));
  capture.console_logs = captureConsole(container, path.dirname(statePath(id)));
  state.container_started_at = container.State.StartedAt;
  const privateLog = path.join(path.dirname(statePath(id)), 'Astro.capture.log');
  if (capture.log.exists) {
    const content = Buffer.from(capture.log.content_base64, 'base64');
    fs.writeFileSync(privateLog, content, {mode: 0o600});
    delete capture.log.content_base64;
    capture.log.sha256 = digest(content);
    capture.log.private_path = privateLog;
  }
  state.capture = capture; save(state);
  const report = writeReport(state, capture);
  return {lease_id: id, server_uuid: state.server.uuid, evidence: report.evidence, log_sha256: capture.log.sha256, report: reportFile};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2));
