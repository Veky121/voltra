#!/usr/bin/env python3
"""Banana-only native value authority; shared installer/console remain unchanged."""
import importlib.util
import os
from pathlib import Path
import sys


def load_runtime():
    folder = Path(__file__).resolve().parent
    if not (folder / 'light_games_next_runtime.py').exists() and not (folder / 'light-games-next-runtime.py').exists():
        folder = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
    for name in ('steam-template', 'native-config', 'native-console', 'light-games-next-runtime', 'light-games-next-install'):
        file = folder / (name.replace('-', '_') + '.py')
        if not file.exists():
            file = folder / (name + '.py')
        spec = importlib.util.spec_from_file_location(name.replace('-', '_'), file)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
    return sys.modules['light_games_next_runtime']


def native_environment(shared, root, environment, require_binary=False):
    root = Path(root).resolve()
    if environment.get('SRCDS_APPID', shared.APPS['banana']) != shared.APPS['banana']:
        raise ValueError('Banana Shooter requires its original server application')
    primary = shared.integer(environment.get('SERVER_PORT', ''), 1, 65535)
    ports = {shared.integer(value, 1, 65535) for value in environment.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if value}
    if primary not in ports:
        raise ValueError('Choose an allocated Banana Shooter port')
    target = shared.config_path(root, 'banana', environment)
    if target.exists() and not target.is_file():
        raise ValueError('Banana native settings must be a regular file')
    current = shared.read_config(target)
    for actual in current:
        if actual.lower() in ('server', 'browser') and actual not in ('Server', 'Browser'):
            raise ValueError('Ambiguous native Banana section identity')
    effective = dict(environment)
    server = current.get('Server', {})
    browser = current.get('Browser', {})
    if not isinstance(server, dict) or not isinstance(browser, dict):
        raise ValueError('Banana native settings sections must be objects')
    for section, names in ((server, ('Login_Token', 'STEAM_GSLT')), (browser, ('Server_Name',))):
        for actual in section:
            if any(actual.lower() == name.lower() and actual != name for name in names):
                raise ValueError('Ambiguous native Banana setting identity')
    if 'Server_Name' in browser:
        effective['SERVER_NAME'] = shared.text(browser['Server_Name'], 25)
    else:
        shared.text(effective.get('SERVER_NAME', 'BananaShooter'), 25)
    tokens = [shared.text(server[key], 256) for key in ('Login_Token', 'STEAM_GSLT') if key in server]
    if len(set(tokens)) > 1:
        raise ValueError('Ambiguous native Banana login-token aliases')
    if tokens:
        effective['STEAM_GSLT'] = tokens[0]
    else:
        shared.text(effective.get('STEAM_GSLT', ''), 256)
    binary = shared.confined(root, 'BSDS.x86_64')
    if binary.exists() and not binary.is_file():
        raise ValueError('Banana server executable must be a regular file')
    if require_binary and not binary.is_file():
        raise ValueError('Reinstall to restore the Banana server executable')
    return effective


def main(shared=None, installer=None):
    shared = shared or load_runtime()
    installer = installer or sys.modules['light_games_next_install'].install
    root = Path.cwd().resolve()
    environment = dict(os.environ)
    updating = shared.boolean(environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '1')))
    effective = native_environment(shared, root, environment, require_binary=not updating)
    if updating:
        installer(root, 'banana', effective, False)
        effective = native_environment(shared, root, environment, require_binary=True)
    argv, child, stop, credentials, ready = shared.configure(root, 'banana', effective)
    return shared.run(root, argv, child, stop, credentials=credentials,
                      ready_marker=ready.encode('utf-8'), terminal_input=True)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError):
        print('Banana setup failed. Review native settings, allocations and installation prerequisites.', file=sys.stderr)
        sys.exit(1)
