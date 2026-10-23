#!/usr/bin/env python3
"""MIT. Typed original Eco, Foundry and FortressCraft dedicated recipes."""
import importlib.util
import codecs
import json
import os
from pathlib import Path
import re
import sys
import threading
import time
import urllib.parse


def helper(name):
    path = Path(__file__).with_name(name + '.py')
    if not path.exists():
        path = path.with_name(name.replace('-', '_') + '.py')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name.replace('-', '_')] = module
    spec.loader.exec_module(module)
    return module


shared = helper('steam-native-next')
steam = shared.steam
native = shared.native
GAMES = {'eco': (739590, 'EcoServer', 'linux'), 'foundry': (2915550, 'FoundryDedicatedServer.exe', 'windows'),
         'fortress': (443600, 'FC_Linux_Universal.x86_64', 'linux')}
FOUNDRY_CONFIG = {'url': 'https://dedicated.foundry-game.com/App.cfg',
                  'sha256': 'ee02ef3f800282c0338ed49675b24e559e5974209d62f81c2bd2b893bb426751', 'bytes': 178}


def text(env, key, default='', maximum=255):
    return shared.text(env, key, default, maximum)


def json_text(env, key, default='', maximum=500):
    value = env.get(key, default)
    if not isinstance(value, str) or len(value) > maximum or any((ord(c) < 32 and c not in '\n\t') or ord(c) == 127 for c in value):
        raise ValueError('Invalid ' + key)
    return value


def number(env, key, default, low=1, high=65535):
    value = str(env.get(key, default))
    if not re.fullmatch(r'-?[0-9]+', value) or not low <= int(value) <= high:
        raise ValueError('Invalid ' + key)
    return int(value)


def boolean(env, key, default='false'):
    value = text(env, key, default, 5)
    if value not in ('true', 'false'):
        raise ValueError('Invalid ' + key)
    return value == 'true'


def world(env, key, default):
    value = text(env, key, default, 100)
    if not value or value in ('.', '..') or any(c in value for c in '/\\:'):
        raise ValueError('World name must be a name, not a path')
    return value


def choice(env, key, default, values):
    value = text(env, key, default, 80)
    if value not in values:
        raise ValueError('Invalid ' + key)
    return value


def write_json(root, path, values):
    target = shared.confined(root, root / path)
    if not target.is_file():
        raise ValueError('Publisher JSON configuration is missing; reinstall first')
    config = shared.json_unique(target.read_text(encoding='utf-8-sig'))
    if not isinstance(config, dict):
        raise ValueError('Expected publisher JSON object')
    config.update(values)
    shared.write_config(root, target, json.dumps(config, ensure_ascii=False, indent=2) + '\n')


def seed(root, relative, source):
    target = shared.confined(root, root / relative)
    if target.exists():
        return False
    template = shared.confined(root, root / source)
    if not template.is_file():
        raise ValueError('Publisher configuration template is missing')
    native.private_write(target, template.read_text(encoding='utf-8-sig'))
    return True


def options(game, env):
    app, binary, platform = GAMES[game]
    if env.get('SRCDS_APPID', str(app)) != str(app):
        raise ValueError('Wrong dedicated Steam application')
    selected = dict(env)
    if game == 'fortress':
        selected.setdefault('SRCDS_BETAID', 'linux_server_headless')
    # Validate before creating files or downloading. Private Steam stays explicit
    # and unavailable; it is never silently converted to anonymous login.
    steam.arguments(Path('/volume'), app, selected, platform=platform)
    return selected


def install(root, game, env):
    root = Path(root).resolve()
    selected = options(game, env)
    app, binary, platform = GAMES[game]
    with shared.preserve(root):
        if game == 'foundry':
            steam.update(root, 1007, selected, platform='windows')
        steam.update(root, app, selected, required=(binary,), platform=platform)
        if game == 'eco':
            seed(root, 'Configs/Network.eco', 'Configs/Network.eco.template')
            seed(root, 'Configs/Localization.eco', 'Configs/Localization.eco.template')
        elif game == 'foundry':
            for directory in ('Mods', 'serverfiles'):
                shared.confined(root, root / directory).mkdir(parents=True, exist_ok=True)
            target = shared.confined(root, root / 'App.cfg')
            if not target.exists():
                asset = shared.confined(root, root / '.voltra/foundry-default.cfg')
                if not asset.exists():
                    shared.release.download(FOUNDRY_CONFIG, asset)
                if shared.release.sha256(asset) != FOUNDRY_CONFIG['sha256']:
                    raise ValueError('Foundry default configuration checksum mismatch')
                native.private_write(target, asset.read_text(encoding='utf-8-sig'))
        else:
            for filename in ('firstrun.ini', 'serveroverrides.ini'):
                created = seed(root, 'Default/' + filename, 'Default/Example Server Ini files/' + filename)
                if created and filename == 'firstrun.ini':
                    target = shared.confined(root, root / 'Default/firstrun.ini')
                    # Original publisher example uses Lua-style annotations.
                    # Clean only the freshly copied example, never operator data.
                    content = re.sub(r'(?m)^\s*--[^\r\n]*(?:\r?\n)?', '', target.read_text(encoding='utf-8-sig'))
                    native.private_write(target, re.sub(r'[ \t]+--[^\r\n]*', '', content))


def configure(root, game, env):
    root = Path(root).resolve()
    options(game, env)
    if game == 'eco':
        ports = shared.roles(env, ['WEB_PORT', 'RCON_PORT'])
        password, admin = text(env, 'SRV_PW', '', 255), text(env, 'RCON_PW', '', 255)
        user, account = text(env, 'SLG_USER', '', 255), text(env, 'SLG_PW', '', 4096)
        if not user or not account:
            raise ValueError('Original SLG account/license username and password are required')
        url = text(env, 'WEBSRVURL', '', 2048)
        if url and (urllib.parse.urlsplit(url).scheme not in ('http', 'https') or not urllib.parse.urlsplit(url).hostname):
            raise ValueError('Invalid Eco web-server URL')
        title = text(env, 'SRV_NAME', 'Eco dedicated server', 250)
        maximum = number(env, 'MAX_CON', -1, -1, 1000000)
        language = choice(env, 'LANGUAGE', 'English', ('English', 'French', 'German'))
        config = {'GameServerPort': ports['primary'], 'WebServerPort': ports['WEB_PORT'], 'RconServerPort': ports['RCON_PORT'],
                  'PublicServer': boolean(env, 'PUB_SRV'), 'Password': password, 'UPnPEnabled': boolean(env, 'UPNP'),
                  'Name': title, 'DetailedDescription': json_text(env, 'DEDES', '', 500), 'Playtime': text(env, 'PLAYTIME', '', 4096),
                  'DefaultSlots': maximum, 'DiscordAddress': text(env, 'DISCORD_SRV', '', 255), 'RconPassword': admin,
                  'ServerCategory': choice(env, 'SRV_CAT', 'None', ('None', 'Beginner', 'Established', 'BeginnerHard', 'Strange')),
                  'WebServerUrl': url}
        paths = [shared.confined(root, root / name) for name in ('Configs/Network.eco', 'Configs/Localization.eco')]
        previous, localization = [shared.json_unique(path.read_text(encoding='utf-8-sig')) for path in paths]
        if not isinstance(previous, dict) or not isinstance(localization, dict):
            raise ValueError('Expected publisher JSON objects')
        # Older publisher templates used these original egg keys. Keep their
        # behavior alongside the current publisher names when they are present.
        if 'Description' in previous:
            config['Description'] = title
        if 'MaxConnections' in previous:
            config['MaxConnections'] = maximum
        write_json(root, 'Configs/Network.eco', config)
        write_json(root, 'Configs/Localization.eco', {'Language': language})
        return [str(root / 'EcoServer'), '--username=' + user, '--password=' + account], [password, admin, user, account]
    if game == 'foundry':
        if text(env, 'WINETRICKS_RUN', 'mono', 255) != 'mono':
            raise ValueError('The reviewed original Wine recipe requires WINETRICKS_RUN=mono')
        if text(env, 'XVFB', '1') != '1':
            raise ValueError('The reviewed Foundry Wine path requires XVFB=1')
        text(env, 'WINEDEBUG', '-all', 255)
        ports = shared.roles(env, ['QUERY_PORT'])
        password = text(env, 'SRV_PW', '', 255)
        save = text(env, 'SAVE_PATH', '/home/container/serverfiles', 512).replace('\\', '/')
        if save.startswith('/home/container/'):
            save = save[len('/home/container/'):]
        if not save or save.startswith('/') or ':' in save or any(x in ('.', '..') for x in save.split('/')):
            raise ValueError('Foundry save path must remain in this server volume')
        target_save = shared.confined(root, root / save)
        target_save.mkdir(parents=True, exist_ok=True)
        # Wine sees its Unix filesystem via Z:, so the original Unix default is
        # converted to a usable Windows absolute path without escaping the volume.
        save_native = 'Z:' + str(target_save).replace('/', '\\')
        values = {'server_name': text(env, 'SERVER_NAME', 'Foundry dedicated server', 255), 'server_password': password,
                  'server_world_name': world(env, 'WORLD_NAME', 'MyFoundry'), 'server_max_players': number(env, 'MAX_PLAYERS', 32, 1, 1024),
                  'server_port': ports['primary'], 'server_query_port': ports['QUERY_PORT'],
                  'pause_server_when_empty': str(boolean(env, 'PAUSE_SERVER', 'true')).lower(),
                  'autosave_interval': number(env, 'AUTOSAVE_INTERVAL', 300, 1, 86400),
                  'server_is_public': str(boolean(env, 'PUBLIC_SERVER', 'true')).lower(),
                  'server_persistent_data_override_folder': save_native, 'mapseed': number(env, 'MAP_SEED', 42938743982, 0, 2**64 - 1)}
        path = shared.confined(root, root / 'App.cfg')
        old = path.read_text(encoding='utf-8-sig')
        if re.search(r'(?m)^\s*map_seed\s*=', old):
            values['map_seed'] = values['mapseed']
        shared.write_config(root, path, shared.patch_properties(old, values))
        return ['xvfb-run', '-a', 'wine', str(root / 'FoundryDedicatedServer.exe'), '-log'], [password]
    ports = shared.roles(env, ['RCON_PORT'])
    admin = text(env, 'RCON_PASSWORD', 'changeme', 255)
    first = {'Name': text(env, 'SERVER_NAME', 'FortressCraft dedicated server', 255),
             'Resources': choice(env, 'G_RESOURCE', 'scarce', ('rapid', 'plentiful', 'scarce', 'greg')),
             'Conveyors': choice(env, 'G_CONVEYOR', 'slow', ('slow', 'fast')),
             'Power': choice(env, 'G_POWER', 'scarce', ('scarce', 'plentiful')),
             'Day': choice(env, 'G_DAY', 'normal', ('eternal', 'normal', 'night'))}
    for field, key in [('CarePackage', 'G_CAREPACKAGE'), ('FlatLand', 'G_FLATLAND'), ('RushMode', 'G_RushMode')]:
        first[field] = str(boolean(env, key)).lower()
    override = {'RCONPort': str(ports['RCON_PORT']), 'RCONPassword': admin, 'ServerPort': str(ports['primary']),
                'MaxPlayers': str(number(env, 'MAX_PLAYERS', 64, 1, 64)), 'WorldName': world(env, 'WORLDNAME', 'WorldName'),
                'IsPublic': str(boolean(env, 'PUBLIC')).lower(), 'AutoPause': str(boolean(env, 'AUTO_PAUSE', 'true')).lower()}
    backups = shared.confined(root, root / '.voltra/automation-sims-config')
    for filename in ('firstrun.ini', 'serveroverrides.ini'):
        shared.confined(root, root / 'Default' / filename)
    native.configure_ini(root, root / 'Default/firstrun.ini', {'config': first}, backups)
    native.configure_ini(root, root / 'Default/serveroverrides.ini', {'config': override}, backups)
    return [str(root / 'FC_Linux_Universal.x86_64'), '-batchmode', '-nographics', '-logFile', str(root / 'unity.log')], [admin]


def follow_unity(path, finished, credentials):
    redactor = steam.Redactor(credentials)
    decoder = codecs.getincrementaldecoder('utf-8')('replace')
    source = None
    try:
        while True:
            if source is None:
                if not path.exists():
                    if finished.wait(0.1):
                        break
                    continue
                if path.is_symlink():
                    raise ValueError('Unity log must be a regular owned file')
                source = path.open(encoding='utf-8', errors='replace')
            line = source.readline(65536)
            if line and not re.search('Filename:|DebugBindings|buildslave|Line:', line):
                sys.stdout.write(decoder.decode(redactor.feed(line.encode('utf-8')))); sys.stdout.flush()
            if not line:
                if finished.is_set():
                    break
                finished.wait(0.1)
    finally:
        sys.stdout.write(decoder.decode(redactor.feed(b'', final=True), final=True)); sys.stdout.flush()
        if source is not None:
            source.close()


def run(root, game, env):
    root = Path(root).resolve()
    auto = choice({'AUTO_UPDATE': env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'))}, 'AUTO_UPDATE', '1', ('0', '1'))
    if auto == '1':
        install(root, game, env)
    argv, credentials = configure(root, game, env)
    environment = dict(os.environ)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH'):
        environment.pop(key, None)
    environment['HOME'] = str(root)
    finished = threading.Event()
    log_thread = None
    if game == 'foundry':
        environment.update(WINEPREFIX=str(root / '.wine'), WINEDEBUG=text(env, 'WINEDEBUG', '-all', 255))
        shared.confined(root, root / '.wine')
    if game == 'fortress':
        log = shared.confined(root, root / 'unity.log')
        if log.exists():
            archive = shared.confined(root, root / '.voltra/unity-log-history')
            archive.mkdir(parents=True, exist_ok=True)
            log.rename(archive / (str(time.time_ns()) + '.log'))
        log_thread = threading.Thread(target=follow_unity, args=(log, finished, credentials), daemon=True)
        log_thread.start()
    try:
        code = helper('native-console').run(root, argv, environment, 'exit' if game == 'eco' else '\x03', credentials, terminal_input=True)
        return code if code >= 0 else 128 - code
    finally:
        finished.set()
        if log_thread is not None:
            log_thread.join(timeout=2)


if __name__ == '__main__':
    try:
        action, game = sys.argv[1:3]
        if action == 'install':
            install(Path.cwd(), game, dict(os.environ))
        elif action == 'run':
            sys.exit(run(Path.cwd(), game, dict(os.environ)))
        else:
            raise ValueError('Unknown action')
    except (ValueError, OSError, KeyError):
        print('Dedicated setup failed: review typed settings, selected allocations, required publisher license/account and public Steam branch. Private Steam credentials remain unsupported.', file=sys.stderr)
        sys.exit(1)
