#!/usr/bin/env python3
"""MIT. Typed original Stormworks, Carrier Command 2 and Archean setup."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import struct
import sys
import tempfile
import xml.etree.ElementTree as ET


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
steam, native = shared.steam, shared.native
GAMES = {'stormworks': (573090, 'server64.exe', 'windows'), 'carrier': (1489630, 'dedicated_server.exe', 'windows'),
         'archean': (3557220, 'Archean-game/Archean_server', 'linux')}
CARRIER_DEFAULT = '''<data port="25565" max_players="4" server_name="Carrier Command 2 Dedicated Server" password="" save_name="" island_count="16" island_count_per_team="1" carrier_count_per_team="1" team_count_ai="1" team_count_human="1" base_difficulty="1" loadout_type="0" blueprints="0" game_data_path="rom_0"><permissions/><active_mod_folders/></data>'''


def text(env, key, default='', maximum=255):
    return shared.text(env, key, default, maximum)


def number(env, key, default, minimum=0, maximum=2147483647):
    value = str(env.get(key, default))
    if not re.fullmatch(r'[0-9]+', value) or not minimum <= int(value) <= maximum:
        raise ValueError('Invalid ' + key)
    return int(value)


def bit(env, key, default='0'):
    value = text(env, key, default, 1)
    if value not in ('0', '1'):
        raise ValueError('Invalid ' + key)
    return value


def world(env, key, default=''):
    value = text(env, key, default, 100)
    if value in ('.', '..') or any(c in value for c in '/\\:'):
        raise ValueError('World/save selection must be a name, not a path')
    return value


def identity(game, env):
    app, _, platform = GAMES[game]
    if env.get('SRCDS_APPID', str(app)) != str(app):
        raise ValueError('Wrong original Steam application')
    if env.get('WINDOWS_INSTALL', '1' if platform == 'windows' else '0') != ('1' if platform == 'windows' else '0'):
        raise ValueError('Wrong reviewed native target platform')


def parse_xml(content, tag):
    if len(content.encode('utf-8')) > 8 * 1024 * 1024 or re.search(r'<!\s*(?:DOCTYPE|ENTITY)', content, re.I):
        raise ValueError('Unsupported or oversized native XML declaration')
    root = ET.fromstring(content, parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True)))
    if root.tag != tag:
        raise ValueError('Unexpected native XML root')
    return root


def xml_document(root, path, tag, defaults):
    target = shared.confined(root, root / path)
    return target, parse_xml(target.read_text(encoding='utf-8-sig') if target.exists() else defaults, tag)


def save_xml(root, target, document):
    content = '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(document, encoding='unicode') + '\n'
    shared.write_config(root, target, content)


def carrier_sdk(root):
    """Keep Valve's Windows SDK manifest isolated from the game install."""
    state = shared.confined(root, root / '.voltra/carrier-sdk')
    state.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='sdk-', dir=state) as folder:
        stage = Path(folder)
        steam.update(stage, 1007, {'WINDOWS_INSTALL': '1'}, required=(), platform='windows')
        payloads = {}
        for name in ('steamclient.dll', 'tier0_s.dll', 'vstdlib_s.dll'):
            found = [p for p in stage.rglob('*') if p.is_file() and p.name.lower() == name]
            if len(found) != 1 or found[0].is_symlink() or not found[0].resolve().is_relative_to(stage):
                raise ValueError('Missing or ambiguous Valve Windows SDK DLL')
            payloads[name] = found[0].read_bytes()
            if not payloads[name].startswith(b'MZ'):
                raise ValueError('Valve SDK DLL is not a Windows binary')
        # Validate every destination before publishing any DLL.
        for name in payloads:
            shared.confined(root, root / name)
        source = shared.confined(root, root / '.voltra/steamcmd/linux64/steamclient.so')
        if not source.is_file():
            raise ValueError('Linux Steam client library is missing')
        linux = source.read_bytes()
        shared.confined(root, root / 'linux64/steamclient.so')
        for name, data in payloads.items():
            steam._publish(root, name, lambda stream, value=data: stream.write(value))
    steam._publish(root, 'linux64/steamclient.so', lambda stream: stream.write(linux))


def operator_files(root, game):
    """Validate supplied licensed files without claiming publisher authenticity."""
    binary = GAMES[game][1]
    files = [binary]
    content = {'stormworks': 'rom', 'carrier': 'rom_0', 'archean': 'Archean-game'}[game]
    directory = shared.confined(root, root / content)
    if not directory.is_dir() or not any(directory.iterdir()):
        raise ValueError('Missing original operator-supplied game content directory')
    if game == 'carrier':
        files += ['steamclient.dll', 'tier0_s.dll', 'vstdlib_s.dll', 'linux64/steamclient.so']
    hashes = {}
    for name in files:
        path = shared.confined(root, root / name)
        if not path.is_file():
            raise ValueError('Missing operator-supplied executable or SDK library')
        with path.open('rb') as stream:
            header = stream.read(4096)
            if name.endswith(('.exe', '.dll')):
                offset = struct.unpack_from('<I', header, 60)[0] if len(header) >= 64 else 0
                machine = 0x8664 if game == 'stormworks' else 0x14c
                if offset < 64 or offset + 24 > len(header) or header[:2] != b'MZ' or header[offset:offset + 4] != b'PE\0\0' or struct.unpack_from('<H', header, offset + 4)[0] != machine:
                    raise ValueError('Operator Windows binary has wrong format or architecture')
            elif len(header) < 20 or header[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', header, 18)[0] != 62:
                raise ValueError('Operator Linux binary must be ELF x86-64')
            digest = hashlib.sha256(header)
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        hashes[name] = {'sha256': digest.hexdigest(), 'bytes': path.stat().st_size}
    # This separate inventory does not grant release ownership over uploaded files.
    state = shared.confined(root, root / '.voltra/vehicle-sims/operator-files.json')
    native.private_write(state, json.dumps({'game': game, 'origin': 'operator_files', 'publisher_authenticity_verified': False,
                                          'runtime_verified': False, 'files': hashes}, sort_keys=True) + '\n')


def install(root, game, env):
    root = Path(root).resolve()
    identity(game, env)
    app, binary, platform = GAMES[game]
    mode = env.get('INSTALL_MODE', 'steam')
    if mode == 'operator_files':
        operator_files(root, game)
        return
    if mode != 'steam':
        raise ValueError('Invalid installation mode')
    if game in ('stormworks', 'carrier'):
        # Both original recipes acquire licensed game content, not a public
        # anonymous dedicated tool. Do not invent a free anonymous substitute.
        if env.get('STEAM_USER', '') in ('', 'anonymous') or not env.get('STEAM_PASS'):
            raise ValueError('This original game-content download requires a legitimately owning Steam account; private Steam transport is not enabled')
    steam.arguments(root, app, env, platform=platform)
    with shared.preserve(root):
        steam.update(root, app, env, required=(binary,), platform=platform)
        if game == 'carrier':
            carrier_sdk(root)
        # No settings are reset during install. Typed configuration initializes
        # missing native data at launch and retains saves/mods/permissions.


def configure(root, game, env):
    root = Path(root).resolve()
    identity(game, env)
    if game == 'stormworks':
        ports = shared.roles(env, [], offsets=(1,))
        values = {'port': str(ports['primary']), 'name': text(env, 'SERVER_NAME', 'Pterodactyl Stormworks', 255),
                  'password': text(env, 'SERVER_PASSWORD', '', 255), 'max_players': str(number(env, 'MAX_PLAYERS', 32, 1, 32))}
        admin = text(env, 'STEAM64_ID', '', 17)
        if admin and not re.fullmatch(r'[0-9]{17}', admin):
            raise ValueError('Expected one SteamID64 administrator')
        template = Path(__file__).with_name('stormworks-default.xml').read_text(encoding='utf-8')
        target, document = xml_document(root, 'server_data/server_config.xml', 'server_data', template)
        state = shared.confined(root, root / '.voltra/stormworks-managed-admin.json')
        old_admin = json.loads(state.read_text()).get('steam_id', '') if state.exists() else ''
        groups = document.findall('admins')
        if len(groups) > 1:
            raise ValueError('Duplicate Stormworks administrator groups')
        group = groups[0] if groups else ET.SubElement(document, 'admins')
        if old_admin != admin:
            for child in list(group):
                if child.tag == 'id' and child.get('value', '') in ('', old_admin):
                    group.remove(child)
        if admin and not any(child.tag == 'id' and child.get('value') == admin for child in group):
            ET.SubElement(group, 'id', {'value': admin})
        for child in list(group):
            if child.tag == 'id' and not child.get('value'):
                group.remove(child)
        document.attrib.update(values)
        if not document.get('seed'):
            document.set('seed', str(secrets.randbelow(999999999) + 1))
        if not document.get('save_name'):
            document.set('save_name', 'autosave_server')
        save_xml(root, target, document)
        native.private_write(state, json.dumps({'steam_id': admin}) + '\n')
        return ['xvfb-run', '-a', 'wine', str(root / 'server64.exe'), '+server_dir', str(root / 'server_data')], [values['password']], root
    if game == 'carrier':
        ports = shared.roles(env, [], offsets=(1, 2, 3))
        values = {'port': str(ports['primary']), 'max_players': str(number(env, 'MAX_PLAYERS', 4, 1, 16)),
                  'server_name': text(env, 'SERVER_NAME', 'A Pterodactyl Hosted Server', 128),
                  'password': text(env, 'SERVER_PASSWORD', '', 64), 'save_name': world(env, 'SAVE_NAME')}
        for key, attribute, default, low, high in [('ISLAND_COUNT', 'island_count', 16, 4, 32), ('ISLAND_COUNT_PER_TEAM', 'island_count_per_team', 1, 1, 8),
                                                 ('CARRIER_COUNT_PER_TEAM', 'carrier_count_per_team', 1, 1, 4), ('TEAM_COUNT_AI', 'team_count_ai', 1, 0, 4),
                                                 ('TEAM_COUNT_HUMAN', 'team_count_human', 1, 1, 4), ('BASE_DIFFICULTY', 'base_difficulty', 0, 0, 2),
                                                 ('LOADOUT_TYPE', 'loadout_type', 0, 0, 2), ('BLUEPRINTS', 'blueprints', 0, 0, 1)]:
            values[attribute] = str(number(env, key, default, low, high))
        target, document = xml_document(root, 'server_config.xml', 'data', CARRIER_DEFAULT)
        document.attrib.update(values)
        save_xml(root, target, document)
        return ['wine', str(root / 'dedicated_server.exe')], [values['password']], root
    ports = shared.roles(env, [])
    mode, online = bit(env, 'GAME_MODE'), bit(env, 'ONLINE_MODE')
    spawn = text(env, 'SPAWN_PLANET', 'earth', 20)
    if spawn not in ('earth', 'moon'):
        raise ValueError('Invalid original Archean spawn body')
    values = {'server': {'server_public_name': text(env, 'SERVER_NAME', 'A Pterodactyl Hosted Server', 255),
                         'game_mode': mode, 'server_online': 'yes' if online == '1' else 'no',
                         'max_simultaneous_players': str(number(env, 'MAX_PLAYERS', 4, 1)),
                         'password': text(env, 'PASSWORD', '', 255), 'accept_remote_connections': 'yes'},
              'networking': {'listen_port': str(ports['primary'])},
              'game': {'spawn': spawn, 'world': world(env, 'WORLD_NAME'),
                       'auto_save_interval_seconds': str(number(env, 'AUTOSAVE_INTERVAL', 30)),
                       'updates_per_second': str(number(env, 'UPDATES_PER_SECOND', 25, 1)),
                       'physics_steps_per_update': str(number(env, 'PHYSICS_UPDATES_PER_UPDATE', 8, 1))}}
    target = shared.confined(root, root / 'Archean-data/server/server.ini')
    native.configure_ini(root, target, values, shared.confined(root, root / '.voltra/archean-config-history'))
    cwd = shared.confined(root, root / 'Archean-game')
    return [str(cwd / 'Archean_server')], [values['server']['password']], cwd


def run(root, game, env):
    root = Path(root).resolve()
    identity(game, env)
    automatic = env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1' if game == 'archean' else '0'))
    if automatic not in ('0', '1'):
        raise ValueError('Invalid automatic update control')
    if env.get('INSTALL_MODE', 'steam') not in ('steam', 'operator_files'):
        raise ValueError('Invalid installation mode')
    if automatic == '1':
        install(root, game, env)
    elif env.get('INSTALL_MODE') == 'operator_files':
        operator_files(root, game)
    binary = shared.confined(root, root / GAMES[game][1])
    if not binary.is_file():
        raise ValueError('Missing legitimately acquired native server executable')
    if game == 'carrier':
        prefix = shared.confined(root, root / '.wine/system.reg')
        if prefix.exists() and '#arch=win64' in prefix.read_text(encoding='utf-8', errors='replace')[:1024]:
            raise ValueError('Existing private prefix is win64; preserve it for administrator review, CC2 requires its original win32 prefix')
    argv, credentials, cwd = configure(root, game, env)
    environment = dict(os.environ)
    credentials += [env.get(k, '') for k in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    for name in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS'):
        environment.pop(name, None)
    environment['HOME'] = str(root)
    if game != 'archean':
        shared.confined(root, root / '.wine')
        environment.update(WINEPREFIX=str(root / '.wine'), WINEDEBUG='-all')
    if game == 'carrier':
        environment.update(WINEARCH='win32', SteamAppId='1489630', LD_LIBRARY_PATH=str(root / 'linux64'))
    code = helper('native-console').run(cwd, argv, environment, '\x03', credentials, terminal_input=True)
    return code if code >= 0 else 128 - code


if __name__ == '__main__':
    try:
        action, game = sys.argv[1:3]
        if action == 'install':
            install(Path.cwd(), game, dict(os.environ))
        elif action == 'run':
            sys.exit(run(Path.cwd(), game, dict(os.environ)))
        else:
            raise ValueError('Unknown action')
    except (ValueError, OSError, KeyError, ET.ParseError):
        print('Vehicle server setup failed: review typed config, allocated port block, original licensed game files and reviewed platform. Private Steam transport remains unsupported; no anonymous license substitute is used.', file=sys.stderr)
        sys.exit(1)
