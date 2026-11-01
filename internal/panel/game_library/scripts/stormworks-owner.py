#!/usr/bin/env python3
"""Stormworks-only orchestration. Native XML owns settings after first seed."""
import os
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
import importlib.util


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Reviewed libraries have guarded CLI entry points; loading performs no acquisition.
vehicle = load('vehicle-sims')
shared = vehicle.shared


def preflight(root, env, acquisition=False):
    root = Path(root).resolve()
    vehicle.identity('stormworks', env)
    ports = shared.roles(env, [], offsets=(1,))
    name = vehicle.text(env, 'SERVER_NAME', 'Pterodactyl Stormworks', 255)
    password = vehicle.text(env, 'SERVER_PASSWORD', 'DefaultPassword', 30)
    players = vehicle.number(env, 'MAX_PLAYERS', 32, 1, 32)
    admin = vehicle.text(env, 'STEAM64_ID', '', 17)
    if admin and not re.fullmatch('[0-9]{17}', admin):
        raise ValueError('Invalid administrator SteamID64')
    automatic = env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '0'))
    if automatic not in ('0', '1'):
        raise ValueError('Invalid automatic update control')
    mode = env.get('INSTALL_MODE', 'steam')
    if mode not in ('steam', 'operator_files'):
        raise ValueError('Invalid installation source')
    target = shared.confined(root, root / 'server_data/server_config.xml')
    shared.confined(root, root / '.wine')
    shared.confined(root, root / 'server64.exe')
    template = Path(__file__).with_name('stormworks-default.xml').read_text(encoding='utf-8')
    document = vehicle.parse_xml(target.read_text(encoding='utf-8-sig') if target.exists() else template, 'server_data')
    if len(document.findall('admins')) > 1:
        raise ValueError('Ambiguous administrator groups')
    if target.exists():
        # Never rewrite operator XML to change a bind behind the file editor.
        if document.get('port') != str(ports['primary']):
            raise ValueError('Native XML port must match the primary allocation; edit the stopped native file')
        if not document.get('name') or not re.fullmatch('[0-9]+', document.get('max_players', '')) or not 1 <= int(document.get('max_players')) <= 32:
            raise ValueError('Invalid active native identity/player controls')
    if acquisition and mode == 'steam':
        # Shared private credential transport remains unavailable. Fail even if
        # credentials are supplied; do not attempt an anonymous substitute.
        raise ValueError('Licensed Steam acquisition requires unsupported private transport; upload legally acquired original files using operator_files')
    return target, document, dict(port=str(ports['primary']), name=name, password=password, max_players=str(players)), admin


def configure(root, env):
    target, document, values, admin = preflight(root, env)
    if target.exists():
        return document.get('password', '')
    document.attrib.update(values)
    # Keep the reviewed seed's world/gameplay defaults, including its save name.
    if not document.get('seed'):
        document.set('seed', str(vehicle.secrets.randbelow(999999999) + 1))
    if admin:
        group = document.find('admins')
        if group is None:
            group = ET.SubElement(document, 'admins')
        for item in list(group):
            if item.tag == 'id' and not item.get('value'):
                group.remove(item)
        ET.SubElement(group, 'id', {'value': admin})
    body = ('<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(document, encoding='unicode') + '\n').encode('utf-8')
    target.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation refuses a competing seed and never overwrites a file.
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(body)
    return values['password']


def install(root, env):
    preflight(root, env, acquisition=True)
    return vehicle.install(root, 'stormworks', env)


def run(root, env):
    root = Path(root).resolve()
    preflight(root, env, acquisition=env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '0')) == '1')
    # Reuse the reviewed PE/content validator before writing any configuration.
    if env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '0')) == '1' or env.get('INSTALL_MODE') == 'operator_files':
        install(root, env)
    if not shared.confined(root, root / 'server64.exe').is_file():
        raise ValueError('Missing legally acquired server64.exe')
    secret = configure(root, env)
    child = dict(env, HOME=str(root), WINEPREFIX=str(root / '.wine'), WINEDEBUG='-all')
    credentials = [secret] + [env.get(k, '') for k in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS'):
        child.pop(key, None)
    return load('native-console').run(root, ['xvfb-run', '-a', 'wine', str(root / 'server64.exe'), '+server_dir', str(root / 'server_data')], child, '\x03', credentials, terminal_input=True)


if __name__ == '__main__':
    try:
        action = sys.argv[1]
        if action == 'preflight':
            preflight(Path.cwd(), dict(os.environ), acquisition=True)
        elif action == 'install':
            install(Path.cwd(), dict(os.environ))
        elif action == 'run':
            code = run(Path.cwd(), dict(os.environ))
            sys.exit(code if code >= 0 else 128 - code)
        else:
            raise ValueError('Unknown action')
    except (ValueError, OSError, ET.ParseError) as error:
        print('Stormworks refused: ' + str(error), file=sys.stderr)
        sys.exit(1)
