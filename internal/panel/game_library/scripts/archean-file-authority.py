#!/usr/bin/env python3
"""Archean native settings authority; shared acquisition and console retained."""
import importlib.util
import os
from pathlib import Path
import re
import sys

DOCUMENT = 'Archean-data/server/server.ini'
CONTROLS = {
    'server': {'server_public_name': ('SERVER_NAME', 'A Pterodactyl Hosted Server'), 'game_mode': ('GAME_MODE', '0'),
               'server_online': ('ONLINE_MODE', '0'), 'max_simultaneous_players': ('MAX_PLAYERS', '4'), 'password': ('PASSWORD', '')},
    'game': {'spawn': ('SPAWN_PLANET', 'earth'), 'world': ('WORLD_NAME', ''), 'auto_save_interval_seconds': ('AUTOSAVE_INTERVAL', '30'),
             'updates_per_second': ('UPDATES_PER_SECOND', '25'), 'physics_steps_per_update': ('PHYSICS_UPDATES_PER_UPDATE', '8')}
}


def load_runtime():
    folder = Path(__file__).resolve().parent
    file = folder / 'vehicle-sims.py'
    if not file.exists():
        file = folder.parents[1] / 'internal/panel/game_library/scripts/vehicle-sims.py'
    spec = importlib.util.spec_from_file_location('vehicle_sims', file)
    runtime = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runtime)
    return runtime


def plan(runtime, root, environment):
    root = Path(root).resolve()
    runtime.identity('archean', environment)
    port = runtime.shared.roles(environment, [])['primary']
    target = runtime.shared.confined(root, root / DOCUMENT)
    if target.exists() and (not target.is_file() or target.stat().st_size > 8 * 1024 * 1024):
        raise ValueError('Invalid or oversized native settings')
    previous = target.read_bytes().decode('utf-8') if target.exists() else ''
    if previous.startswith('\ufeff'):
        raise ValueError('BOM-encoded Archean INI needs operator review')
    # Reject aliases rather than asserting undocumented native case semantics.
    expected = {**{s: set(v) for s, v in CONTROLS.items()}, 'networking': {'listen_port'}}
    expected['server'].add('accept_remote_connections')
    section = None
    seen_sections, seen = set(), {}
    for line in previous.lstrip('\ufeff').splitlines():
        match = re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:[;#].*)?', line)
        if match:
            section = match[1]
            if section.casefold() in expected:
                if section != section.casefold() or section in seen_sections:
                    raise ValueError('Ambiguous native section')
                seen_sections.add(section)
        elif section in expected and '=' in line and not line.lstrip().startswith(('#', ';')):
            key, value = line.split('=', 1)
            key = key.strip()
            if key.casefold() in expected[section]:
                if key != key.casefold() or (section, key) in seen:
                    raise ValueError('Ambiguous native setting')
                seen[section, key] = value.strip()
    effective = dict(environment)
    missing = {}
    for section, controls in CONTROLS.items():
        for key, (name, default) in controls.items():
            value = seen.get((section, key), str(environment.get(name, default)))
            if key == 'server_online':
                if (section, key) in seen:
                    if value not in ('yes', 'no'):
                        raise ValueError('Invalid native online flag')
                    value = '1' if value == 'yes' else '0'
                native_value = 'yes' if value == '1' else 'no'
            else:
                native_value = value
            effective[name] = value
            if (section, key) not in seen:
                missing.setdefault(section, {})[key] = native_value
    runtime.bit(effective, 'GAME_MODE')
    runtime.bit(effective, 'ONLINE_MODE')
    for name, default, minimum in [('MAX_PLAYERS', 4, 1), ('AUTOSAVE_INTERVAL', 30, 0), ('UPDATES_PER_SECOND', 25, 1), ('PHYSICS_UPDATES_PER_UPDATE', 8, 1)]:
        runtime.number(effective, name, default, minimum)
    runtime.text(effective, 'SERVER_NAME', '', 255)
    password = runtime.text(effective, 'PASSWORD', '', 255)
    if runtime.text(effective, 'SPAWN_PLANET', 'earth', 20) not in ('earth', 'moon'):
        raise ValueError('Invalid original Archean spawn body')
    runtime.world(effective, 'WORLD_NAME')
    if ('server', 'accept_remote_connections') in seen:
        if seen['server', 'accept_remote_connections'] not in ('yes', 'no'):
            raise ValueError('Invalid native remote connection flag')
    else:
        missing.setdefault('server', {})['accept_remote_connections'] = 'yes'
    missing.setdefault('networking', {})['listen_port'] = str(port)
    # Pure shared patch planning validates duplicates before any acquisition.
    runtime.native.patch_ini(previous, missing)
    runtime.shared.confined(root, root / '.voltra/archean-config-history')
    runtime.shared.confined(root, root / 'Archean-game')
    return target, missing, password


def run(runtime, root, environment):
    root = Path(root).resolve()
    plan(runtime, root, environment)
    automatic = environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '1'))
    if automatic not in ('0', '1') or environment.get('INSTALL_MODE', 'steam') not in ('steam', 'operator_files'):
        raise ValueError('Invalid runtime acquisition controls')
    if automatic == '1':
        runtime.install(root, 'archean', environment)
    elif environment.get('INSTALL_MODE') == 'operator_files':
        runtime.operator_files(root, 'archean')
    binary = runtime.shared.confined(root, root / 'Archean-game/Archean_server')
    if not binary.is_file():
        raise ValueError('Missing native executable')
    target, missing, password = plan(runtime, root, environment)
    runtime.native.configure_ini(root, target, missing, root / '.voltra/archean-config-history')
    child = dict(os.environ)
    credentials = [password] + [environment.get(k, '') for k in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    for name in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS'):
        child.pop(name, None)
    child['HOME'] = str(root)
    code = runtime.helper('native-console').run(binary.parent, [str(binary)], child, '\x03', credentials, terminal_input=True)
    return code if code >= 0 else 128 - code


if __name__ == '__main__':
    try:
        if sys.argv[1:] != ['run', 'archean']:
            raise ValueError('Archean runtime entrypoint only')
        sys.exit(run(load_runtime(), Path.cwd(), dict(os.environ)))
    except (ValueError, OSError, KeyError):
        print('Archean setup refused: review native settings, allocations and payload.', file=sys.stderr)
        sys.exit(1)
