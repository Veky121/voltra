import dgram from 'node:dgram';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {campaign as h,receipt,docker} from './campaign-session.mjs';
import {native,logs,wait} from './campaign-adapter.mjs';
export {verifyBuild} from './game-checks.mjs';
// Historical evidence: artifacts/l4d-live-acceptance.json and l4d2-live-acceptance.json.
// Current helpers differ: every native assertion below requires fresh execution.
export const registration={"l4d":{"recipe":"left4dead/egg-left4dead.json","ports":1,"environment":{"SRCDS_APPID":"222840","SRCDS_MAP":"l4d_hospital01_apartment","AUTO_UPDATE":"0","HOSTNAME":"Validator L4D","SERVER_PASSWORD":"","RCON_PASSWORD":"validator-l4d-local-only","PUBLIC_SERVER":"0","SRCDS_CPORT":"0","SRCDS_BETAID":"","SRCDS_BETAPASS":"","STEAM_GSLT":"","GAMEMODE":"coop","CUSTOM_GAMEMODE":"","DIFFICULTY":"Normal","LOBBY_ONLY":"0"}},"l4d2":{"recipe":"left4dead_2/egg-left4dead_2.json","ports":1,"environment":{"SRCDS_APPID":"222860","SRCDS_MAP":"c1m1_hotel","AUTO_UPDATE":"0","HOSTNAME":"Validator L4D2","SERVER_PASSWORD":"","RCON_PASSWORD":"validator-l4d2-local-only","PUBLIC_SERVER":"0","SRCDS_CPORT":"0","SRCDS_BETAID":"","SRCDS_BETAPASS":"","STEAM_GSLT":"","GAMEMODE":"coop","CUSTOM_GAMEMODE":"","DIFFICULTY":"Normal","LOBBY_ONLY":"0"}}};
const pins={"l4d":{".voltra/steam_template.py":"7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",".voltra/source_install.py":"a1f63dd97984ed20dba5b5af6fddfaff5efdd15f7666231b32728da0c5f54a13",".voltra/bundle_debian_python.py":"16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",".voltra/native_console.py":"e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",".voltra/source_runtime.py":"f04a64a44b49a03ad45af79d61698b413b27c0ee999081696024085944633752",".voltra/source_variant_runtime.py":"6a22ec1d61167233f22be3332d409369bc3f0119e0308f6a89482cbeb6c200b3",".voltra/source_l4d.py":"1a14d6063b26d3da4751cacab14319ef43a8250ab1fecb71ead3a87f408d498c"},"l4d2":{".voltra/steam_template.py":"7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",".voltra/source_install.py":"a1f63dd97984ed20dba5b5af6fddfaff5efdd15f7666231b32728da0c5f54a13",".voltra/bundle_debian_python.py":"16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",".voltra/native_console.py":"e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",".voltra/source_runtime.py":"f04a64a44b49a03ad45af79d61698b413b27c0ee999081696024085944633752",".voltra/source_variant_runtime.py":"6a22ec1d61167233f22be3332d409369bc3f0119e0308f6a89482cbeb6c200b3",".voltra/source_l4d.py":"1a14d6063b26d3da4751cacab14319ef43a8250ab1fecb71ead3a87f408d498c"}};
export const budgets={memoryMiB:1536,diskMiB:16000,startupMs:180000,stopMs:60000};
// Shared retention coordinator uses retentionPaths(ctx)[1]: exact publisher map file.
const hash=x=>createHash('sha256').update(x).digest('hex');
const stopProofs=new WeakMap(),contexts=new WeakMap();
const scope='Idle campaign-map service: supported Startup controls consumed through native A2S/RCON, actual file-editor capability, publisher map/config identity and clean quit. No player campaign progress, gameplay or WAN.';
const offlineImage='sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8';
function spec(ctx){
 const r=registration[ctx.game.family],f=ctx.fixture;
 if(!r||ctx.game.recipe!==r.recipe||f?.recipe!==r.recipe||f.server.uuid!==ctx.game.serverUUID||f.server.name!=='validator-'+ctx.game.id||f.ports.length!==1||ctx.game.testStartup)throw Error('Exact owned L4D fixture required');
 return {r,folder:ctx.game.family==='l4d'?'left4dead':'left4dead2',map:r.environment.SRCDS_MAP,app:ctx.game.family==='l4d'?500:550};
}
async function chainHashes(c,ctx){
 const result={};for(const path of Object.keys(pins[ctx.game.family]))result['/'+path]=hash(await c.read('/'+path));return result;
}
export async function installedSource(ctx,c){
 const {r}=spec(ctx),profile=h.profileFromRuntime(r.recipe,receipt),a=(await h.api('/api/application/servers/'+ctx.fixture.server.id)).attributes;
 if(a.uuid!==ctx.fixture.server.uuid||a.egg!==ctx.fixture.egg.id||Number(a.node)===202||a.container?.startup_command!==profile.egg.startup||profile.egg.config.stop!=='quit')throw Error('L4D canonical launch authority differs');
 const emitted=Object.fromEntries([...profile.egg.scripts.installation.script.matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>[m[1],hash(m[3]+'\n')]));
 const actual=await chainHashes(c,ctx);for(const [path,pin]of Object.entries(pins[ctx.game.family]))if(emitted[path]!==pin||actual['/'+path]!==pin)throw Error('L4D exact emitted/installed helper differs: '+path);
 return actual;
}
async function engineProof(ctx, c, container) {
  // Only sanitized identities leave the container. Never emit argv or proc errors:
  // Source launch arguments can contain the fixture's RCON credential.
  const script = String.raw`
import os, json, hashlib
from pathlib import Path
root = Path('/home/container')
paths = ${JSON.stringify(Object.keys(pins[ctx.game.family]))}
def argv(pid):
    return Path('/proc', str(pid), 'cmdline').read_bytes().split(b'\0')[:-1]
def ppid(pid):
    return int(next(x.split()[1] for x in Path('/proc', str(pid), 'status').read_text().splitlines() if x.startswith('PPid:')))
try:
    sources = {p: (root / p).read_bytes() for p in paths}
    found = []
    for entry in list(Path('/proc').iterdir())[:65536]:
        if not entry.name.isdigit(): continue
        try:
            pid = int(entry.name)
            exe = os.readlink(entry / 'exe')
            if exe not in ['/home/container/srcds_linux', '/home/container/srcds_linux64']: continue
            parent = ppid(pid)
            args, supervisor = argv(pid), argv(parent)
            direct = any(x == b'/home/container/.voltra/source_variant_runtime.py' or x == b'.voltra/source_variant_runtime.py' for x in supervisor[1:2]) and os.path.basename(os.readlink(Path('/proc', str(parent), 'exe'))).startswith('python')
            shell = ppid(parent)
            shellArgs = argv(shell)
            tini = os.readlink('/proc/1/exe') == '/usr/bin/tini' and argv(1) == [b'/usr/bin/tini', b'-g', b'--', b'/entrypoint.sh']
            outer = tini and (shell == 1 or (ppid(shell) == 1 and os.path.basename(os.readlink(Path('/proc', str(shell), 'exe'))) == 'bash' and b'/entrypoint.sh' in shellArgs))
            entryHash = hashlib.sha256(Path('/entrypoint.sh').read_bytes()).hexdigest()
            direct = direct and outer and entryHash == '32ae2a4f09300d31db2e10379a935614fc95f743da134eefbef61019dd4da4c4'
            norestart = b'-norestart' in args
            noDebug = not any(x.lower() in [b'-debug', b'-debugger'] for x in args)
            # Re-read identity to reject a disappearing/reparented process.
            if os.readlink(entry / 'exe') != exe or ppid(pid) != parent: raise ValueError()
            found.append(dict(pid=pid, ppid=parent, shellPid=shell, outerChain=outer, entrypointSHA256=entryHash, executable=exe, directSupervisor=direct, norestart=norestart, noDebug=noDebug))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    print(json.dumps(dict(ok=True, engines=found, hashes={'/' + p: hashlib.sha256(v).hexdigest() for p,v in sources.items()})))
except Exception:
    print(json.dumps(dict(ok=False)))
`;
  let proof;
  try {
    proof = JSON.parse(await docker(['exec', '-e', 'PYTHONHOME=/home/container/.voltra/python', '-e', 'LD_LIBRARY_PATH=/home/container/.voltra/python/lib', container.id, '/home/container/.voltra/python/bin/python3', '-c', script], ctx.signal, 10000));
  } catch { throw Error('L4D direct engine identity probe failed'); }
  await ctx.artifact('engine-identity-probe.json', JSON.stringify(proof, null, 2));
  const engine = proof.engines?.[0];
  if (!proof.ok || proof.engines?.length !== 1 || !engine?.directSupervisor || !engine.norestart || !engine.noDebug || !Number.isInteger(engine.pid) || !Number.isInteger(engine.ppid)) throw Error('L4D direct engine child/no-restart/no-debug identity unproved');
  const hashes = await chainHashes(c,ctx);
  await installedSource(ctx,c);
  if (JSON.stringify(hashes) !== JSON.stringify(proof.hashes)) throw Error('L4D helper hashes changed during engine proof');
  const result = { containerId: container.id, startedAt: container.state.StartedAt, engine, hashes };
  stopProofs.set(ctx, result);
  await ctx.artifact('direct-engine-proof.json', JSON.stringify(result, null, 2));
  return result;
}
async function rcon(ctx, command) {
  ctx.signal.throwIfAborted();
  const password = ctx.game.environment?.RCON_PASSWORD;
  if (!password || password !== registration[ctx.game.family]?.environment.RCON_PASSWORD || password === '[global integration]' || /[\x00\r\n]/.test(password)) throw Error('Exact controlled fixture RCON credential required; masked API values are not credentials');
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = Buffer.alloc(0), output = '', authenticated = false, finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true; clearTimeout(timer); ctx.signal.removeEventListener('abort', abort); socket.destroy();
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(ctx.signal.reason ?? Error('Aborted'));
    const timer = setTimeout(() => finish(Error('L4D TCP RCON timeout')), 5000);
    const send = (id, type, body) => {
      const bytes = Buffer.from(body), packet = Buffer.alloc(bytes.length + 14);
      packet.writeInt32LE(bytes.length + 10); packet.writeInt32LE(id, 4); packet.writeInt32LE(type, 8); bytes.copy(packet, 12); socket.write(packet);
    };
    socket.on('error', () => finish(Error('L4D TCP RCON connection failed')));
    socket.on('close', () => { if (!finished) finish(Error('L4D TCP RCON closed before response fence')); });
    socket.on('data', chunk => {
      try {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > 1048576) throw Error('Oversized RCON response');
        while (buffer.length >= 4) {
          const size = buffer.readInt32LE(0);
          if (size < 10 || size > 4096) throw Error('Invalid Source RCON packet length');
          if (buffer.length < size + 4) break;
          const packet = buffer.subarray(0, size + 4); buffer = buffer.subarray(size + 4);
          const id = packet.readInt32LE(4), type = packet.readInt32LE(8);
          if (packet.at(-1) || packet.at(-2)) throw Error('Invalid RCON terminator');
          if (id === -1) throw Error('L4D RCON authentication refused');
          if (!authenticated) {
            if (id === 101 && type === 2) { authenticated = true; send(102, 2, command); send(103, 0, ''); }
          } else if (id === 102 && type === 0) {
            output += packet.subarray(12, -2).toString('utf8');
            if (output.length > 262144) throw Error('Oversized RCON command output');
          } else if (id === 103 && type === 0) { finish(null, output); return; }
        }
      } catch (error) { finish(error); }
    });
    ctx.signal.addEventListener('abort', abort, { once: true });
    socket.connect(ctx.fixture.ports[0], '127.0.0.1', () => send(101, 3, password));
    if (ctx.signal.aborted) abort();
  });
}
async function query(ctx) {
  const port = ctx.fixture.ports[0], host = '127.0.0.1';
  const request = Buffer.from('\xff\xff\xff\xffTSource Engine Query\0', 'latin1');
  ctx.signal.throwIfAborted();
  const socket = dgram.createSocket('udp4');
  return new Promise((resolve, reject) => {
    let finished = false, challenged = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer); ctx.signal.removeEventListener('abort', abort);
      socket.close(); error ? reject(error) : resolve(value);
    };
    const abort = () => finish(ctx.signal.reason ?? Error('Aborted'));
    const timer = setTimeout(() => finish(Error('L4D A2S query timed out')), 3000);
    const send = bytes => socket.send(bytes, port, host, error => { if (error) finish(error); });
    socket.once('error', error => finish(error));
    socket.on('message', (data, peer) => {
      if (finished || peer.address !== host || peer.port !== port) return;
      try {
        if (data.length === 9 && data.readInt32LE(0) === -1 && data[4] === 0x41 && !challenged) {
          challenged = true; send(Buffer.concat([request, data.subarray(5)])); return;
        }
        finish(null, parseInfo(data,ctx.game.family==='l4d'?7:17));
      } catch (error) { finish(error); }
    });
    ctx.signal.addEventListener('abort', abort, { once: true });
    send(request);
    if (ctx.signal.aborted) abort();
  });
}
function parseInfo(data,ctxProtocol) {
  if (data.length < 6 || data.length > 16384 || data.readInt32LE(0) !== -1 || data[4] !== 0x49) throw Error('Invalid L4D A2S_INFO framing');
  let offset = 6;
  const string = () => {
    const end = data.indexOf(0, offset);
    if (end < 0) throw Error('Truncated A2S string');
    const value = data.subarray(offset, end).toString('utf8'); offset = end + 1; return value;
  };
  const name = string(), map = string(), folder = string(), game = string();
  if (offset + 9 > data.length) throw Error('Truncated A2S fields');
  const appId = data.readUInt16LE(offset), players = data[offset + 2], maxplayers = data[offset + 3], bots = data[offset + 4];
  const serverType = String.fromCharCode(data[offset + 5]), environment = String.fromCharCode(data[offset + 6]);
  const visibility = data[offset + 7], vac = data[offset + 8]; offset += 9;
  const version = string();
  if (data[5] !== (ctxProtocol) || players > maxplayers || bots > players || maxplayers < 1 || visibility > 1 || vac > 1 || serverType !== 'd' || environment !== 'l') throw Error('Invalid L4D A2S values');
  return { protocol: data[5], name, map, folder, game, appId, players, maxplayers, bots, serverType, environment, password: !!visibility, vac: !!vac, version };
}

async function stateSnapshot(ctx){
 const s=spec(ctx),n=await native(ctx);if(!n)throw Error('L4D container absent');
 const [d]=JSON.parse(await docker(['inspect',n.id],ctx.signal));
 const source='/var/lib/voltra-parity-20261029/volumes/'+ctx.fixture.server.uuid;
 if(d.Name!=='/'+ctx.fixture.server.uuid||d.Mounts.filter(m=>m.Destination==='/home/container'&&m.Source===source).length!==1||d.Mounts.some(m=>m.Destination.startsWith('/home/container/')))throw Error('L4D owned volume differs');
 const program=String.raw`import sys,json,hashlib,stat
from pathlib import Path
r=Path('/home/container');folder,mapname=sys.argv[1:]
paths=[folder+'/cfg/server.cfg',folder+'/cfg/voltra-managed.cfg',folder+'/cfg/voltra-variant.cfg',folder+'/maps/'+mapname+'.bsp']
out={}
for name in paths:
 p=r/name
 for q in [p,*p.parents]:
  if q==r.parent:break
  if q.is_symlink():raise ValueError('Unsafe retained path')
 a=p.stat()
 if not stat.S_ISREG(a.st_mode) or a.st_size>536870912:raise ValueError('Invalid retained file')
 digest=hashlib.sha256()
 with p.open('rb') as f:
  for data in iter(lambda:f.read(1048576),b''):digest.update(data)
 b=p.stat()
 if (a.st_ino,a.st_size,a.st_mtime_ns)!=(b.st_ino,b.st_size,b.st_mtime_ns):raise ValueError('Retained file changed during read')
 out[name]=dict(sha256=digest.hexdigest(),size=b.st_size,mode=stat.S_IMODE(b.st_mode),uid=b.st_uid,gid=b.st_gid)
print(json.dumps(out,sort_keys=True))`;
 let out;
 if(d.State.Running)out=await docker(['exec','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib',n.id,'/home/container/.voltra/python/bin/python3','-B','-c',program,s.folder,s.map],ctx.signal,30000);
 else{
  if(ctx.game.offlineHelperImage!==offlineImage)throw Error('Reviewed offline Python image required');
  out=await docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--cpus','1','--user','0:0','--cap-drop','ALL','--cap-add','DAC_READ_SEARCH','--security-opt','no-new-privileges','--mount','type=bind,source='+source+',target=/home/container,readonly',offlineImage,'python3','-B','-c',program,s.folder,s.map],ctx.signal,30000);
 }
 return JSON.parse(out);
}
export async function prerequisites(ctx,c){
 spec(ctx);if(await c.state()!=='offline'||(await native(ctx))?.state.Running)throw Error('L4D prerequisites require stopped fixture');
 if(ctx.game.offlineHelperImage!==offlineImage)throw Error('Reviewed offline helper required');
 for(const key of ['PUBLIC_SERVER','AUTO_UPDATE','LOBBY_ONLY'])if(ctx.game.environment?.[key]!=='0')throw Error('L4D private idle controls differ');
 if(ctx.game.environment?.SERVER_PASSWORD||ctx.game.environment?.STEAM_GSLT)throw Error('L4D isolated LAN fixture requires no join credential/listing token');
 contexts.set(ctx,{name:ctx.game.environment.HOSTNAME,edited:false});return {hashes:await installedSource(ctx,c),scope};
}
export async function ready(ctx,c){
 const s=spec(ctx),n=await native(ctx);if(!n?.state||Date.parse(n.state.StartedAt)<ctx.startRequestedAt)return false;
 if(!n.state.Running)throw Error('L4D exited before readiness');
 let info,status;
 try{info=await query(ctx);status=await rcon(ctx,'status');}catch(error){if(/timeout|timed out|connection failed|closed before response fence/.test(error.message))return false;throw error;}
 const expected=contexts.get(ctx)?.name??ctx.game.environment.HOSTNAME;
 if(info.name!==expected||info.map!==s.map||info.folder!==s.folder||info.appId!==s.app||info.maxplayers!==4||info.players!==0||info.bots!==0||info.password)throw Error('L4D native query identity/private idle state differs');
 const nativeMap=status.match(/^map\s*:\s*(\S+)/m),name=status.match(/^hostname\s*:\s*(.*?)\s*$/m);
 if(nativeMap?.[1]!==s.map||name?.[1]!==expected)throw Error('L4D authenticated native status differs');
 if(await c.state()!=='running')return false;
 const proof=await engineProof(ctx,c,n),files=await stateSnapshot(ctx);
 return {startedAt:n.state.StartedAt,query:info,statusSHA256:hash(status),processProof:proof,mapIdentity:files[s.folder+'/maps/'+s.map+'.bsp'],scope};
}
async function cleanStop(ctx,c){
 const n=await native(ctx),p=stopProofs.get(ctx);
 if(!n||!p||n.id!==p.containerId||n.state.StartedAt!==p.startedAt||n.state.Running||n.state.ExitCode!==0||n.state.OOMKilled||n.state.Dead||await c.state()!=='offline')throw Error('L4D direct native quit0 unproved');
 if(/grace expired|escalating owned process|Native process exited:/i.test(await logs(ctx,n.state.StartedAt))||JSON.stringify(await installedSource(ctx,c))!==JSON.stringify(p.hashes))throw Error('L4D stop escalated/source changed');
 return {...p,engineNumericExit:0,engineExitProven:true};
}
export async function settings(ctx,c){
 const s=spec(ctx);await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','L4D settings stop',budgets.stopMs);await cleanStop(ctx,c);
 const file='/'+s.folder+'/cfg/server.cfg',url='/api/client/servers/'+ctx.fixture.server.uuid+'/game-settings?file='+encodeURIComponent(file);
 const body=(await h.api(url)).attributes;
 if(body.file!==file||!body.revision||!Array.isArray(body.fields))throw Error('L4D existing file settings authority absent');
 // Startup-owned controls must not become writable through the file editor.
 for(const f of body.fields)if(f.key!=='sv_alltalk'&&f.readonly!==true&&f.type!=='readonly')throw Error('Unexpected writable L4D file control');
 const scalar=body.fields.filter(f=>f.key==='sv_alltalk');if(scalar.length>1)throw Error('Ambiguous L4D scalar exposure');
 if(ctx.game.family==='l4d'&&scalar.some(f=>f.readonly!==true&&f.type!=='readonly'))throw Error('L4D unsupported scalar exposed writable');
 const raw=await c.read(file);let refused=false;
 try{await h.api(url,'PUT',{revision:body.revision,settings:{hostname:'unsupported-file-edit'}});}catch(error){if(!/422|400|readonly|read.only|unsupported|unknown|review|startup|scalar/i.test(error.message))throw error;refused=true;}
 if(!refused||await c.read(file)!==raw)throw Error('L4D unsupported file mutation refusal unproved');
 const name='Validator '+ctx.game.family.toUpperCase()+' Typed';
 const result=await h.api('/api/client/servers/'+ctx.fixture.server.uuid+'/startup/variable','PUT',{key:'HOSTNAME',value:name});
 // Native response is the final authority; the setter's payload is not logged.
 if(!result)throw Error('L4D typed Startup update response absent');
 contexts.set(ctx,{name,edited:true});ctx.startRequestedAt=Date.now();await c.power('start');
 const nativeReadback=await wait(ctx,()=>ready(ctx,c),'L4D Startup name consumption',budgets.startupMs);
 return {startupChanges:{HOSTNAME:name},unsupportedFileEditRefused:true,fileScalar:scalar.map(f=>({key:f.key,type:f.type,readonly:f.readonly})),nativeReadback,scope};
}
export function retentionPaths(ctx){const s=spec(ctx);return ['/'+s.folder+'/cfg','/'+s.folder+'/maps/'+s.map+'.bsp'];}
export function restoreContext(ctx,saved){spec(ctx);if(!saved?.name||!saved.baseline||saved.engineNumericExit!==0||!saved.engineExitProven||!saved.processProof?.engine?.directSupervisor)throw Error('L4D retained native proof absent');contexts.set(ctx,{name:saved.name,edited:true});}
export async function saved(ctx,c){
 const state=contexts.get(ctx);if(!state?.edited)throw Error('L4D consumed Startup mutation absent');
 const processProof=await cleanStop(ctx,c),baseline=await stateSnapshot(ctx);
 return {name:state.name,baseline,processProof,engineNumericExit:0,engineExitProven:true,nativeWorldCreated:false,scope};
}
export async function loaded(ctx,c,saved){
 restoreContext(ctx,saved);const fresh=await ready(ctx,c);if(!fresh||fresh.startedAt===saved.processProof.startedAt)throw Error('L4D fresh native reload absent');
 await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','L4D retained stop',budgets.stopMs);const stop=await cleanStop(ctx,c),after=await stateSnapshot(ctx);
 if(JSON.stringify(after)!==JSON.stringify(saved.baseline))throw Error('L4D publisher map/config bytes or metadata changed across reload');
 return {fresh,stop,retainedMapAndConfig:true,nativeWorldCreated:false,scope};
}
