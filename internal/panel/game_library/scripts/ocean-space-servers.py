#!/usr/bin/env python3
"""MIT. Typed source adapters for original Windrose, Voyagers and StarRupture."""
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import tempfile
import threading
from steam_template import arguments, update
from additional_survival_install import private_bytes


def helper(name):
    path = Path(__file__).with_name(name + '.py')
    if not path.exists(): path = path.with_name(name.replace('-', '_') + '.py')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name.replace('-', '_')] = module
    spec.loader.exec_module(module)
    return module


native = helper('native-config')
console = helper('native-console')
wine = helper('private-wine-prerequisites')
GAMES = {
    'windrose': (4129620, 'R5/Binaries/Win64/WindroseServer-Win64-Shipping.exe', 'R5/Saved/Logs/R5.log'),
    'voyagers': (3937860, 'BoatGame/Binaries/Win64/BoatGameServer-Win64-Shipping.exe', 'BoatGame/Saved/Logs/BoatGame.log'),
    'starrupture': (3809400, 'StarRupture/Binaries/Win64/StarRuptureServerEOS-Win64-Shipping.exe', 'StarRupture/Saved/Logs/StarRupture.log'),
}
PRESERVE = {
    'windrose': ('R5/ServerDescription.json', 'R5/Saved', 'R5/Config', 'R5/Content/Paks/~mods', 'R5/Plugins', 'R5/Binaries/Win64/ue4ss', 'R5/Binaries/Win64/Mods'),
    'voyagers': ('BoatGame/Saved', 'BoatGame/Config', 'BoatGame/Content/Paks/~mods', 'BoatGame/Plugins', 'BoatGame/Binaries/Win64/ue4ss'),
    'starrupture': ('DSSettings.txt', 'Password.json', 'PlayerPassword.json', '.pteroignore', 'StarRupture/Saved', 'StarRupture/Config', 'StarRupture/Content/Paks/~mods', 'StarRupture/Plugins', 'StarRupture/Binaries/Win64/modloader', 'modloader'),
}
IGNORE = '*\n!Password.json\n!PlayerPassword.json\n!DSSettings.txt\n!StarRupture/Saved/SaveGames/*/AutoSave0.met\n!StarRupture/Saved/SaveGames/*/AutoSave0.sav\n!StarRupture/Saved/SaveGames/SaveData.dat\n'


def confined(root, name):
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root): raise ValueError('Managed file leaves server volume')
    return path


def text(value, maximum=4096):
    if not isinstance(value, str) or len(value) > maximum or any(c in value for c in '\r\n\x00'): raise ValueError('Invalid native text control')
    return value


def integer(value, low=1, high=2147483647):
    if not re.fullmatch(r'[0-9]+', str(value)) or not low <= int(value) <= high: raise ValueError('Invalid native integer control')
    return int(value)


def boolean(value):
    if value not in ('0', '1', 'true', 'false'): raise ValueError('Invalid native boolean')
    return value in ('1', 'true')


def primary(env):
    port = integer(env.get('SERVER_PORT', '7777'), 1, 65535)
    if port not in [integer(p.strip(), 1, 65535) for p in env.get('VOLTRA_ALLOCATED_PORTS', str(port)).split(',')]: raise ValueError('Primary port is not allocated')
    return port


def json_object(body):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result: raise ValueError('Duplicate native JSON key')
            result[key] = value
        return result
    def constant(_): raise ValueError('Non-finite native JSON value')
    value = json.loads(body, object_pairs_hook=pairs, parse_constant=constant)
    if not isinstance(value, dict): raise ValueError('Native config must be an object')
    return value


def read_json(path):
    if path.stat().st_size > 8 * 1024**2: raise ValueError('Configuration exceeds 8MiB')
    return json_object(path.read_bytes().decode('utf-8-sig'))


def write_json(path, value):
    private_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode(), path.stat() if path.exists() else None)


def password_prerequisites(root, env):
    # Original community HTTP endpoint is intentionally never called with operator secrets.
    # Exact existing files are authoritative; do not invent an encryption algorithm or key.
    for key, filename in [('ADMIN_PASSWORD', 'Password.json'), ('PLAYER_PASSWORD', 'PlayerPassword.json')]:
        path = confined(root, filename)
        if env.get(key, '') and not path.is_file():
            raise ValueError('StarRupture native encrypted password file is required; automatic external password transmission is unavailable')
        if path.exists():
            value = read_json(path)
            if not isinstance(value, dict):
                raise ValueError('Native password file requires a supported encrypted password object')
            # Current native files use Password; the published legacy installer
            # wrote password. Accept these exact schemas without rewriting either.
            upper, lower = 'Password' in value, 'password' in value
            if upper == lower:
                raise ValueError('Native password file requires one exact supported encrypted password field')
            field = 'Password' if upper else 'password'
            if not isinstance(value[field], str) or not value[field]:
                raise ValueError('Native password file requires its publisher-compatible encrypted password value')


def configure(root, game, env):
    port = primary(env)
    if game == 'windrose':
        path = confined(root, 'R5/ServerDescription.json')
        if not path.is_file(): raise ValueError('Generate Windrose ServerDescription.json using the publisher dedicated tool, stop it, then upload it; server/world identity is never fabricated')
        value = read_json(path)
        section = value.get('ServerDescription_Persistent')
        if not isinstance(section, dict) or not section.get('PersistentServerId') or not section.get('WorldIslandId'): raise ValueError('Windrose publisher-generated server/world identities are required')
        invite = text(env.get('INVITE_CODE', ''), 32)
        if invite and not re.fullmatch('[a-zA-Z0-9]{6,32}', invite): raise ValueError('Invalid original invite code')
        # Empty is deliberately retained: native generation semantics are not replaced with an invented ID.
        section.update(ServerName=text(env.get('SERVER_NAME', 'Pterodactyl Windrose Server'), 40), InviteCode=invite,
                       IsPasswordProtected=boolean(env.get('SERVER_PASSWORD_PROTECTED', '0')), Password=text(env.get('SERVER_PASSWORD', ''), 30),
                       MaxPlayerCount=integer(env.get('MAX_PLAYERS', '8')), P2pProxyAddress=text(env.get('P2P_PROXY', '127.0.0.1')),
                       UseDirectConnection=boolean(env.get('USE_DIRECT_CONNECTION', '0')),
                       DirectConnectionServerAddress=str(ipaddress.ip_address(env.get('SERVER_IP', '0.0.0.0'))), DirectConnectionServerPort=port)
        if section['P2pProxyAddress'] != '127.0.0.1': raise ValueError('Original fixed P2P proxy must remain loopback')
        write_json(path, value)
    elif game == 'voyagers':
        path = confined(root, 'BoatGame/Saved/PersistedData/CustomConfig/CustomHostServerUserSettings.ini')
        path.parent.mkdir(parents=True, exist_ok=True)
        before = path.read_bytes() if path.exists() else b''
        if len(before) > 8 * 1024**2: raise ValueError('Config exceeds 8MiB')
        settings = {'/Script/BoatGame.BGCustomHostServerSettings': {'HostServerDisplayName': text(env.get('SERVER_NAME', 'A Pterodactyl Hosted Server'), 50), 'HostServerPassword': text(env.get('SERVER_PASSWORD', '')), 'MaxPlayers': str(integer(env.get('MAX_PLAYERS', '10'), 1, 10)), 'AutosaveTimerSeconds': str(integer(env.get('AUTOSAVE_TIMER_SECONDS', '300'), 10, 900))}}
        after = native.patch_ini(before.decode('utf-8-sig'), settings).encode()
        if after != before: private_bytes(path, after, path.stat() if path.exists() else None)
    elif game == 'starrupture':
        password_prerequisites(root, env)
        path = confined(root, 'DSSettings.txt')
        value = read_json(path) if path.exists() else {}
        session, save = text(env.get('SESSION_NAME', 'StarRuptureServer')), text(env.get('SAVEGAME_NAME', 'AutoSave0.sav'))
        if any(c in session + save for c in '/\\') or session in ('.', '..') or save in ('.', '..'): raise ValueError('Native session/save names cannot escape their save directory')
        value.update(SessionName=session, SaveGameInterval=str(integer(env.get('SAVE_INTERVAL', '300'), 0)), StartNewGame=str(boolean(env.get('START_NEW', 'false'))).lower(), LoadSavedGame=str(boolean(env.get('LOAD_SAVE', 'true'))).lower(), SaveGameName=save)
        write_json(path, value)
        ignore = confined(root, '.pteroignore')
        if not ignore.exists(): private_bytes(ignore, IGNORE.encode())
    else: raise ValueError('Unknown reviewed ocean/space game')


def install(root, game, env):
    root = Path(root).resolve()
    app, binary, _ = GAMES[game]
    if env.get('SRCDS_APPID', str(app)) != str(app): raise ValueError('Original dedicated application identity is fixed')
    if env.get('WINDOWS_INSTALL', '1') != '1': raise ValueError('Original Windows dedicated payload requires Windows platform selection')
    arguments(root, app, env, True, platform='windows')
    if game == 'starrupture': password_prerequisites(root, env)
    state = confined(root, '.voltra/ocean-space-' + game)
    state.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='operator-', dir=state) as temporary:
        backup, previous = Path(temporary), []
        for name in PRESERVE[game]:
            path = confined(root, name)
            if not path.exists(): continue
            for item in [path, *path.rglob('*')] if path.is_dir() else [path]:
                confined(root, str(item.relative_to(root)))
                if not (item.is_file() or item.is_dir()): raise ValueError('Unsupported operator filesystem entry')
                relative, metadata = item.relative_to(root), item.stat()
                if item.is_file():
                    saved = backup / relative
                    saved.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(item, saved)
                    saved.chmod(0o600)
                previous.append((relative, metadata, item.is_dir()))
        try: receipt = update(root, app, env=env, validate=True, required=(binary,), platform='windows')
        finally:
            for relative, metadata, directory in previous:
                path = confined(root, str(relative))
                path.parent.mkdir(parents=True, exist_ok=True)
                if directory: path.mkdir(exist_ok=True)
                else: private_bytes(path, (backup / relative).read_bytes(), metadata)
                os.chown(path, metadata.st_uid, metadata.st_gid)
                path.chmod(metadata.st_mode & 0o777)
        if game == 'starrupture' and not confined(root, 'DSSettings.txt').exists(): configure(root, game, env)
        return receipt


def command(root, game, env):
    port = primary(env)
    args = ['wine', str(confined(root, GAMES[game][1]))]
    if game == 'windrose': return args + ['-log']
    if game == 'voyagers': return args + ['-Port=' + str(port), '-log', '-LoggingInShippingEnabled=true']
    return args + ['-Log', '-Port=' + str(port), '-RCWebControlDisable', '-RCWebInterfaceDisable']


def wine_environment(root, game, env):
    verbs = env.get('VOLTRA_WINETRICKS_RUN', env.get('WINETRICKS_RUN', 'vcrun2022' if game == 'starrupture' else ''))
    if game == 'starrupture':
        pins = json.loads(Path(__file__).with_name('ocean-space-pins.json').read_text())
        return wine.prepare(root, env, 'vcrun2022', pins, ('vcrun2022',))
    if verbs: raise ValueError('This original recipe has no Winetricks verbs; arbitrary prerequisite commands are not executed')
    if env.get('WINEARCH', 'win64') != 'win64': raise ValueError('Original dedicated binary requires win64')
    prefix = Path(env.get('WINEPREFIX', str(root / '.wine')))
    if not prefix.is_absolute() or not prefix.resolve().is_relative_to(root) or prefix.is_symlink(): raise ValueError('Wine prefix must be private to this server')
    environment = dict(env, HOME=str(root), WINEPREFIX=str(prefix), WINEARCH='win64', WINEDEBUG=text(env.get('WINEDEBUG', '-all'), 32))
    winepath = Path(env.get('WINEPATH', str(root)))
    if not winepath.is_absolute() or not winepath.resolve().is_relative_to(root): raise ValueError('Wine path must remain inside this server')
    environment['WINEPATH'] = str(winepath)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_LIBRARY_PATH', 'LD_PRELOAD', 'STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS'): environment.pop(key, None)
    return environment


def follow_log(path, finished, credentials, filtered=False):
    position = path.stat().st_size if path.exists() else 0
    identity, pending = None, b''
    redactor = console.Redactor(credentials)
    def emit(data):
        if not filtered or (b'LogCore: Warning' not in data and b'LogUObjectBase: Error' not in data):
            sys.stdout.buffer.write(redactor.feed(data, final=data.endswith(b'\n')))
            sys.stdout.buffer.flush()
    while not finished.wait(0.1):
        try:
            metadata = path.stat()
            current = (metadata.st_dev, metadata.st_ino)
            if identity is not None and (identity != current or metadata.st_size < position):
                if pending: emit(pending)
                pending, position = b'', 0
            identity = current
            with path.open('rb') as source:
                source.seek(position)
                data = source.read(65536)
                position = source.tell()
            pending += data
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                emit(line + b'\n')
            if len(pending) > 65536:
                # Bound memory without silently dropping diagnostics from long native lines.
                emit(pending)
                pending = b''
        except FileNotFoundError: pass
    if pending: emit(pending)
    sys.stdout.buffer.write(redactor.feed(b'', final=True))
    sys.stdout.buffer.flush()


def launch(root, game, env):
    root = Path(root).resolve()
    # Gate missing native identities/password files before any update or Wine preparation.
    configure(root, game, env)
    if boolean(env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'))): install(root, game, env)
    child = wine_environment(root, game, env)
    credentials = tuple(env.get(k, '') for k in ('SERVER_PASSWORD', 'ADMIN_PASSWORD', 'PLAYER_PASSWORD', 'INVITE_CODE'))
    finished = threading.Event()
    worker = threading.Thread(target=follow_log, args=(confined(root, GAMES[game][2]), finished, credentials, game == 'starrupture'), daemon=True)
    worker.start()
    try: return console.run(root, command(root, game, env), child, '^C', credentials=credentials, stop_signal=signal.SIGINT)
    finally:
        finished.set()
        worker.join(timeout=2)


if __name__ == '__main__':
    action, game = sys.argv[1:3]
    if action == 'install': install(Path.cwd(), game, dict(os.environ))
    elif action == 'run': sys.exit(launch(Path.cwd(), game, dict(os.environ)))
    else: raise ValueError('Unknown reviewed operation')
