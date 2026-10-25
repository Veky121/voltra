"""MIT. Typed native configuration for Citadel, Portal Knights and Solace Crafting."""
import hashlib
import copy
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import sys
import time
import steam_template
from native_config import patch_ini
from native_console import run

APPS = {'citadel': 489650, 'portal': 374040, 'solace': 1086950}
SOLACE = '.config/unity3d/Big Kitty Games/Solace Crafting'


def confined(root, relative):
    relative = str(relative)
    if not relative or '\\' in relative or PurePosixPath(relative).is_absolute() or any(p in ('.', '..') for p in PurePosixPath(relative).parts):
        raise ValueError('Expected a relative server-volume path')
    target = root / relative
    if not target.resolve().is_relative_to(root) or any(p.is_symlink() for p in (target, *target.parents) if p.is_relative_to(root)):
        raise ValueError('Server path must not traverse a symlink')
    return target


def citadel_path(root, relative):
    for alias in ('Citadel/Saved/Config/LinuxServer', 'Engine/Saved/Config/LinuxServer'):
        link = root / alias
        if (relative == alias or relative.startswith(alias + '/')) and link.is_symlink():
            if link.resolve() != root / 'Config':
                raise ValueError('Citadel legacy configuration link has an unexpected target')
            return confined(root, 'Config' + relative[len(alias):])
    return confined(root, relative)


def integer(value, low, high):
    if not re.fullmatch(r'[0-9]+', str(value)) or not low <= int(value) <= high:
        raise ValueError('Native numeric setting outside supported range')
    return int(value)


def boolean(value):
    if str(value).lower() not in ('true', 'false', '1', '0'):
        raise ValueError('Expected true/false or 1/0')
    return str(value).lower() in ('1', 'true')


def text(value, maximum=1024):
    if not isinstance(value, str) or len(value.encode()) > maximum or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Expected bounded single-line text')
    return value


def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError('Duplicate JSON setting')
        result[key] = value
    return result


def read_json(path):
    if path.stat().st_size > 4 * 1024 * 1024:
        raise ValueError('Native JSON exceeds four MiB')
    value = json.loads(path.read_text(encoding='utf-8-sig'), object_pairs_hook=pairs,
                       parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON')))
    if not isinstance(value, dict):
        raise ValueError('Native JSON must be an object')
    return value


def defaults():
    return json.loads(Path(__file__).with_name('fantasy_worlds_defaults.json').read_text())


def publish(root, relative, data, mode=0o600, metadata=None):
    return publish_stream(root, relative, lambda output: output.write(data), mode, metadata)


def publish_stream(root, relative, write, mode=0o600, metadata=None):
    target = confined(root, relative)
    inode = {}
    def writer(output):
        write(output)
        inode['value'] = os.fstat(output.fileno())
    steam_template._publish(root, relative, writer, default_mode=mode)
    if metadata:
        descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            actual = os.fstat(descriptor)
            if (actual.st_dev, actual.st_ino) != (inode['value'].st_dev, inode['value'].st_ino):
                raise ValueError('Configuration destination changed during publication')
            if os.geteuid() == 0:
                os.fchown(descriptor, metadata.st_uid, metadata.st_gid)
            os.fchmod(descriptor, metadata.st_mode & 0o777)
        finally:
            os.close(descriptor)


def update_file(root, path, data, private=True):
    metadata = path.stat() if path.exists() else None
    original = path.read_bytes() if metadata else None
    if original != data:
        if original is not None:
            publish(root, '.voltra/fantasy-worlds/backups/' + str(time.time_ns()) + '-' + path.name, original)
        publish(root, path.relative_to(root).as_posix(), data)
    if private:
        path.chmod(0o600)


def merge(target, values):
    for key, value in values.items():
        if isinstance(value, dict):
            if key not in target:
                target[key] = {}
            if not isinstance(target[key], dict):
                raise ValueError('Managed JSON object has incompatible type')
            merge(target[key], value)
        else:
            target[key] = value
    return target


def port_values(env, query_name=None):
    primary = integer(env.get('SERVER_PORT', ''), 1, 65535)
    allocated = {integer(value, 1, 65535) for value in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if value}
    if primary not in allocated:
        raise ValueError('Primary port must be selected from allocated ports')
    query = None
    if query_name:
        candidate = env.get(query_name, '27015' if query_name == 'QPORT' else '')
        if not candidate and query_name != 'QPORT':
            candidate = next(iter(sorted(allocated - {primary})), '')
        query = integer(candidate, 1025, 65535)
        if query == primary or query not in allocated:
            raise ValueError('Query port must select a distinct allocated port; locked legacy defaults are not silently remapped')
    return primary, query


def ini_string(value):
    return json.dumps(text(value), ensure_ascii=False)


def read_ini(path):
    if not path.exists():
        return None
    if path.stat().st_size > 4 * 1024 * 1024:
        raise ValueError('Native INI exceeds four MiB')
    return path.read_bytes().decode('utf-8-sig')


def world_tuple(content):
    matches = re.findall(r'(?mi)^\s*WorldCreationSettings\s*=\s*(.+?)\r?$', content)
    if len(matches) != 1:
        raise ValueError('Citadel requires exactly one WorldCreationSettings tuple')
    return matches[0]


def unreal_ini(content, sections):
    names = {name.casefold(): name for name in sections}
    actual = {}
    keys = {}
    section = None
    for line in content.splitlines():
        match = re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:[;#].*)?', line)
        if match:
            section = match.group(1)
            if section.casefold() in names:
                if section.casefold() in actual:
                    raise ValueError('Duplicate case-insensitive managed Unreal INI section')
                actual[section.casefold()] = section
        elif section and section.casefold() in names and '=' in line and not line.lstrip().startswith((';', '#')):
            key = line.split('=', 1)[0].strip()
            if key.casefold() in {name.casefold() for name in sections[names[section.casefold()]]}:
                identity = (section.casefold(), key.casefold())
                if identity in keys:
                    raise ValueError('Duplicate case-insensitive managed Unreal INI key')
                keys[identity] = key
    managed = {}
    for section, values in sections.items():
        managed[actual.get(section.casefold(), section)] = {
            keys.get((section.casefold(), key.casefold()), key): value for key, value in values.items()}
    return patch_ini(content, managed)


def citadel(root, env):
    primary, query = port_values(env, 'QPORT')
    admin = text(env.get('ADMIN_PASSWD', ''), 100)
    if not admin:
        raise ValueError('Set ADMIN_PASSWD before starting Citadel')
    central = confined(root, 'Config/Game.ini')
    native = citadel_path(root, 'Citadel/Saved/Config/LinuxServer/Game.ini')
    original = read_ini(central) or read_ini(native) or defaults()['citadel_game_ini']
    tuple_value = world_tuple(original)
    changes = {'UWorks': {'ConnectionPort': str(primary), 'QueryPort': str(query)},
               '/Script/Citadel.SocialManager': {'Password': ini_string(admin)}}
    content = unreal_ini(original, changes)
    # Config/Game.ini remains the original canonical file-manager entry point.
    updates = {central: content}
    for relative in ('Citadel/Saved/Config/LinuxServer/Game.ini', 'Engine/Saved/Config/LinuxServer/Game.ini'):
        path = citadel_path(root, relative)
        existing = read_ini(path) or original
        updates[path] = unreal_ini(existing, {**changes, '/Script/Citadel.CitadelGameInstance': {'WorldCreationSettings': tuple_value}})
    for relative in ('Config/Engine.ini', 'Citadel/Saved/Config/LinuxServer/Engine.ini', 'Engine/Saved/Config/LinuxServer/Engine.ini'):
        path = citadel_path(root, relative)
        updates[path] = unreal_ini(read_ini(path) or '', {'URL': {'Port': str(primary)}})
    # Validate all destinations before the first write; never remove native dirs.
    for path, value in updates.items():
        update_file(root, path, value.encode('utf-8'))
    passwords = re.findall(r'Password\s*=\s*"((?:\\.|[^"\\])*)"', tuple_value)
    credentials = [admin, *passwords, *[re.sub(r'\\(["\\])', r'\1', value) for value in passwords]]
    return root, ['/bin/bash', str(confined(root, 'CitadelServer.sh'))], '\x03', credentials, b'Steam Server initialized and registered with UWorks'


def portal_save_path(root, value):
    relative = value.get('basicServerData', {}).get('saveFolderPath', './savedata')
    if not isinstance(relative, str) or not relative or '\\' in relative or ':' in relative or PurePosixPath(relative).is_absolute():
        raise ValueError('Portal saveFolderPath must be a relative server-volume directory')
    while relative.startswith('./'):
        relative = relative[2:]
    return confined(root, 'dedicated_server/' + relative)


def portal(root, env):
    primary, _ = port_values(env)
    mode = env.get('GAMEMODE', 'Adventure')
    size = env.get('UNIVERSE_SIZE', 'Normal')
    if mode not in ('Adventure', 'Creative') or size not in ('Small', 'Normal', 'Large'):
        raise ValueError('Invalid Portal Knights mode or universe size')
    if env.get('WINEARCH', 'win64') not in ('win32', 'win64'):
        raise ValueError('Portal Knights requires a supported private Wine architecture')
    text(env.get('WINEDEBUG', '-all'), 64)
    path = confined(root, 'dedicated_server/server_config.json')
    value = read_json(path) if path.exists() else defaults()['portal']
    original = copy.deepcopy(value)
    portal_save_path(root, value)
    credentials = [text(env.get(name, default), 64) for name, default in (
        ('ADMIN_PASS', 'admin_password_please_change'), ('USER_PASS', ''), ('GUEST_PASS', ''))]
    values = {'basicServerData': {'name': text(env.get('SERVER_NAME', 'Servername'), 32), 'ipv4': '0.0.0.0', 'port': primary},
              'admins': {'credentials': {'password': credentials[0]}},
              'users': {'credentials': {'password': credentials[1]}},
              'guests': {'credentials': {'password': credentials[2]}},
              'gameplayMode': mode, 'universeSize': size, 'hideConsoleWindow': False}
    merge(value, values)
    if not path.exists() or value != original:
        update_file(root, path, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode())
    else:
        path.chmod(0o600)
    return root, [sys.executable, str(confined(root, '.voltra/fantasy_worlds_wine.py'))], '\x03', credentials, b'VOLTRA_PORTAL_READY'


def solace(root, env):
    primary, query = port_values(env, 'QUERY_PORT')
    path = confined(root, SOLACE + '/servercfg.dat')
    value = read_json(path) if path.exists() else defaults()['solace']
    original = copy.deepcopy(value)
    world = text(value.get('worldSaveToUse', 'MultiplayerWorld'), 200)
    if not world or '/' in world or '\\' in world or world in ('.', '..'):
        raise ValueError('Solace worldSaveToUse must be a plain world-folder name')
    for key in ('isPrivate', 'requireSteamID', 'allowAdmin', 'allowModerator'):
        if not isinstance(value.get(key), bool):
            raise ValueError('Solace access controls must be native JSON booleans')
    integer(value.get('maxPlayers'), 1, 1024)
    integer(value.get('autoRestart'), 0, 2147483647)
    credentials = [text(value.get(key, ''), 1024) for key in ('password', 'adminPassword', 'moderatorPassword')]
    value.update(port=primary, steamQueryPort=query)
    if not path.exists() or value != original:
        update_file(root, path, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode())
    else:
        path.chmod(0o600)
    return root, [str(confined(root, 'Solace Crafting.x86_64')), '-batchmode', '-nographics', '-logFile', '-'], '\x03', credentials, b' server started . (True)'


def configure(root, game, env):
    root = root.resolve()
    if game not in APPS:
        raise ValueError('Unknown fantasy-world recipe')
    if str(env.get('SRCDS_APPID', APPS[game])) != str(APPS[game]):
        raise ValueError('This recipe requires its original Steam application ID')
    if game == 'portal':
        selected = env.get('PORTAL_INSTALL_MODE', 'steam')
        if selected not in ('steam', 'uploaded'):
            raise ValueError('Choose Steam or legally uploaded Portal payload')
        validation = {key: value for key, value in env.items() if key not in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')} if selected == 'uploaded' else env
        steam_template.arguments(root, APPS[game], validation, platform='windows')
    cwd, argv, stop, credentials, ready = {'citadel': citadel, 'portal': portal, 'solace': solace}[game](root, env)
    blocked = {'STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS', 'ADMIN_PASSWD', 'ADMIN_PASS', 'USER_PASS', 'GUEST_PASS', 'PYTHONPATH', 'PYTHONHOME', 'LD_PRELOAD'}
    environment = {key: value for key, value in env.items() if key not in blocked}
    environment.update(HOME=str(root), XDG_CONFIG_HOME=str(root / '.config'), XVFB='0')
    if game == 'portal':
        environment.update(WINEPREFIX=str(confined(root, '.wine')), WINEARCH=env.get('WINEARCH', 'win64'), WINEDEBUG=env.get('WINEDEBUG', '-all'))
    else:
        environment['LD_LIBRARY_PATH'] = str(root / '.steam/sdk64') + ':' + str(root / 'linux64')
    return cwd, argv, environment, stop, credentials, ready


def main():
    from fantasy_worlds_install import install
    game = sys.argv[1]
    root = Path.cwd().resolve()
    env = dict(os.environ)
    os.umask(0o077)
    if boolean(env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'))):
        install(root, game, env, validate=False)
    cwd, argv, environment, stop, credentials, ready = configure(root, game, env)
    # Solace is a direct Linux executable: deliver the original Ctrl+C as a
    # native process-group signal rather than assuming PTY ETX is SIGINT.
    # Citadel and Portal retain their existing wrapper-specific stop behavior.
    shutdown = {'stop_signal': signal.SIGINT, 'terminal_query_reply': True} if game == 'solace' else {}
    return run(cwd, argv, environment, stop, credentials=credentials, ready_marker=ready, terminal_input=True, output_observer=lambda _: None, **shutdown)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('Fantasy-world startup failed; check selected ports, publisher payload, private Steam prerequisites and native configuration.', file=sys.stderr)
        sys.exit(1)
