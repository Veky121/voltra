#!/usr/bin/env python3
"""Starbound candidate. Native JSON owns gameplay; allocation owns only its port."""
import json
import os
from pathlib import Path
import re
import signal
import sys
from native_config import private_write
from native_console import run


def confined(root, relative):
    root = Path(root).resolve()
    path = root / relative
    for parent in (path, *path.parents):
        if parent == root:
            break
        if parent.is_symlink():
            raise ValueError('Starbound native paths must not contain links')
    if not path.resolve().is_relative_to(root):
        raise ValueError('Starbound path leaves volume')
    return path


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key.casefold() in {k.casefold() for k in result}:
            raise ValueError('Ambiguous Starbound JSON key')
        result[key] = value
    return result


def document(text):
    if len(text.encode('utf-8')) > 8 * 1024**2:
        raise ValueError('Oversized Starbound JSON')
    # Accept one leading UTF-8 BOM for parsing; retain original file bytes.
    if text.startswith('\ufeff'):
        text = text[1:]
    data = json.loads(text, object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
    if not isinstance(data, dict):
        raise ValueError('Expected native JSON object')
    return data


def preflight(root, env):
    for key, default, allowed in [('WORKSHOP', '0', ('0', '1')), ('AUTO_UPDATE', '1', ('0', '1')),
                                  ('VOLTRA_STEAM_AUTO_UPDATE', '0', ('0', '1')), ('VALIDATE', 'false', ('true', 'false'))]:
        if env.get(key, default) not in allowed:
            raise ValueError('Invalid ' + key)
    if env.get('SRCDS_APPID', '211820') != '211820':
        raise ValueError('Starbound requires app 211820')
    raw = env.get('SERVER_PORT', '21025')
    allocations = env.get('VOLTRA_ALLOCATED_PORTS', '')
    if not re.fullmatch(r'[0-9]{1,5}', raw) or not 1 <= int(raw) <= 65535:
        raise ValueError('Invalid game port')
    if not re.fullmatch(r'[0-9]{1,5}(,[0-9]{1,5})*', allocations):
        raise ValueError('Explicit allocations required')
    ports = [int(p) for p in allocations.split(',')]
    if any(not 1 <= p <= 65535 for p in ports) or int(raw) not in ports:
        raise ValueError('Game port must be allocated')
    target = confined(root, 'storage/starbound_server.config')
    if target.exists():
        data = document(target.read_text(encoding='utf-8'))
        if 'serverUsers' in data and not isinstance(data['serverUsers'], dict):
            raise ValueError('Expected native serverUsers object')
        if 'rconServerPassword' in data and not isinstance(data['rconServerPassword'], str):
            raise ValueError('Expected native RCON password string')
    boot = confined(root, 'sbinit.config')
    if boot.exists():
        data = document(boot.read_text(encoding='utf-8'))
        if data.get('storageDirectory') != 'storage':
            raise ValueError('Custom storage authority requires explicit integration; file retained')
    confined(root, '.voltra/starbound')
    confined(root, 'mods')
    return int(raw)


def port_patch(text, port):
    data = document(text)
    if 'gameServerPort' not in data:
        # Insert only the allocation setting. Native server supplies gameplay defaults.
        pos = text.index('{') + 1
        return text[:pos] + '\n  "gameServerPort": ' + str(port) + (',' if data else '') + text[pos:]
    if type(data['gameServerPort']) is not int:
        raise ValueError('Native gameServerPort must be an integer')
    # Walk top-level JSON values with the decoder, preserving all other bytes,
    # including large integers, whitespace and nested operator settings.
    decoder = json.JSONDecoder()
    pos = text.index('{') + 1
    while True:
        pos = re.compile(r'\s*').match(text, pos).end()
        key, pos = decoder.raw_decode(text, pos)
        pos = re.compile(r'\s*:\s*').match(text, pos).end()
        start = pos
        _, pos = decoder.raw_decode(text, pos)
        if key == 'gameServerPort':
            return text[:start] + str(port) + text[pos:]
        pos = re.compile(r'\s*,\s*').match(text, pos).end()


def configure(root, env):
    root = Path(root).resolve()
    port = preflight(root, env)
    binary = confined(root, 'starbound_server')
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise ValueError('Missing Starbound executable')
    if not confined(root, 'sbinit.config').is_file():
        raise ValueError('Missing native sbinit.config')
    target = confined(root, 'storage/starbound_server.config')
    previous = target.read_bytes() if target.exists() else None
    updated = port_patch(previous.decode('utf-8') if previous is not None else '{}\n', port).encode('utf-8')
    if updated != previous:
        if previous is not None:
            import hashlib
            backup = confined(root, '.voltra/starbound/config-backups/' + hashlib.sha256(previous).hexdigest() + '.json')
            if not backup.exists():
                private_write(backup, previous.decode('utf-8'))
        private_write(target, updated.decode('utf-8'))
    environment = dict(os.environ)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'STEAM_PASS', 'STEAM_AUTH', 'STEAM_USER'):
        environment.pop(key, None)
    environment.update(HOME=str(root), LD_LIBRARY_PATH=str(root / '.steam/sdk64'))
    secrets = [env.get(k, '') for k in ('STEAM_PASS', 'STEAM_AUTH')]
    data = document(updated.decode('utf-8'))
    secrets.append(data.get('rconServerPassword', ''))
    for user in data.get('serverUsers', {}).values():
        if isinstance(user, dict) and isinstance(user.get('password'), str):
            secrets.append(user['password'])
    return [str(binary)], environment, [s for s in secrets if isinstance(s, str) and s]


def main():
    root = Path.cwd()
    env = dict(os.environ)
    preflight(root, env)
    if env.get('VOLTRA_STEAM_AUTO_UPDATE', '0') == '1':
        from starbound_install import install
        install(root, env)
    argv, environment, secrets = configure(root, env)
    # Preserve original publisher-output matching in the egg, without inventing
    # online events. Shared supervisor retains raw native exit and diagnostics.
    return run(root, argv, environment, '', secrets, stop_signal=signal.SIGINT)


if __name__ == '__main__':
    sys.exit(main())
