import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),normalize=x=>x.replaceAll('\r\n','\n').replace(/\n*$/,'\n');
const recipe='openarena/egg-open-arena.json',baseline=fs.readFileSync('internal/panel/game_library/overrides.json'),original=JSON.parse(baseline)[recipe],profile=structuredClone(original);
let source=normalize(fs.readFileSync('internal/panel/game_library/scripts/openarena-runtime.py','utf8'));
const helpers=`NATIVE_DEFAULTS = ('// OpenArena 0.8.8 extra native tuning. Original form controls load afterward.\\n'
                   'set fraglimit "20"\\nset timelimit "0"\\nset capturelimit "8"\\n'
                   'set g_friendlyFire "0"\\nset g_allowVote "1"\\nset g_doWarmup "0"\\n'
                   'set g_warmup "20"\\nset g_inactivity "0"\\n')


def planned_paths(root, paths):
    root = root.resolve()
    for path in paths:
        relative = path.relative_to(root)
        current = root
        for index, part in enumerate(relative.parts):
            current = current / part
            if current.is_symlink():
                raise ValueError('OpenArena configuration paths must not use symlinks')
            if current.exists() and (not current.is_file() if index == len(relative.parts)-1 else not current.is_dir()):
                raise ValueError('OpenArena configuration path has an invalid file kind')


def seed_native(folder):
    target = folder / 'server.cfg'
    if not target.exists():
        with open(target, 'x', opener=lambda p, f: os.open(p, f | os.O_NOFOLLOW, 0o600)) as out:
            out.write(NATIVE_DEFAULTS)


`;
assert.equal(source.split('def configure(env, root):').length,2);source=source.replace('def configure(env, root):',helpers+'def configure(env, root):');
const marker="    password = env.get('RCON_PASSWORD', '')\n    credential = root / '.voltra/openarena/rcon-password'";
assert.ok(source.includes(marker));source=source.replace(marker,marker+"\n    if password:\n        quoted(password, 127)\n    allocated = {int(value) for value in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if value}\n    if allocated and port not in allocated:\n        raise ValueError('OpenArena needs an allocated primary port')\n    folder = game / 'userdata' / mod\n    planned_paths(root, [credential, folder / 'server.cfg', folder / 'voltra-managed.cfg'])");
assert.ok(source.includes("    config = folder / 'voltra-managed.cfg'"));source=source.replace("    config = folder / 'voltra-managed.cfg'","    seed_native(folder)\n    config = folder / 'voltra-managed.cfg'");
const start=source.indexOf('def run(root, argv):'),end=source.indexOf("if __name__ == '__main__':",start);assert.ok(start>0&&end>start);
source=source.slice(0,start)+`def run(root, argv):
    from native_console import run as supervise
    environment = dict(os.environ)
    credentials = [environment.get('SERVER_PASSWORD', ''), environment.get('RCON_PASSWORD', '')]
    if not credentials[1]:
        credentials[1] = (root / '.voltra/openarena/rcon-password').read_text()
    finished = threading.Event()
    def readiness():
        token = secrets.token_hex(8).encode()
        port = int(environment['SERVER_PORT'])
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.settimeout(0.2)
            while not finished.is_set():
                probe.sendto(b'\\xff\\xff\\xff\\xffgetinfo ' + token + b'\\n', ('127.0.0.1', port))
                try:
                    packet, address = probe.recvfrom(8192)
                    if address == ('127.0.0.1', port) and packet.startswith(b'\\xff\\xff\\xff\\xffinfoResponse\\n') and b'\\\\challenge\\\\' + token in packet:
                        print('OpenArena native UDP server ready', flush=True)
                        return
                except socket.timeout:
                    pass
                finished.wait(0.1)
    worker = threading.Thread(target=readiness, daemon=True)
    worker.start()
    try:
        result = supervise(root / 'openarena', argv, environment, 'quit', credentials=credentials)
        return result if result >= 0 else 128 - result
    finally:
        finished.set()
        worker.join(timeout=1)


`+source.slice(end);
const target='artifacts/game-parity-20261029/openarena-runtime.pending.py';fs.writeFileSync(target,source);
let script=profile.egg.scripts.installation.script;const pattern=/cat > \.voltra\/openarena_runtime\.py <<'VOLTRA_SOURCE'\n[\s\S]*?\nVOLTRA_SOURCE/;assert.equal([...script.matchAll(new RegExp(pattern.source,'g'))].length,1);script=script.replace(pattern,"cat > .voltra/openarena_runtime.py <<'VOLTRA_SOURCE'\n"+source+"VOLTRA_SOURCE");
let embeds='';const identities=[{file:'.voltra/openarena_runtime.py',sha256:hash(source)}];for(const [from,to]of[['native-console.py','native_console.py'],['steam-template.py','steam_template.py']]){const text=normalize(fs.readFileSync('internal/panel/game_library/scripts/'+from,'utf8')),marker='VOLTRA_OA_'+to.replaceAll('.','_').toUpperCase();assert.ok(!text.includes(marker));embeds+=`cat > .voltra/${to} <<'${marker}'\n${text}${marker}\n`;identities.push({file:'.voltra/'+to,sha256:hash(text)});}
const invocation='python3 .voltra/openarena_install.py';assert.equal(script.split(invocation).length,2);script=script.replace(invocation,embeds+invocation);profile.egg.scripts.installation.script=script;profile.settings_documents=['openarena/userdata/baseoa/server.cfg','openarena/userdata/missionpack/server.cfg'];assert.equal(original.egg.variables.length,9);assert.deepEqual(profile.egg.variables,original.egg.variables);const rest=structuredClone(profile);rest.egg.scripts.installation.script=original.egg.scripts.installation.script;delete rest.settings_documents;assert.deepEqual(rest,original);
fs.writeFileSync('artifacts/game-parity-20261029/openarena-profile.pending.json',JSON.stringify({[recipe]:profile},null,2)+'\n');assert.equal(hash(fs.readFileSync('internal/panel/game_library/overrides.json')),hash(baseline));console.log(JSON.stringify({recipe,baseline_sha256:hash(baseline),identities,controls_preserved:9,source_only:true}));
