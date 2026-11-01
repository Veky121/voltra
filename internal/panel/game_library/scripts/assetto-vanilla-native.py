"""Vanilla Assetto prerequisite gate. Reads owned content; never acquires it."""
import importlib.util
import os
from pathlib import Path
import re
import sys


def scalar(value):
    value = value.strip()
    if value.startswith('"'):
        match = re.fullmatch(r'"((?:[^"\\]|\\["\\])*)"\s*(?:[;#].*)?', value)
        if not match:
            raise ValueError('Malformed quoted native scalar')
        return re.sub(r'\\(["\\])', r'\1', match[1])
    return re.split(r'\s+[;#]', value, maxsplit=1)[0].strip()


def document(data):
    if len(data) > 8 * 1024 * 1024:
        raise ValueError('Oversize native INI')
    sections = {}
    current = None
    for line in data.decode('utf-8-sig').splitlines():
        line = line.strip()
        if not line or line.startswith((';', '#')):
            continue
        header = re.fullmatch(r'\[([^\]]+)\]\s*(?:[;#].*)?', line)
        if header:
            current = header[1].casefold()
            if current in sections:
                raise ValueError('Ambiguous native section')
            sections[current] = {}
        elif '=' in line and current is not None:
            key, value = line.split('=', 1)
            key = key.strip().casefold()
            if key in sections[current]:
                raise ValueError('Ambiguous native key')
            sections[current][key] = scalar(value)
        else:
            raise ValueError('Malformed native INI')
    return sections


def preflight(authority, shared, root, environment, running=False):
    def read(relative):
        path = authority.safe(root, relative)
        if not path.is_file() or path.stat().st_size > 8 * 1024 * 1024:
            raise ValueError('Import legitimate native preset and content first')
        return path.read_bytes()
    config = document(read('cfg/server_cfg.ini'))
    entries = document(read('cfg/entry_list.ini'))
    server = config.get('server', {})
    admin = server.get('admin_password', environment.get('ADMIN_PASSWORD', ''))
    if len(admin) < 8:
        raise ValueError('Native administrator password requires eight characters')
    if server.get('register_to_lobby', environment.get('PUBLIC_SERVER', '0')) not in ('0', '1'):
        raise ValueError('Invalid lobby listing flag')
    def component(value, optional=False):
        if optional and not value:
            return value
        if not re.fullmatch(r'[A-Za-z0-9_-]+', value):
            raise ValueError('Unsupported content identifier requires operator review')
        return value
    track = component(server.get('track', ''))
    layout = component(server.get('config_track', ''), True)
    cars = [component(x.strip()) for x in server.get('cars', '').split(';')]
    read('content/tracks/' + track + ('/' + layout if layout else '') + '/data/surfaces.ini')
    if not any(name in config for name in ('practice', 'qualify', 'race', 'book')):
        raise ValueError('Import a native session')
    slots = [value for key, value in entries.items() if re.fullmatch(r'car_[0-9]+', key)]
    if not slots:
        raise ValueError('Import native entry-list slots')
    for slot in slots:
        model = component(slot.get('model', ''))
        if model not in cars:
            raise ValueError('Entry-list model absent from selected cars')
        if not any(authority.safe(root, 'content/cars/' + model + '/' + name).is_file()
                   for name in ('data.acd', 'data/car.ini')):
            raise ValueError('Import legitimate car physics')
    updating = environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '0')) == '1'
    if (not running or updating) and environment.get('STEAM_USER', '') not in ('', 'anonymous'):
        raise ValueError('Private Steam credential transport remains unavailable')
    return authority.preflight(shared, root, 'assetto', environment,
                               require_files=running and not updating, allocated=running)


def main():
    if sys.argv[1:] not in (['install', 'assetto'], ['run', 'assetto']):
        raise ValueError('Exact vanilla recipe required')
    spec = importlib.util.spec_from_file_location('vanilla_authority', Path(__file__).with_name('assetto-native-authority.py'))
    authority = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(authority)
    shared = authority.load_shared()
    preflight(authority, shared, Path.cwd().resolve(), dict(os.environ), sys.argv[1] == 'run')
    return authority.main(shared)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError):
        print('Vanilla Assetto refused. Review native preset, owned content, sessions, allocations and acquisition prerequisites.', file=sys.stderr)
        sys.exit(1)
