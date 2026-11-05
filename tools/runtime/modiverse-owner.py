"""MIT. Scoped Modiverse adapter. Native JSON stays operator-owned."""
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import sys
import tempfile
import native_console
import steam_template
from fantasy_worlds_runtime import confined, integer, boolean, publish

CONFIG = 'KJMod/Binaries/Linux/ServerData/ServerConfiguration.json'
PROGRAM = 'KJMod/Binaries/Linux/KJModServer'
PROTECTED = ('KJMod/Binaries/Linux/ServerData', 'KJMod/Saved', 'ServerData', 'Plugins', 'Mods')

def credentials(value):
    result = []
    if isinstance(value, dict):
        for key, item in value.items():
            if any(part in key.lower() for part in ('password', 'secret', 'token', 'pin', 'authkey')) and isinstance(item, (str, int)):
                result.append(str(item))
            else:
                result.extend(credentials(item))
    elif isinstance(value, list):
        for item in value:
            result.extend(credentials(item))
    return result

def plan(root, env):
    if str(env.get('SRCDS_APPID', '1549820')) != '1549820':
        raise ValueError('Use the reviewed Modiverse application')
    if env.get('EXTRA_FLAGS', ''):
        raise ValueError('Raw Steam flags are unsupported')
    primary = integer(env.get('SERVER_PORT', ''), 1, 65535)
    query = integer(env.get('QUERY_PORT', '27015'), 1, 65535)
    selected = {integer(p, 1, 65535) for p in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',')}
    if primary == query or not {primary, query} <= selected:
        raise ValueError('Game and query require distinct selected allocations')
    name = env.get('HOSTNAME', 'Pterodactyl Server')
    if not name or len(name) > 32 or any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise ValueError('Invalid server name')
    maximum = integer(env.get('MAX_PLAYERS', '128'), 2, 128)
    boolean(env.get('AUTO_UPDATE', '1'))
    secret = []
    for relative in (CONFIG, 'ServerData/ServerConfiguration.json'):
        path = confined(root, relative)
        if path.exists():
            value = json.loads(path.read_bytes().decode('utf-8-sig'))
            if not isinstance(value, dict):
                raise ValueError('Native configuration must be an object')
            secret.extend(credentials(value))
    for relative in PROTECTED:
        path = confined(root, relative)
        if path.exists():
            for item in path.rglob('*'):
                if item.is_symlink() or not (item.is_file() or item.is_dir()):
                    raise ValueError('Operator state needs explicit migration')
    return [str(confined(root, PROGRAM)), '-port='+str(primary), '-queryport='+str(query),
            '-SteamServerName='+name, '-KJModBaseUGCFolder=ServerData', '-DoNotRestartOnEmpty',
            '-InitUGCs', '-maxplayers='+str(maximum)], secret

def configure(root, env):
    argv, secret = plan(root, env)
    path = confined(root, CONFIG)
    if not path.exists():
        seed = Path(__file__).with_name('modiverse_seed.json').read_bytes()
        secret.extend(credentials(json.loads(seed)))
        publish(root, CONFIG, seed)
    return argv, secret

def install(root, env):
    plan(root, env)
    # Acquisition is x86 Linux only. Operator files with updates disabled remain usable.
    if platform.system() != 'Linux' or platform.machine().lower() not in ('x86_64', 'amd64'):
        raise ValueError('Acquisition requires Linux amd64; ARM64/emulation is unverified')
    steam_template.arguments(root, 1549820, env, True, platform='linux')
    with tempfile.TemporaryDirectory(prefix='modiverse-retain-') as folder:
        backup = Path(folder)
        for index, relative in enumerate(PROTECTED):
            source = confined(root, relative)
            if source.exists():
                shutil.copytree(source, backup / str(index))
        try:
            result = steam_template.update(root, 1549820, env, validate=True, required=(PROGRAM,))
        finally:
            for index, relative in enumerate(PROTECTED):
                source = backup / str(index)
                if source.exists():
                    destination = confined(root, relative)
                    shutil.copytree(source, destination, dirs_exist_ok=True)
    configure(root, env)
    return result

def main():
    root, env = Path.cwd().resolve(), dict(os.environ)
    action = sys.argv[1]
    if action == 'preflight':
        plan(root, env)
        steam_template.arguments(root, 1549820, env, True, platform='linux')
        return 0
    if action == 'install':
        install(root, env)
        return 0
    if action != 'run':
        raise ValueError('Unknown operation')
    plan(root, env)
    if boolean(env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'))):
        install(root, env)
    if not confined(root, PROGRAM).is_file():
        raise ValueError('Missing operator/publisher server program')
    argv, secret = configure(root, env)
    blocked = {'STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS', 'PYTHONPATH', 'PYTHONHOME', 'LD_PRELOAD'}
    child = {k:v for k,v in env.items() if k not in blocked}
    child.update(HOME=str(root), XVFB='0', LD_LIBRARY_PATH=str(root/'.steam/sdk64')+':'+str(root/'linux64'))
    return native_console.run(root, argv, child, '\x03', credentials=secret,
                              ready_marker=b'listening on port', terminal_input=True, stop_signal=signal.SIGINT)

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('Modiverse refused operation; verify allocations, native JSON, Linux amd64 and public Steam prerequisites.', file=sys.stderr)
        sys.exit(1)
