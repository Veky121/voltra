#!/usr/bin/env python3
"""Brickadia-only seed-once configuration, using the shared process supervisor."""
import os
from pathlib import Path
import re
import stat

import unreal_building as shared
from native_config import patch_ini, resolve_ini_identities

SECTION = 'Server__BP_ServerSettings_General_C BP_ServerSettings_General_C'
KEYS = {'ServerName': 'SERVER_NAME', 'ServerPassword': 'SERVER_PASSWORD', 'bPubliclyListed': 'SERVER_LIST_PUBLIC'}


def checked_path(root, name):
    current = root
    for part in Path(name).parts:
        if part in ('.', '..') or Path(name).is_absolute():
            raise ValueError('Unsafe Brickadia native path')
        current = current / part
        if current.is_symlink():
            raise ValueError('Brickadia native paths cannot use symlinks')
    if not current.resolve().is_relative_to(root):
        raise ValueError('Brickadia native path escapes volume')
    return current


def plan(root, environment, require_binary=True):
    root = Path(root).resolve()
    info = shared.metadata()['brickadia']
    automatic = environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', info['defaults']['AUTO_UPDATE']))
    if automatic not in ('0', '1'):
        raise ValueError('Brickadia auto-update flag must be 0 or 1')
    env = {**info['defaults'], **{key: value for key, value in environment.items() if key in info['defaults']}}
    for key, value in env.items():
        if key in KEYS.values():
            continue
        if type(value) is not str or len(value.encode()) > 8192 or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError('Invalid Brickadia setting')
    if not env['SERVER_HOSTING_TOKEN']:
        raise ValueError('Brickadia requires an operator-owned hosting token')
    if env['SRCDS_APPID'] != str(info['app']):
        raise ValueError('Unexpected Brickadia application ID')
    if any(c in env['WORLD_NAME'] for c in '/\\') or env['WORLD_NAME'] in ('.', '..'):
        raise ValueError('World must be a name inside the native Worlds folder')
    port = int(environment['SERVER_PORT'])
    allocated = {int(value) for value in environment.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if value}
    if not 1 <= port <= 65535 or port not in allocated:
        raise ValueError('Choose an allocated Brickadia port')
    binary = checked_path(root, info['binary'])
    if binary.exists() and not binary.is_file():
        raise ValueError('Brickadia executable must be a regular file')
    if require_binary and not binary.is_file():
        raise ValueError('Reinstall to restore the Brickadia executable')
    target = checked_path(root, info['config'])
    if target.exists() and (not stat.S_ISREG(target.stat().st_mode) or target.stat().st_size > 8 * 1024 * 1024):
        raise ValueError('Brickadia settings must be a bounded regular file')
    previous = target.read_bytes() if target.exists() else b''
    bom = b'\xef\xbb\xbf' if previous.startswith(b'\xef\xbb\xbf') else b''
    content = previous.decode('utf-8-sig')
    requested = {SECTION: {key: env[name] for key, name in KEYS.items()}}
    resolved = resolve_ini_identities(content, requested)
    section, values = next(iter(resolved.items()))
    current_section = None
    found = {}
    for line in content.splitlines():
        header = re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:[;#].*)?', line.strip())
        if header:
            current_section = header.group(1)
        elif current_section == section and not line.lstrip().startswith((';', '#')) and '=' in line:
            key, value = line.split('=', 1)
            if key.strip() in values:
                found[key.strip()] = value.strip()
    effective = {key: found.get(key, value) for key, value in values.items()}
    for key, value in effective.items():
        if type(value) is not str or len(value.encode()) > 8192 or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError('Invalid effective Brickadia setting')
        if key.casefold() == 'bpubliclylisted' and value not in ('True', 'False'):
            raise ValueError('Invalid effective Brickadia public-listing flag')
    missing = {key: value for key, value in values.items() if key not in found}
    updated = bom + patch_ini(content, {section: missing}).encode() if missing else previous
    passwords = [env['SERVER_PASSWORD']]
    for key, value in found.items():
        if key.casefold() == 'serverpassword':
            passwords += [value, value.strip('"')]
    child = dict(os.environ)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_LIBRARY_PATH', 'LD_PRELOAD'):
        child.pop(key, None)
    child.update(HOME=str(root), XDG_CONFIG_HOME=str(checked_path(root, '.config')),
                 LD_LIBRARY_PATH=str(root / '.steam/sdk64') + ':' + str(root / 'longvinter-linux-server/.steam/sdk64'))
    argv = [str(binary), '-server', '-log', '-world=' + env['WORLD_NAME'], '-port=' + str(port),
            '-token=' + env['SERVER_HOSTING_TOKEN'], '-stdout', '-FullStdOutLogOutput']
    credentials = [*passwords, *[env.get(key, environment.get(key, '')) for key in
                    ('SERVER_HOSTING_TOKEN', 'RCON_PASSWORD', 'STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]]
    return {'root': root, 'info': info, 'previous': previous, 'updated': updated, 'target': target,
            'argv': argv, 'child': child, 'credentials': credentials, 'ready': info['ready'].encode()}


def configure(root, environment):
    prepared = plan(root, environment)
    if prepared['updated'] != prepared['previous']:
        shared.publish(prepared['root'], prepared['info']['config'], prepared['updated'])
    binary = Path(prepared['argv'][0])
    binary.chmod(binary.stat().st_mode | 0o100)
    return prepared['argv'], prepared['child'], prepared['credentials'], prepared['ready']


def main():
    root = Path.cwd().resolve()
    environment = dict(os.environ)
    defaults = shared.metadata()['brickadia']['defaults']
    automatic = environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', defaults['AUTO_UPDATE']))
    if automatic not in ('0', '1'):
        raise ValueError('Brickadia auto-update flag must be 0 or 1')
    updating = automatic == '1'
    plan(root, environment, require_binary=not updating)
    if updating:
        shared.install(root, 'brickadia', environment)
    return shared.native_run(root, 'brickadia', *configure(root, environment))


if __name__ == '__main__':
    raise SystemExit(main())

