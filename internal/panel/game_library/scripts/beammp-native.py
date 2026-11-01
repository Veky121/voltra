#!/usr/bin/env python3
"""MIT. BeamMP v3.9.3 file-authoritative settings and publisher launch adapter."""
import json
import os
import re
from pathlib import Path
import sys
import time
import tomllib
import importlib.util


def helper(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


racing = helper('racing-native')
# Native environment names are from publisher v3.9.3 TConfig.cpp.
FIELDS = {
    'Name': ('NAME', 'NAME', 'BeamMP Server'),
    'Description': ('DESCRIPTION', 'DESCRIPTION', 'BeamMP Default Description'),
    'AuthKey': ('AUTHKEY', 'AUTH_KEY', ''),
    'Map': ('MAP', 'MAP', '/levels/gridmap_v2/info.json'),
    'Private': ('PRIVATE', 'PRIVATE', True),
    'LogChat': ('LOGCHAT', 'LOG_CHAT', True),
    'MaxPlayers': ('MAX_PLAYERS', 'MAX_PLAYERS', 6),
    'MaxCars': ('MAX_CARS', 'MAX_CARS', 1),
    'Tags': ('TAGS', 'TAGS', 'Freeroam'),
    'AllowGuests': ('ALLOW_GUESTS', 'ALLOW_GUESTS', True),
    'InformationPacket': ('INFORMATION_PACKET', 'INFORMATION_PACKET', False),
    'Debug': ('DEBUG', 'DEBUG', False),
    'ResourceFolder': ('RESOURCE_FOLDER', 'RESOURCE_FOLDER', 'Resources'),
}


def configure(root, env):
    root = Path(root).resolve()
    path = racing.owned(root, root / 'ServerConfig.toml')
    previous = path.read_bytes().decode('utf-8') if path.exists() else ''
    data = tomllib.loads(previous)
    general = data.get('General', {})
    values = {}
    for key, (control, native, default) in FIELDS.items():
        # Existing native settings win over creation-time egg defaults.
        value = general.get(key, env.get(control, default))
        source = {control: value}
        if isinstance(default, bool):
            value = racing.boolean(source, control, default)
        elif isinstance(default, int):
            value = racing.number(source, control, default, 1 if key == 'MaxPlayers' else 0, 100 if key == 'MaxPlayers' else 10)
        else:
            value = racing.text(source, control, default, 64 if key == 'AuthKey' else 1024)
        values[key] = value
    if not values['AuthKey']:
        raise ValueError('Your own BeamMP Keymaster key is required, including private servers')
    folder = Path(values['ResourceFolder'])
    if folder.is_absolute() or not values['ResourceFolder'] or '..' in folder.parts:
        raise ValueError('ResourceFolder must remain in this server volume')
    racing.owned(root, root / folder)
    values['Port'] = racing.number(env, 'SERVER_PORT', 30814, 1024, 65535)
    # Leave every existing scalar, comment and unknown byte alone. Only seed
    # absent keys; the allocation is the sole value allowed to replace a key.
    missing = {key: json.dumps(value, ensure_ascii=False)
               for key, value in values.items() if key not in general}
    updated = racing.config.patch_ini(previous, {'General': missing}) if missing else previous
    if 'Port' in general and general['Port'] != values['Port']:
        lines = updated.splitlines(keepends=True)
        section = None
        matches = []
        for index, line in enumerate(lines):
            header = re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:#.*)?', line.strip())
            if header:
                section = header.group(1)
            elif section == 'General':
                match = re.fullmatch(r'([ \t]*Port[ \t]*=[ \t]*)[0-9_]+([ \t]*(?:#[^\r\n]*)?)(\r?\n)?', line)
                if match:
                    matches.append(index)
                    lines[index] = match[1] + str(values['Port']) + match[2] + (match[3] or '')
        if len(matches) != 1:
            raise ValueError('Unsupported allocation port TOML layout')
        updated = ''.join(lines)
    parsed = tomllib.loads(updated)
    if parsed['General'] != {**general, **values}:
        raise ValueError('Unsupported native TOML layout')
    if updated != previous:
        if previous:
            backup = racing.owned(root, root / '.voltra/beammp/config-backups')
            backup.mkdir(parents=True, exist_ok=True)
            racing.config.private_write(backup / (str(time.time_ns()) + '-ServerConfig.toml'), previous)
        old = path.stat() if path.exists() else None
        racing.config.private_write(path, updated)
        if old:
            path.chmod(old.st_mode & 0o777)
            if hasattr(os, 'chown'):
                os.chown(path, old.st_uid, old.st_gid)
    return parsed


def launch(root, env):
    data = configure(root, env)
    # Publisher FlushToFile discards unknown keys. Disable that path and supply
    # the validated native values through its documented provider environment.
    child = {key: value for key, value in env.items() if not key.startswith('BEAMMP_')}
    child['BEAMMP_PROVIDER_DISABLE_CONFIG'] = 'true'
    for key, (_, native, _) in FIELDS.items():
        child['BEAMMP_' + native] = str(data['General'][key]).lower() if isinstance(data['General'][key], bool) else str(data['General'][key])
    child['BEAMMP_PORT'] = str(data['General']['Port'])
    child['BEAMMP_IP'] = '0.0.0.0'
    misc = data.get('Misc', {})
    for key, native in [('ImScaredOfUpdates', 'IM_SCARED_OF_UPDATES'), ('UpdateReminderTime', 'UPDATE_REMINDER_TIME')]:
        if key in misc:
            value = misc[key]
            child['BEAMMP_' + native] = str(value).lower() if isinstance(value, bool) else str(value)
    return helper('native-console').run(root, [str(Path(root) / 'BeamMP-Server')], child, 'exit',
        credentials=[data['General']['AuthKey'], env.get('AUTHKEY', '')],
        ready_marker=b'Vehicle data network online', terminal_input=True)


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['install']:
            if os.environ.get('VERSION', 'v3.9.3') != 'v3.9.3':
                raise ValueError('This profile requires reviewed BeamMP v3.9.3')
            racing.install(Path.cwd(), 'beammp', dict(os.environ))
        elif sys.argv[1:] == ['run']:
            sys.exit(launch(Path.cwd(), dict(os.environ)))
        else:
            raise ValueError('Unsupported BeamMP action')
    except (ValueError, OSError, KeyError):
        print('BeamMP setup failed. Check native settings, Keymaster entitlement and publisher version.', file=sys.stderr)
        sys.exit(1)
