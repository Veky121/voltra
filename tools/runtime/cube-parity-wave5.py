#!/usr/bin/env python3
"""Cube-family read-only preflight before shared credential/config publication."""
import importlib.util
import os
from pathlib import Path
import re
import sys

KINDS = ('assaultcube', 'sauerbraten')


def load_runtime():
    folder = Path(__file__).resolve().parent
    if not (folder / 'cube_runtime.py').exists() and not (folder / 'cube-runtime.py').exists():
        folder = folder.parents[1] / 'internal/panel/game_library/scripts'
    for name in ('steam-template', 'cube-query', 'cube-runtime'):
        file = folder / (name.replace('-', '_') + '.py')
        if not file.exists():
            file = folder / (name + '.py')
        spec = importlib.util.spec_from_file_location(name.replace('-', '_'), file)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
    return module


def safe(root, relative, kind=None):
    current = root
    parts = Path(relative).parts
    for index, part in enumerate(parts):
        if part in ('.', '..') or Path(part).is_absolute():
            raise ValueError('Unsafe Cube path')
        current = current / part
        if current.is_symlink():
            raise ValueError('Cube managed paths cannot use symbolic links')
        if index < len(parts) - 1 and current.exists() and not current.is_dir():
            raise ValueError('Cube parent must be a directory')
    if not current.resolve().is_relative_to(root):
        raise ValueError('Cube managed path escapes volume')
    if current.exists() and kind == 'directory' and not current.is_dir():
        raise ValueError('Cube native directory is not a directory')
    if current.exists() and kind == 'file' and not current.is_file():
        raise ValueError('Cube native file is not a regular file')
    return current


def preflight(runtime, root, environment, kind):
    if kind not in KINDS:
        raise ValueError('Unknown Cube game')
    root = Path(root).resolve()
    port = int(environment['SERVER_PORT'])
    allocated = environment.get('VOLTRA_ALLOCATED_PORTS', '')
    if not re.fullmatch(r'[0-9]+(?:,[0-9]+)*', allocated):
        raise ValueError('Select native game and query allocations')
    ports = {int(value) for value in allocated.split(',')}
    if not 1 <= port <= 65534 or any(not 1 <= value <= 65535 for value in ports) or not {port, port + 1} <= ports:
        raise ValueError('Cube requires consecutive allocated game/query ports')
    public = environment.get('PUBLIC_SERVER', '0')
    if public not in ('0', '1'):
        raise ValueError('Invalid public-listing control')
    prefix = 'ASSAULT_SERVER_' if kind == 'assaultcube' else 'CUBE_'
    maximum = int(environment.get(prefix + 'MAXPLAYERS', '16' if kind == 'assaultcube' else '4'))
    if not 1 <= maximum <= 16:
        raise ValueError('Native player count must be from 1 to 16')
    master = runtime.text(environment.get(prefix + 'MASTERSERVER', 'ms.cubers.net' if kind == 'assaultcube' else 'sauerbraten.org'), 512)
    if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,512}', master):
        raise ValueError('Master server must be a hostname or address')
    runtime.text(environment.get('ASSAULT_SERVER_DESCRIPTION' if kind == 'assaultcube' else 'CUBE_SERVERDESCRIPTION', 'AssaultCube server' if kind == 'assaultcube' else 'Sauerbraten server'), 2048)
    runtime.text(environment.get('ASSAULT_SERVER_PLAYERPASSWORD' if kind == 'assaultcube' else 'SERVER_PASSWORD', ''), 2048)
    runtime.text(environment.get('ASSAULT_SERVER_MOTD' if kind == 'assaultcube' else 'SERVER_MOTD', ''), 2048)
    game = safe(root, kind, 'directory')
    safe(root, kind + '/userdata', 'directory')
    safe(root, '.voltra/' + kind, 'directory')
    binary = safe(root, kind + '/bin_unix/linux_64_server', 'file')
    if not binary.is_file():
        raise ValueError('Install the reviewed Cube native server before starting')
    credential = safe(root, '.voltra/' + kind + '/admin-password', 'file')
    admin = runtime.text(environment.get(prefix + 'ADMINPASSWORD', '') or '')
    if not admin and credential.exists():
        if credential.stat().st_size > 512:
            raise ValueError('Persistent Cube credential exceeds its limit')
        admin = runtime.text(credential.read_text(), 512)
        if len(admin) < 5:
            raise ValueError('Persistent administrator password must have at least five characters')
    elif admin and len(admin) < 5:
        raise ValueError('Administrator password must have at least five characters')
    if kind == 'assaultcube':
        key = environment.get('ASSAULT_SERVER_KEY', '')
        if key and not re.fullmatch(r'[0-9a-fA-F]{64}', key):
            raise ValueError('AssaultCube identity key must have 64 hex characters')
        if key == 'A' * 64 or public == '1' and not key:
            raise ValueError('Public AssaultCube needs an operator-owned identity key')
        safe(root, kind + '/logs', 'directory')
        safe(root, kind + '/config/voltra-options.txt', 'file')
    else:
        operator = safe(root, kind + '/server-init.cfg', 'file')
        if operator.exists() and operator.stat().st_size > 1024 * 1024:
            raise ValueError('Native operator configuration exceeds 1 MiB')
        safe(root, kind + '/userdata/server-init.cfg', 'file')
    return game


def run(runtime, root, environment, kind):
    preflight(runtime, root, environment, kind)
    # The canonical supervisor retains all native info readiness, redaction and
    # documented interrupt completion semantics. Executable CFG is never INI.
    return runtime.run(root, environment, kind)


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Choose one reviewed Cube game')
        sys.exit(run(load_runtime(), Path.cwd(), dict(os.environ), sys.argv[1]))
    except (ValueError, OSError, KeyError, TypeError):
        print('Cube setup refused. Review native configuration, allocated ports and installed payload.', file=sys.stderr)
        sys.exit(1)
