#!/usr/bin/env python3
"""Native-file authority for original Assetto and AssettoServer, not AMS2."""
import codecs
import importlib.util
import os
from pathlib import Path
import re
import sys


def load_shared():
    path = Path(__file__).with_name('assetto-ams-native.py')
    spec = importlib.util.spec_from_file_location('assetto_shared', path)
    shared = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(shared)
    return shared


def safe(root, relative):
    result = root / relative
    cursor = root
    for part in Path(relative).parts:
        if part in ('..', '.') or Path(part).is_absolute():
            raise ValueError('Invalid native Assetto path')
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError('Native Assetto paths cannot use symlinks')
        if cursor != result and cursor.exists() and not cursor.is_dir():
            raise ValueError('Invalid native Assetto parent')
    if not result.resolve().is_relative_to(root):
        raise ValueError('Native Assetto path leaves volume')
    if result.exists() and not result.is_file():
        raise ValueError('Expected regular native Assetto file')
    return result


def scalar_rows(data):
    if len(data) > 8 * 1024 * 1024:
        raise ValueError('Native Assetto configuration exceeds 8 MiB')
    text = data.decode('utf-8-sig')
    if '\x00' in text:
        raise ValueError('NUL in native Assetto configuration')
    rows, active, section_seen = {}, False, False
    for index, line in enumerate(text.splitlines(keepends=True)):
        stripped = line.strip()
        header = re.fullmatch(r'\[([^\]]+)\]\s*(?:[;#].*)?', stripped)
        if header:
            active = header.group(1).casefold() == 'server'
            if active:
                if section_seen:
                    raise ValueError('Duplicate native Assetto SERVER section')
                section_seen = True
        elif active and not stripped.startswith((';', '#')) and '=' in line:
            key, value = line.split('=', 1)
            identity = key.strip().casefold()
            if identity in rows:
                raise ValueError('Duplicate native Assetto scalar')
            rows[identity] = (index, key.strip(), value.rstrip('\r\n').strip())
    return text, rows


def plan_config(shared, data, game, environment, allocated=True):
    if game not in ('assetto', 'assettoserver'):
        raise ValueError('Unsupported Assetto recipe')
    custom = game == 'assettoserver'
    text, rows = scalar_rows(data)
    defaults = {
        'NAME': ('SERVER_NAME' if custom else 'HOSTNAME', 'Assetto server', 40 if custom else 45),
        'PASSWORD': ('SERVER_PASSWORD' if custom else 'PASSWORD', '', 64 if custom else 40),
        'ADMIN_PASSWORD': ('ADMIN_PASSWORD', '', 64 if custom else 40),
        'REGISTER_TO_LOBBY': ('PUBLIC_SERVER', '0', 1),
    }
    seeds = {}
    for key, (variable, default, limit) in defaults.items():
        if key.casefold() not in rows:
            seeds[key] = shared.text(environment, variable, default, limit)
    if custom and 'max_clients' not in rows:
        seeds['MAX_CLIENTS'] = str(shared.integer(environment, 'MAX_CLIENTS', 18, 2, 25))
    admin = rows['admin_password'][2] if 'admin_password' in rows else seeds['ADMIN_PASSWORD']
    if len(admin) < 8:
        raise ValueError('Native Assetto administrator password requires at least 8 characters')
    if 'REGISTER_TO_LOBBY' in seeds and seeds['REGISTER_TO_LOBBY'] not in ('0', '1'):
        raise ValueError('Invalid native Assetto public listing flag')
    selected = shared.roles(environment, ['HTTP_PORT']) if allocated else None
    managed = {} if selected is None else {
        'UDP_PORT': str(selected['primary']), 'TCP_PORT': str(selected['primary']),
        'HTTP_PORT': str(selected['HTTP_PORT']),
    }
    # Use shared writer only for allocation-owned ports and missing scalar seeds.
    # Existing native gameplay values are excluded from this patch entirely.
    patch = {**seeds, **managed}
    planned_text = shared.native.patch_ini(text, {'SERVER': patch}, case_insensitive=True) if patch else text
    planned = (codecs.BOM_UTF8 if data.startswith(codecs.BOM_UTF8) else b'') + planned_text.encode('utf-8')
    _, effective = scalar_rows(planned)
    credentials = []
    for key in ('password', 'admin_password'):
        value = effective.get(key, (0, '', ''))[2]
        if value:
            credentials.append(value)
            quoted = re.match(r'^"((?:[^"\\]|\\.)*)"', value)
            if quoted:
                credentials.append(re.sub(r'\\(["\\])', r'\1', quoted.group(1)))
            else:
                credentials.append(re.split(r'\s+[;#]', value, maxsplit=1)[0].strip())
    credentials += [environment.get(key, '') for key in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'PASSWORD', 'SERVER_PASSWORD', 'ADMIN_PASSWORD')]
    return planned, credentials


def preflight(shared, root, game, environment, require_files=True, allocated=True):
    root = Path(root).resolve()
    if game not in ('assetto', 'assettoserver'):
        raise ValueError('Unsupported Assetto recipe')
    binary = safe(root, 'acServer' if game == 'assetto' else 'AssettoServer')
    target = safe(root, 'cfg/server_cfg.ini')
    entry = safe(root, 'cfg/entry_list.ini')
    if game == 'assettoserver':
        safe(root, 'cfg/extra_cfg.yml')
    if require_files and (not binary.is_file() or not target.is_file() or not entry.is_file()):
        raise ValueError('Import the real native server preset, entry list and server executable')
    if target.exists() and target.stat().st_size > 8 * 1024 * 1024:
        raise ValueError('Native Assetto configuration exceeds 8 MiB')
    previous = target.read_bytes() if target.exists() else b''
    planned, credentials = plan_config(shared, previous, game, environment, allocated=allocated)
    return {'root': root, 'target': target, 'binary': binary, 'previous': previous,
            'planned': planned, 'credentials': credentials}


def publish(shared, plan):
    target = safe(plan['root'], 'cfg/server_cfg.ini')
    if (target.read_bytes() if target.exists() else b'') != plan['previous']:
        raise ValueError('Native Assetto configuration changed during startup; retry')
    if plan['planned'] != plan['previous']:
        shared.steam._publish(plan['root'], 'cfg/server_cfg.ini', lambda output: output.write(plan['planned']), 0o600)
    target.chmod(0o600)


def main(shared=None):
    shared = shared or load_shared()
    if len(sys.argv) != 3 or sys.argv[1] not in ('install', 'run'):
        raise ValueError('Expected install/run and native Assetto recipe')
    action, game = sys.argv[1:]
    root, environment = Path.cwd().resolve(), dict(os.environ)
    updating = game == 'assetto' and environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '0')) == '1'
    # Preflight before any acquisition or file publication. An update may restore
    # missing preset/binary files; the post-update plan still requires real files.
    plan = preflight(shared, root, game, environment, require_files=action == 'run' and not updating, allocated=action == 'run')
    if action == 'install' or updating:
        shared.install(root, game, environment)
        if action == 'install':
            return 0
        plan = preflight(shared, root, game, environment)
    publish(shared, plan)
    child_environment = dict(os.environ)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_LIBRARY_PATH', 'LD_PRELOAD'):
        child_environment.pop(key, None)
    child_environment['HOME'] = str(root)
    return shared.helper('native-console').run(root, [str(plan['binary'])], child_environment, '\x03',
                                              credentials=plan['credentials'], terminal_input=True)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError):
        print('Assetto setup failed. Review native configuration, allocations, operator preset and acquisition prerequisites.', file=sys.stderr)
        sys.exit(1)
