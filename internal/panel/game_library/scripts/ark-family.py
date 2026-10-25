#!/usr/bin/env python3
"""MIT. ARK edition-specific typed configuration, Steam acquisition and RCON lifecycle."""
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time


def helper(name):
    path = Path(__file__).with_name(name + '.py')
    if not path.exists():
        path = path.with_name(name.replace('_', '-') + '.py')
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


steam = helper('steam_template')
native = helper('native_config')
GAMES = {
    'evolved': (376030, 'linux', 'ShooterGame/Binaries/Linux/ShooterGameServer'),
    'ascended': (2430930, 'windows', 'ShooterGame/Binaries/Win64/ArkAscendedServer.exe'),
    'pixark': (824360, 'windows', 'ShooterGame/Binaries/Win64/PixARKServer.exe'),
}


def confined(root, name):
    root = Path(root).resolve()
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValueError('ARK path leaves the server volume')
    for parent in path.parents:
        if parent == root:
            break
        if parent.is_symlink():
            raise ValueError('ARK path uses symbolic links')
    return path


def text(env, key, default='', maximum=4096):
    value = env.get(key, default)
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Invalid ' + key)
    return value


def integer(env, key, default, minimum=1, maximum=65535):
    value = str(env.get(key, default))
    if not re.fullmatch('[0-9]+', value) or not minimum <= int(value) <= maximum:
        raise ValueError('Invalid ' + key)
    return int(value)


def boolean(env, key, default=False):
    value = str(env.get(key, '1' if default else '0')).lower()
    if value not in ('0', '1', 'true', 'false'):
        raise ValueError('Invalid ' + key)
    return value in ('1', 'true')


def password(env, key, required=False, limit=128):
    value = text(env, key, '', limit)
    if (required and not value) or (value and not re.fullmatch('[A-Za-z0-9_-]+', value)):
        raise ValueError(key + ' requires an operator-chosen native alpha-dash password')
    return value


def url_value(value):
    # The native UE URL parser treats these as syntax even when exec uses literal argv.
    if any(c in value for c in '?"\\'):
        raise ValueError('Native ARK URL values cannot contain question marks, quotes or backslashes')
    return '"' + value + '"' if ' ' in value else value


def mod_ids(raw, dev=False):
    pattern = '[0-9]+(?:-dev)?' if dev else '[0-9]+'
    if not raw:
        return ''
    if not re.fullmatch(pattern + '(?:,' + pattern + ')*', raw):
        raise ValueError('Mod IDs must be ordered comma-separated numeric IDs' + (' with optional -dev suffix' if dev else ''))
    return ','.join(dict.fromkeys(raw.split(',')))


def parameters(raw):
    if not raw:
        return {}
    if not raw.startswith('?'):
        raise ValueError('ARGS_PARAMS must begin with ? and use native key=value entries')
    result = {}
    for item in raw[1:].split('?'):
        key, separator, value = item.partition('=')
        if not separator or not re.fullmatch('[A-Za-z][A-Za-z0-9_]*', key) or key.lower() in result:
            raise ValueError('Malformed or duplicate ARK URL parameter')
        url_value(value)
        result[key.lower()] = (key, value)
    return result


def flags(raw):
    result = shlex.split(raw)
    if len(result) > 128:
        raise ValueError('Too many native ARK flags')
    managed = ('port', 'queryport', 'rconport', 'cubeport', 'multihome', 'serveradminpassword',
               'serverpassword', 'rconenabled', 'sessionname', 'maxplayers', 'winlivemaxplayers')
    for value in result:
        if not value.startswith('-') or '?' in value or value.lstrip('-').split('=', 1)[0].lower() in managed:
            raise ValueError('Use the dedicated ARK listener/identity controls; additional values must be native -flags')
    return result


def ports(env, game):
    primary = integer(env, 'SERVER_PORT', 7777)
    raw = env.get('VOLTRA_ALLOCATED_PORTS', '')
    if not re.fullmatch('[0-9]+(?:,[0-9]+)*', raw):
        raise ValueError('Missing ARK allocations')
    available = {int(value) for value in raw.split(',')}
    if primary not in available or any(not 1 <= value <= 65535 for value in available):
        raise ValueError('Invalid ARK allocations')
    used = {primary}
    result = {'Port': primary}
    if game != 'pixark':
        if primary + 1 not in available:
            raise ValueError('ARK requires primary-plus-one peer allocation')
        used.add(primary + 1)

    def take(key, role, optional=False, query_pair=False):
        value = env.get(key, '')
        if optional and value in ('', '0'):
            return
        if value:
            value = integer(env, key, 0)
        else:
            candidates = sorted(available - used)
            if query_pair:
                candidates = [p for p in candidates if p - 1 in available - used and p > 1]
            if not candidates:
                raise ValueError('Missing allocated ARK listener role: ' + key)
            value = candidates[0]
        required = {value - 1, value} if query_pair else {value}
        if not required <= available or required & used or 0 in required:
            raise ValueError('ARK roles and query companion require distinct selected allocations')
        used.update(required)
        result[role] = value

    if game == 'pixark':
        take('QPORT', 'QueryPort', query_pair=True)
        take('RCPORT', 'RCONPort')
        take('CUBEPORT', 'CubePort')
    else:
        take('QUERY_PORT', 'QueryPort', optional=game == 'ascended')
        take('RCON_PORT', 'RCONPort')
    return result


def build(root, game, env):
    listeners = ports(env, game)
    admin = password(env, 'ARK_ADMIN_PASSWORD', required=True)
    join_key = 'SERVER_PASSWORD' if game == 'ascended' else 'ARK_PASSWORD'
    join = password(env, join_key)
    maximum = integer(env, 'MAX_PLAYERS', 70 if game == 'ascended' else 10 if game == 'pixark' else 12,
                      1, 200 if game == 'ascended' else 9999 if game == 'pixark' else 2147483647)
    name = text(env, 'SRV_NAME' if game == 'pixark' else 'SESSION_NAME', 'ARK Server', 256)
    if game == 'pixark' and not re.fullmatch('[A-Za-z0-9_-]{1,30}', name):
        raise ValueError('Original PixARK world/server name must be a safe name without spaces')
    url_value(name)
    map_name = text(env, 'SERVER_MAP', 'TheIsland_WP' if game == 'ascended' else 'TheIsland', 128) if game != 'pixark' else 'CubeWorld_Light'
    if not re.fullmatch('[A-Za-z0-9_./-]+', map_name) or '..' in map_name.split('/'):
        raise ValueError('Invalid native ARK map identifier')
    values = {'SessionName': name, 'ServerPassword': join, 'ServerAdminPassword': admin,
              'RCONEnabled': 'True', 'RCONPort': str(listeners['RCONPort']), 'MaxPlayers': str(maximum)}
    if game == 'pixark':
        values.update(DelayRegisterServer='True', bRawSockets='True', AltSaveDirectoryName='PteroPixArk')
    else:
        values['Port'] = str(listeners['Port'])
        if 'QueryPort' in listeners:
            values['QueryPort'] = str(listeners['QueryPort'])
    mods = mod_ids(text(env, 'MOD_IDS' if game == 'ascended' else 'MOD_ID'), dev=game == 'ascended') if game != 'pixark' else ''
    if game == 'evolved':
        values['GameModIds'] = mods
    extra_secrets = []
    if game == 'ascended':
        values['ServerPVE'] = 'True' if boolean(env, 'SERVER_PVE', True) else 'False'
        for lower, (key, value) in parameters(text(env, 'ARGS_PARAMS')).items():
            if lower in {key.lower() for key in values} or lower in ('queryport', 'cubeport', 'multihome'):
                raise ValueError('Configure managed ARK URL parameters through their dedicated controls')
            values[key] = value
            if any(word in lower for word in ('pass', 'token', 'auth', 'secret')):
                extra_secrets.append(value)
    url = map_name + '?listen' + ''.join('?' + key + '=' + url_value(value) for key, value in values.items())
    if game == 'pixark':
        args = [url, '-Seed=12345', '-OreSeed=1234', '-ConfigsUseAltDir', '-server', '-gameplaylogging', '-log',
                '-CULTUREFORCOOKING=en', '-NoBattlEye', '-QueryPort=' + str(listeners['QueryPort']),
                '-Port=' + str(listeners['Port']), '-CubePort=' + str(listeners['CubePort']),
                '-cubeworld=' + name, '-nosteamclient', '-NoHangDetection']
    elif game == 'ascended':
        args = [url, '-WinLiveMaxPlayers=' + str(maximum), '-oldconsole', '-servergamelog',
                '-Port=' + str(listeners['Port'])]
        if mods:
            args.append('-mods=' + mods)
        if not boolean(env, 'BATTLE_EYE', True):
            args.append('-NoBattlEye')
        args += flags(text(env, 'ARGS_FLAGS'))
    else:
        args = [url, '-server', '-automanagedmods', *flags(text(env, 'ARGS')), '-log']
        if not boolean(env, 'BATTLE_EYE', True):
            args.append('-NoBattlEye')
    binary = confined(root, GAMES[game][2])
    for arg in args:
        key, separator, value = arg.partition('=')
        if separator and any(word in key.lower() for word in ('pass', 'token', 'auth', 'secret')):
            extra_secrets.append(value)
    config = 'ShooterGame/Saved/' + ('PteroPixArk/' if game == 'pixark' else '') + 'Config/' + ('LinuxServer' if game == 'evolved' else 'WindowsServer') + '/GameUserSettings.ini'
    settings = {'ServerAdminPassword': admin, 'ServerPassword': join, 'RCONEnabled': 'True',
                'RCONPort': str(listeners['RCONPort'])}
    if game == 'evolved':
        settings['ActiveMods'] = mods
    if game == 'ascended':
        settings['ServerPVE'] = values['ServerPVE']
    return {'binary': binary, 'args': args, 'ports': listeners, 'config': config,
            'sections': {'ServerSettings': settings, '/Script/Engine.GameSession': {'MaxPlayers': str(maximum)},
                         'SessionSettings': {'SessionName': name}}, 'password': admin,
            'credentials': [admin, join, *extra_secrets] + [env.get(key, '') for key in ('STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')],
            'log': confined(root, 'ShooterGame/Saved/Logs/ShooterGame.log')}


def configure(root, game, env):
    plan = build(root, game, env)
    path = confined(root, plan['config'])
    previous = path.read_text(encoding='utf-8-sig') if path.exists() else ''
    updated = native.patch_ini(previous, plan['sections'])
    if updated != previous:
        if previous:
            backup = confined(root, '.voltra/ark/config-backups/' + str(time.time_ns()) + '-GameUserSettings.ini')
            native.private_write(backup, previous)
        native.private_write(path, updated)
    else:
        path.chmod(0o600)
    return plan


def steam_options(game, env):
    app, platform, binary = GAMES[game]
    if integer(env, 'SRCDS_APPID', app, 1, 2147483647) != app:
        raise ValueError('Choose the matching ARK edition recipe rather than another Steam app ID')
    windows = boolean(env, 'WINDOWS_INSTALL', platform == 'windows')
    if windows != (platform == 'windows'):
        raise ValueError('This ARK runtime requires its matching native Linux/Windows Steam depot')
    # Preserve all original transport controls. The shared parser rejects unsupported
    # private credentials, beta passwords and arbitrary INSTALL_FLAGS before spawning.
    options = {key: env.get(key, '') for key in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAID', 'SRCDS_BETAPASS', 'INSTALL_FLAGS')}
    return app, platform, binary, options


def engine_steam(root):
    """Expose the reviewed SteamCMD bootstrap at ASE's original auto-mod path."""
    source = confined(root, '.voltra/steamcmd')
    if not (source / 'steamcmd.sh').is_file():
        raise ValueError('Reviewed SteamCMD bootstrap is missing for ASE automatic mods')
    parent = confined(root, 'Engine/Binaries/ThirdParty/SteamCMD')
    parent.mkdir(parents=True, exist_ok=True)
    target = parent / 'Linux'
    if target.is_symlink():
        raise ValueError('ARK automatic mod SteamCMD must remain a real directory for native relative paths')
    if target.exists():
        if not (target / 'steamcmd.sh').is_file():
            raise ValueError('Existing ARK auto-mod SteamCMD directory is incomplete; retain it for operator review')
    else:
        with tempfile.TemporaryDirectory(prefix='.ark-steam-', dir=parent) as directory:
            stage = Path(directory) / 'ready'
            stage.mkdir()
            for name in ('steamcmd.sh', 'linux32', 'linux64'):
                original = confined(root, '.voltra/steamcmd/' + name)
                if original.is_dir():
                    # Shared SteamCMD bootstrap is public Valve content. Reject foreign links.
                    for item in original.rglob('*'):
                        confined(root, item.relative_to(root))
                    shutil.copytree(original, stage / name)
                elif original.is_file():
                    shutil.copy2(original, stage / name)
            destination = confined(root, 'Steam/steamapps')
            destination.mkdir(parents=True, exist_ok=True)
            (stage / 'steamapps').symlink_to('../../../../../Steam/steamapps', target_is_directory=True)
            os.replace(stage, target)


def install(root, game, env):
    app, platform, binary, options = steam_options(game, env)
    # Validate unsupported transport before backing up files or downloading anything.
    steam.arguments(root, app, options, platform=platform, force_platform=True)
    saved = confined(root, 'ShooterGame/Saved')
    configs = [path for path in saved.rglob('*.ini') if path.is_file()] if saved.exists() else []
    with tempfile.TemporaryDirectory(prefix='voltra-ark-config-', dir=confined(root, '.')) as directory:
        backups = []
        for index, path in enumerate(configs):
            path = confined(root, path.relative_to(root))
            backup = Path(directory) / str(index)
            shutil.copy2(path, backup)
            backups.append((path.relative_to(root), backup))
        try:
            steam.update(root, app, options, validate=True, required=(binary,), platform=platform, force_platform=True)
        finally:
            for name, backup in backups:
                target = confined(root, name)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(backup, target)
    if game == 'evolved':
        engine_steam(root)
    if game == 'ascended':
        helper('enshrouded_proton').provision(root)
    # Preserve downloaded movie assets and historical logs. No rm -rf Movies or
    # fresh-install log marker overwrites operator content from the original egg.
    log = confined(root, 'ShooterGame/Saved/Logs')
    log.mkdir(parents=True, exist_ok=True)


def environment(root, game, env):
    result = {key: value for key, value in env.items() if key not in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH')
              and not any(word in key for word in ('PASSWORD', 'STEAM_PASS', 'STEAM_AUTH', 'BETAPASS'))}
    result.update(HOME=str(root), SteamAppId='593600' if game == 'pixark' else '346110' if game == 'evolved' else '2399830')
    if game == 'ascended':
        for key, name in [('STEAM_COMPAT_CLIENT_INSTALL_PATH', '.steam/steam'), ('STEAM_COMPAT_DATA_PATH', '.steam/steam/steamapps/compatdata/2430930')]:
            path = confined(root, name)
            path.mkdir(parents=True, exist_ok=True)
            result[key] = str(path)
        result['WINEPREFIX'] = str(confined(root, '.steam/steam/steamapps/compatdata/2430930/pfx'))
        result['LD_LIBRARY_PATH'] = str(confined(root, '.voltra/proton/lib')) + ':' + str(confined(root, '.steam/sdk64'))
    elif game == 'pixark':
        if text(env, 'WINEARCH', 'win64') != 'win64':
            raise ValueError('PixARK requires the original win64 Wine architecture')
        requested = text(env, 'VOLTRA_ARK_WINETRICKS_RUN', env.get('WINETRICKS_RUN', 'vcrun2019 dotnet6'))
        if requested and not boolean(env, 'WINE_PREREQUISITES_READY'):
            raise ValueError('Original PixARK Winetricks prerequisites are not automatically installed. Prepare the private .voltra/ark/pixark-prefix with the legitimately obtained dependencies requested by WINETRICKS_RUN, then explicitly set WINE_PREREQUISITES_READY=1; no installer agreement is accepted for you.')
        prefix = confined(root, '.voltra/ark/pixark-prefix')
        if requested and not (prefix / 'system.reg').is_file():
            raise ValueError('Prepared private PixARK Wine prefix is missing')
        prefix.mkdir(parents=True, exist_ok=True)
        result['WINEPREFIX'] = str(prefix)
        result['WINEDEBUG'] = text(env, 'WINEDEBUG', '-all', 100)
        result['WINEARCH'] = 'win64'
        result['WINEPATH'] = text(env, 'WINEPATH', '/home/container', 200)
    return result


def packet(identifier, kind, body):
    payload = struct.pack('<ii', identifier, kind) + body.encode('utf-8') + b'\0\0'
    return struct.pack('<i', len(payload)) + payload


def read_packet(connection):
    def exact(count):
        value = b''
        while len(value) < count:
            part = connection.recv(count - len(value))
            if not part:
                raise EOFError('ARK RCON connection closed')
            value += part
        return value
    size, = struct.unpack('<i', exact(4))
    if not 10 <= size <= 65536:
        raise ValueError('Invalid ARK RCON frame length')
    data = exact(size)
    if data[-2:] != b'\0\0':
        raise ValueError('Invalid ARK RCON frame terminator')
    identifier, kind = struct.unpack('<ii', data[:8])
    return identifier, kind, data[8:-2].decode('utf-8', 'strict')


def command(port, password, value, allow_disconnect=False, timeout=2):
    if not value or len(value.encode('utf-8')) > 8192 or any(c in value for c in '\0\r\n'):
        raise ValueError('Invalid native ARK RCON command')
    with socket.create_connection(('127.0.0.1', port), timeout=timeout) as connection:
        connection.settimeout(timeout)
        connection.sendall(packet(901, 3, password))
        for _ in range(4):
            identity, kind, body = read_packet(connection)
            if identity == -1:
                raise ValueError('ARK RCON authentication rejected')
            if identity == 901 and kind == 2:
                break
        else:
            raise ValueError('ARK RCON authentication response missing')
        connection.sendall(packet(902, 2, value))
        replies = []
        for _ in range(16):
            try:
                identity, kind, body = read_packet(connection)
            except EOFError:
                if replies or allow_disconnect:
                    return ''.join(replies)
                raise
            except socket.timeout:
                if replies:
                    return ''.join(replies)
                raise
            if identity == -1:
                raise ValueError('ARK RCON command rejected')
            if identity == 902 and kind == 0:
                replies.append(body)
                if sum(len(reply.encode('utf-8')) for reply in replies) > 262144:
                    raise ValueError('ARK RCON response exceeds its bounded console limit')
                connection.settimeout(min(timeout, .15))
        if replies:
            return ''.join(replies)
        raise ValueError('ARK RCON command response missing')


def native_pids(root, game, proc=Path('/proc')):
    binary = str(root / GAMES[game][2])
    expected = {binary.casefold(), ('Z:' + binary.replace('/', '\\')).casefold()}
    result = []
    for path in proc.iterdir():
        if not path.name.isdigit():
            continue
        try:
            if path.stat().st_uid != os.getuid():
                continue
            first = (path / 'cmdline').read_bytes().split(b'\0', 1)[0].decode('utf-8', 'strict')
            if first.casefold() in expected:
                result.append(int(path.name))
        except (OSError, UnicodeError):
            pass
    return result


def run(root, game, plan, env):
    argv = [str(plan['binary']), *plan['args']]
    if game == 'ascended':
        argv = [str(helper('enshrouded_proton').location(root)), 'run', *argv]
    elif game == 'pixark':
        wine = shutil.which('wine')
        if not wine:
            raise ValueError('The selected pinned Wine runtime does not provide wine')
        argv = [wine, *argv]
    if not plan['binary'].is_file():
        raise ValueError('ARK dedicated server binary is missing; install this exact edition first')
    stopped, finished = threading.Event(), threading.Event()
    old = {sig: signal.signal(sig, lambda *_: stopped.set()) for sig in (signal.SIGINT, signal.SIGTERM)}
    child = None
    lock = threading.Lock()
    readers = []
    redactor = steam.Redactor(plan['credentials'])
    log_redactor = steam.Redactor(plan['credentials'])
    stdout_redactor = steam.Redactor(plan['credentials'])

    def emit(data, source_redactor=redactor):
        with lock:
            sys.stdout.buffer.write(source_redactor.feed(data, final=data.endswith(b'\n')))
            sys.stdout.buffer.flush()

    offset = plan['log'].stat().st_size if plan['log'].exists() else 0

    def logs():
        nonlocal offset
        identity = None
        while not finished.wait(.2):
            try:
                path = confined(root, plan['log'].relative_to(root))
                stat = path.stat()
                current = (stat.st_dev, stat.st_ino)
                if identity is not None and current != identity or stat.st_size < offset:
                    offset = 0
                identity = current
                with path.open('rb') as stream:
                    stream.seek(offset)
                    data = stream.read(65536)
                    offset = stream.tell()
                if data:
                    emit(data, log_redactor)
            except FileNotFoundError:
                pass

    def console():
        for line in sys.stdin:
            value = line.rstrip('\r\n')
            if finished.is_set():
                return
            try:
                reply = command(plan['ports']['RCONPort'], plan['password'], value)
                emit((reply + '\n').encode())
            except (OSError, ValueError, EOFError):
                emit(b'ARK console command failed; authenticated RCON is not available.\n')

    try:
        child = subprocess.Popen(argv, cwd=plan['binary'].parent if game != 'ascended' else root, env=env,
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        def stdout():
            for line in iter(child.stdout.readline, b''):
                emit(line, stdout_redactor)
        for target in (stdout, logs, console):
            reader = threading.Thread(target=target, daemon=True)
            reader.start();readers.append(reader)
        ready, shutdown, deadline = False, False, None
        started = time.monotonic()
        while True:
            live = native_pids(root, game) if game != 'evolved' else []
            if child.poll() is not None and not live:
                # Windows launchers can detach before the actual .exe appears.
                if game == 'evolved' or ready or child.returncode != 0 or time.monotonic() - started > 15:
                    break
            if stopped.is_set() and not shutdown:
                shutdown = True
                deadline = time.monotonic() + 120
                try:
                    command(plan['ports']['RCONPort'], plan['password'], 'SaveWorld', timeout=10)
                    if game == 'ascended':
                        command(plan['ports']['RCONPort'], plan['password'], 'KeepAlive', timeout=5)
                    command(plan['ports']['RCONPort'], plan['password'], 'DoExit', allow_disconnect=True, timeout=10)
                    emit(b'ARK native SaveWorld/DoExit requested; waiting for actual process exit.\n')
                except (OSError, ValueError, EOFError):
                    emit(b'ARK graceful RCON shutdown failed; native persistence is not confirmed.\n')
                    deadline = time.monotonic() + 10
            if deadline and time.monotonic() >= deadline:
                emit(b'ARK stop timed out; terminating only owned native processes. Save completion is unconfirmed.\n')
                for pid in live:
                    try:
                        os.kill(pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL);child.wait()
                return 1
            if not ready and not stopped.is_set():
                try:
                    command(plan['ports']['RCONPort'], plan['password'], 'ListPlayers', timeout=.3)
                    ready = True
                    emit(b'VOLTRA_ARK_READY authenticated native ListPlayers response; gameplay not tested.\n')
                except (OSError, ValueError, EOFError):
                    pass
            time.sleep(.2)
        return child.returncode if child.returncode >= 0 else 128 - child.returncode
    finally:
        finished.set()
        if child is not None and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL);child.wait()
        for pid in native_pids(root, game) if game != 'evolved' else []:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        for reader in readers[:2]:
            reader.join(timeout=2)
        with lock:
            for source_redactor in (redactor, log_redactor, stdout_redactor):
                sys.stdout.buffer.write(source_redactor.feed(b'', final=True))
            sys.stdout.buffer.flush()
        for sig, handler in old.items():
            signal.signal(sig, handler)


def main():
    action, game = sys.argv[1:]
    if game not in GAMES or action not in ('install', 'run'):
        raise ValueError('Unknown ARK edition/action')
    root = Path.cwd().resolve()
    env = dict(os.environ)
    if action == 'install':
        install(root, game, env)
        return 0
    # Validate ports/parameters/prerequisites before a potentially large update.
    build(root, game, env)
    child_env = environment(root, game, env)
    if boolean(env, 'VOLTRA_STEAM_AUTO_UPDATE', True):
        install(root, game, env)
    return run(root, game, configure(root, game, env), child_env)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'ARK operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
