#!/usr/bin/env python3
"""KissMP-only native-file authority, delegated to the shared racing adapter."""
import importlib.util
import json
import os
from pathlib import Path
import sys

CONTROLS = {
    'SERVER_NAME': ('server_name', str), 'DESCRIPTION': ('description', str),
    'MAP': ('map', str), 'MAX_PLAYERS': ('max_players', int),
    'TICKRATE': ('tickrate', int), 'MAX_CARS': ('max_vehicles_per_client', int),
    'PUBLIC_SERVER': ('show_in_server_list', bool),
    'UPNP_ENABLED': ('upnp_enabled', bool), 'REQUIRE_SCRIPTS': ('require_scripts', bool),
}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate KissMP JSON key')
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError('Non-finite KissMP JSON value')


def native_environment(root, env):
    """Validate before shared code can create backups or rewrite configuration."""
    root = Path(root).resolve()
    file = root / 'config.json'
    if file.is_symlink() or not file.resolve().is_relative_to(root):
        raise ValueError('KissMP config escapes volume')
    if file.exists() and not file.is_file():
        raise ValueError('KissMP config is not a regular file')
    data = json.loads(file.read_text(encoding='utf-8'), object_pairs_hook=unique_object,
                      parse_constant=reject_constant) if file.exists() else {}
    if not isinstance(data, dict):
        raise ValueError('KissMP config must be an object')
    effective = dict(env)
    for key, (native, kind) in CONTROLS.items():
        if native not in data:
            continue
        value = data[native]
        if type(value) is not kind:
            raise ValueError('Invalid KissMP native scalar type')
        if kind is str and (len(value) > 1024 or any(ord(c) < 32 or ord(c) == 127 for c in value)):
            raise ValueError('Invalid KissMP native text')
        if kind is int and not (0 if native == 'max_vehicles_per_client' else 1) <= value <= 255:
            raise ValueError('Invalid KissMP native integer')
        effective[key] = ''
    if 'server_identifier' in data and (type(data['server_identifier']) is not str or not data['server_identifier']):
        raise ValueError('Invalid KissMP native identity')
    return effective


def load_racing():
    # Deployed beside racing-native.py; the repository path supports offline tests.
    here = Path(__file__).resolve()
    file = here.with_name('racing-native.py')
    if not file.exists():
        file = here.parents[2] / 'internal/panel/game_library/scripts/racing-native.py'
    spec = importlib.util.spec_from_file_location('kissmp_shared_racing', file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def configure(root, env, racing=None):
    effective = native_environment(root, env)
    return (racing or load_racing()).configure(root, 'kissmp', effective)


def main():
    root = Path.cwd()
    configure(root, dict(os.environ))
    os.execv(str(root / 'kissmp-server'), [str(root / 'kissmp-server')])


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError):
        print('KissMP setup failed. Check native configuration and allocation.', file=sys.stderr)
        sys.exit(1)
