#!/usr/bin/env python3
"""MIT. Source-only Nightingale/Moria/Smalland adapters; native proof is separate."""
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import shutil
import sys
import tempfile
import threading
from steam_template import arguments, update
from additional_survival_install import private_bytes


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


config = load('fantasy_native_config', 'native-config.py')
console = load('fantasy_native_console', 'native-console.py')
GAMES = {
    'nightingale': (3796810, 'linux', 'NWX/Binaries/Linux/NWXServer-Linux-Shipping'),
    'moria': (3349480, 'windows', 'Moria/Binaries/Win64/MoriaServer-Win64-Shipping.exe'),
    'smalland': (808040, 'linux', 'SMALLAND/Binaries/Linux/SMALLANDServer-Linux-Shipping'),
}
PRESERVE = {
    'nightingale': ('NWX/Config', 'NWX/Saved', 'NWX/Content/Paks/~mods', 'NWX/Plugins'),
    'moria': ('MoriaServerConfig.ini', 'MoriaServerPermissions.txt', 'MoriaServerRules.txt', 'Moria/Saved', 'Moria/Content/Paks/~mods', 'Moria/Plugins'),
    'smalland': ('SMALLAND/Saved', 'SMALLAND/Config', 'SMALLAND/Content/Paks/~mods', 'SMALLAND/Plugins'),
}


def confined(root, name):
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValueError('Managed path leaves server volume')
    return path


def text(value, limit=4096, quoted=False):
    if not isinstance(value, str) or len(value) > limit or any(c in value for c in '\r\n\x00') or (quoted and '"' in value):
        raise ValueError('Invalid native text control')
    return value


def number(value, low=0, high=2147483647, optional=False):
    if optional and value == '': return ''
    if not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?', str(value)) or not low <= float(value) <= high:
        raise ValueError('Invalid native numeric control')
    return str(value)


def integer(value, low=1, high=65535):
    result = number(value, low, high)
    if not result.isdigit(): raise ValueError('Native control requires an integer')
    return result


def boolean(value):
    if value not in ('0', '1', 'true', 'false'): raise ValueError('Invalid native boolean')
    return value in ('1', 'true')


def primary(env):
    port = integer(env.get('SERVER_PORT', '7777'))
    ports = env.get('VOLTRA_ALLOCATED_PORTS', port).split(',')
    if port not in [integer(p.strip()) for p in ports]: raise ValueError('Primary port is not allocated')
    return port


def smalland_eos(env):
    values = {}
    for suffix in ('DeploymentId', 'DedicatedServerClientId', 'DedicatedServerClientSecret', 'DedicatedServerPrivateKey'):
        original = 'SMALLAND_EOS_' + suffix
        uppercase = original.upper()
        if original in env and uppercase in env and env[original] != env[uppercase]:
            raise ValueError('Conflicting original and Wings variable ' + original)
        values[suffix] = text(env.get(original, env.get(uppercase, '')))
    return values


def ini(root, name, sections):
    path = confined(root, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size > 8 * 1024**2: raise ValueError('Configuration exceeds 8MiB')
    before = path.read_bytes() if path.exists() else b''
    after = config.patch_ini(before.decode('utf-8-sig'), sections).encode()
    if after != before: private_bytes(path, after, path.stat() if path.exists() else None)


def nightingale_settings(root, name, required=False):
    """Read established Nightingale settings without following any path links."""
    path = confined(root, name)
    descriptors = []
    try:
        descriptors.append(os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW))
        parts = Path(name).parts
        for part in parts[:-1]:
            descriptors.append(os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptors[-1]))
        descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptors[-1])
        descriptors.append(descriptor)
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 8 * 1024**2:
            raise ValueError('Nightingale settings must be a regular file of at most 8MiB')
        with os.fdopen(os.dup(descriptor), 'rb') as stream:
            content = stream.read(8 * 1024**2 + 1)
        if len(content) > 8 * 1024**2:
            raise ValueError('Nightingale settings exceed 8MiB')
    except FileNotFoundError:
        if required: raise ValueError('Publisher Nightingale example settings file is absent') from None
        return None
    except OSError:
        raise ValueError('Nightingale settings path must contain only directories and a regular file, without links') from None
    finally:
        for descriptor in reversed(descriptors): os.close(descriptor)
    return content, nightingale_section(content)


def nightingale_section(content):
    # Preserve the established source contract; no guessed publisher class/keys.
    try: original = content.decode('utf-8-sig')
    except UnicodeError: raise ValueError('Publisher Nightingale settings must be UTF-8') from None
    section, candidates = None, set()
    for line in original.splitlines():
        match = re.fullmatch(r'\s*\[([^\]\r\n]+)\]\s*(?:[;#].*)?', line)
        if match: section = match[1]
        elif section is not None and not line.lstrip().startswith((';', '#')) and '=' in line:
            if line.split('=', 1)[0].strip() in ('StartingDifficulty', 'Password', 'AdminPassword'): candidates.add(section)
    if len(candidates) != 1: raise ValueError('Publisher Nightingale settings section is missing or ambiguous')
    selected = candidates.pop()
    try:
        # Exercise the exact eventual configuration parser, without writing or
        # retaining any rewritten content. Never echo publisher/operator values.
        config.patch_ini(original, {selected: {'StartingDifficulty': 'easy', 'Password': '', 'AdminPassword': ''}})
    except ValueError:
        raise ValueError('Publisher Nightingale managed settings structure is invalid') from None
    return selected


def nightingale_preflight(root):
    return nightingale_settings(root, 'NWX/Config/ServerSettings.ini')


def configure(root, game, env):
    if game == 'smalland': command(root, game, env)
    if game == 'nightingale':
        env = dict(env)
        # Preserve the original API name and accept Wings' uppercase runtime key.
        if 'Difficulty' in env and 'DIFFICULTY' in env and env['Difficulty'] != env['DIFFICULTY']:
            raise ValueError('Conflicting original and Wings variable Difficulty')
        if 'DIFFICULTY' in env:env['Difficulty'] = env['DIFFICULTY']
    port = primary(env)
    if game == 'nightingale':
        settings = nightingale_preflight(root)
        if settings is None:
            settings = nightingale_settings(root, 'NWX/Config/ExampleServerSettings.ini', required=True)
        difficulty = env.get('Difficulty', 'easy')
        if difficulty not in ('easy', 'medium', 'hard', 'extreme'): raise ValueError('Invalid Nightingale difficulty')
        content, section = settings
        destination = confined(root, 'NWX/Config/ServerSettings.ini')
        if not destination.exists(): private_bytes(destination, content)
        ini(root, 'NWX/Config/ServerSettings.ini', {section: {'StartingDifficulty': difficulty, 'Password': text(env.get('PASSWORD', 'changeme'), 20), 'AdminPassword': text(env.get('ADMIN_PASSWORD', 'letmein'), 20)}})
    elif game == 'moria':
        difficulty = env.get('DIFFICULTY', 'normal')
        if difficulty not in ('story', 'solo', 'normal', 'hard', 'custom'): raise ValueError('Invalid Moria difficulty')
        ini(root, 'MoriaServerConfig.ini', {'Host': {'ListenPort': port}, 'Main': {'OptionalPassword': text(env.get('SERVER_PASSWORD', ''), 20)}, 'World': {'Name': '"' + text(env.get('WORLD_NAME', 'A Pterodactyl Server'), 80, True) + '"'}, 'World.Create': {'Difficulty.Preset': difficulty}, 'Console': {'Enabled': 'false'}})
    elif game != 'smalland': raise ValueError('Unknown reviewed game')


def command(root, game, env):
    eos = smalland_eos(env) if game == 'smalland' else {}
    app, platform, binary = GAMES[game]
    port = primary(env)
    if game == 'moria': return ['wine', str(confined(root, binary))]
    if game == 'nightingale':
        argv = [str(confined(root, binary)), 'NWX', '-ini:Game:[/Script/Engine.GameSession]:MaxPlayers=' + integer(env.get('MAX_PLAYER', '6'), 1, 2147483647)]
        if boolean(env.get('CHEATS', '1')): argv.append('-EnableCheats')
        return argv + ['-port=' + port, '-multihome=0.0.0.0']
    # FURL delimiter characters are native syntax, never shell escaped or silently reinterpreted.
    def furl(value, limit=4096):
        result = text(value, limit, True)
        if '?' in result: raise ValueError('Native FURL text cannot contain a question mark')
        return result
    url = '/Game/Maps/WorldGame/WorldGame_Smalland?SERVERNAME=' + furl(env.get('SERVERNAME', 'My Server'), 32) + '?WORLDNAME=' + furl(env.get('WORLDNAME', 'World'), 32)
    password = env.get('PASSWORD', '')
    if password: url += '?PASSWORD=' + furl(password)
    for key in ('FRIENDLYFIRE', 'PEACEFULMODE', 'KEEPINVENTORY', 'PRIVATE'):
        if boolean(env.get(key, '0')): url += '?' + key
    if not boolean(env.get('DETERIORATION', '1')): url += '?NODETERIORATION'
    for key, default, low, high in [('LENGTHOFDAYSECONDS', '1800', 0, 2147483647), ('LENGTHOFSEASONSECONDS', '10800', 0, 2147483647), ('CREATUREHEALTHMODIFIER', '100', 20, 300), ('CREATUREDAMAGEMODIFIER', '100', 20, 300), ('NOURISHMENTLOSSMODIFIER', '100', 0, 100), ('FALLDAMAGEMODIFIER', '', 0, 2147483647)]:
        url += '?' + key.lower() + '=' + number(env.get(key, default), low, high, optional=key == 'FALLDAMAGEMODIFIER')
    argv = [str(confined(root, binary)), 'SMALLAND', url]
    for key in ('DeploymentId', 'DedicatedServerClientId', 'DedicatedServerClientSecret', 'DedicatedServerPrivateKey'):
        argv.append('-ini:Engine:[EpicOnlineServices]:' + key + '=' + eos[key])
    return argv + ['-port=' + port, '-NOSTEAM', '-log', '-stdout', '-forcelogflush']


def install(root, game, env):
    if game == 'smalland': command(Path(root).resolve(), game, env)
    root = Path(root).resolve()
    app, platform, binary = GAMES[game]
    if game == 'nightingale': nightingale_preflight(root)
    if env.get('SRCDS_APPID', str(app)) != str(app): raise ValueError('Original dedicated application identity is fixed')
    if game == 'moria' and env.get('WINDOWS_INSTALL', '1') != '1': raise ValueError('Moria requires original Windows dedicated payload and Wine/vcrun2022')
    if game != 'moria' and env.get('WINDOWS_INSTALL', '0') != '0': raise ValueError('Selected Linux recipe does not silently run a Windows payload')
    arguments(root, app, env, True, platform=platform)
    state = confined(root, '.voltra/fantasy-' + game)
    state.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='operator-', dir=state) as tmp:
        backup = Path(tmp)
        previous = []
        for name in PRESERVE[game]:
            path = confined(root, name)
            if not path.exists(): continue
            for item in [path, *path.rglob('*')] if path.is_dir() else [path]:
                confined(root, str(item.relative_to(root)))
                if not (item.is_dir() or item.is_file()): raise ValueError('Unsupported operator filesystem entry')
                relative, metadata = item.relative_to(root), item.stat()
                if item.is_file():
                    saved = backup / relative
                    saved.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(item, saved)
                    saved.chmod(0o600)
                previous.append((relative, metadata, item.is_dir()))
        try:
            receipt = update(root, app, env=env, validate=True, required=(binary,), platform=platform)
        finally:
            for relative, metadata, directory in previous:
                path = confined(root, str(relative))
                path.parent.mkdir(parents=True, exist_ok=True)
                if directory: path.mkdir(exist_ok=True)
                else: private_bytes(path, (backup / relative).read_bytes(), metadata)
                os.chown(path, metadata.st_uid, metadata.st_gid)
                path.chmod(metadata.st_mode & 0o777)
        if game == 'nightingale':
            settings = nightingale_preflight(root)
            if settings is None:
                content, _ = nightingale_settings(root, 'NWX/Config/ExampleServerSettings.ini', required=True)
                private_bytes(confined(root, 'NWX/Config/ServerSettings.ini'), content)
        if platform == 'linux': confined(root, binary).chmod(0o755)
        return receipt


def tail_log(path, finish, credentials):
    """Preserve imported Moria tail -c0 -F log forwarding, without a second supervisor."""
    identity, position = None, path.stat().st_size if path.exists() else 0
    redactor = console.Redactor(credentials)
    while not finish.wait(0.1):
        try:
            metadata = path.stat()
            current = (metadata.st_dev, metadata.st_ino)
            if identity is not None and (current != identity or metadata.st_size < position): position = 0
            identity = current
            with path.open('rb') as stream:
                stream.seek(position)
                data = stream.read(65536)
                position = stream.tell()
            if data:
                sys.stdout.buffer.write(redactor.feed(data, final=data.endswith(b'\n')))
                sys.stdout.buffer.flush()
        except FileNotFoundError: pass
    sys.stdout.buffer.write(redactor.feed(b'', final=True))
    sys.stdout.buffer.flush()


def launch(root, game, env):
    eos = smalland_eos(env) if game == 'smalland' else {}
    root = Path(root).resolve()
    if game == 'smalland': command(root, game, env)
    if game == 'nightingale': nightingale_preflight(root)
    if boolean(env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'))): install(root, game, env)
    configure(root, game, env)
    argv = command(root, game, env)
    child = dict(env, HOME=str(root), XDG_CONFIG_HOME=str(root / '.config'))
    child['LD_LIBRARY_PATH'] = ':'.join([str(root / 'linux64'), str(root), env.get('LD_LIBRARY_PATH', '.')])
    child.pop('PYTHONHOME', None)
    child.pop('PYTHONPATH', None)
    for key in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS'): child.pop(key, None)
    credentials = tuple(env.get(key, '') for key in ('PASSWORD', 'ADMIN_PASSWORD', 'SERVER_PASSWORD'))
    if game == 'smalland': credentials += (eos['DedicatedServerClientSecret'], eos['DedicatedServerPrivateKey'])
    else: credentials += (env.get('SMALLAND_EOS_DedicatedServerClientSecret', ''),)
    finished = threading.Event()
    worker = None
    if game == 'moria':
        prerequisites = load('fantasy_wine_prerequisites', 'private-wine-prerequisites.py')
        pins = json.loads(Path(__file__).with_name('fantasy-survival-pins.json').read_text())
        child.update(prerequisites.prepare(root, env, 'vcrun2022', pins, ('vcrun2022',)))
        worker = threading.Thread(target=tail_log, args=(confined(root, 'Moria/Saved/Logs/Moria.log'), finished, credentials), daemon=True)
        worker.start()
    try:
        # Shared signal transport targets only this owned native process group.
        # The actual exit code is retained; game save/stop semantics need native acceptance.
        return console.run(root, argv, child, '^C', credentials=credentials, stop_signal=signal.SIGINT)
    finally:
        finished.set()
        if worker: worker.join(timeout=2)


if __name__ == '__main__':
    action, game = sys.argv[1:3]
    if action == 'install': install(Path.cwd(), game, dict(os.environ))
    elif action == 'run': sys.exit(launch(Path.cwd(), game, dict(os.environ)))
    else: raise ValueError('Unknown reviewed operation')
