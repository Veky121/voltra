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


def prepare(root, env):
    import stat
    from decimal import Decimal
    root = Path(root).resolve()
    file = root / 'config.json'
    # Validate all destinations before state creation or publisher selection.
    for target in [file, root / '.voltra', root / '.voltra/kissmp', root / '.voltra/kissmp/config-backups']:
        for part in [target, *target.parents]:
            if part == root.parent:
                break
            if part.is_symlink():
                raise ValueError('Unsafe KissMP path')
    if file.exists() and (not stat.S_ISREG(file.stat().st_mode) or file.stat().st_size > 4*1024*1024 or file.stat().st_nlink != 1):
        raise ValueError('Unsafe or oversized KissMP config')
    raw = file.read_bytes() if file.exists() else b''
    previous = raw.decode('utf-8')
    bom = '\ufeff' if previous.startswith('\ufeff') else ''
    text = previous[len(bom):] if raw else '{}'
    decoder = json.JSONDecoder(object_pairs_hook=unique_object, parse_float=Decimal, parse_constant=reject_constant)
    data = decoder.decode(text)
    if not isinstance(data, dict):
        raise ValueError('KissMP config must be an object')
    racing = load_racing()
    port = racing.number(env, 'SERVER_PORT', 3698, 1024, 65535)
    if 'port' in data and (type(data['port']) is not int or not 1024 <= data['port'] <= 65535):
        raise ValueError('Invalid native port')
    defaults = {'server_name':'Vanilla KissMP Server','description':'Vanilla KissMP Server','map':'/levels/smallgrid/info.json',
        'max_players':8,'tickrate':60,'max_vehicles_per_client':3,'show_in_server_list':False,'upnp_enabled':False,
        'server_identifier':racing.secrets.token_hex(10),'mods':None,'require_scripts':False}
    for key in data:
        if key not in defaults and key != 'port' and (key.casefold() in defaults or key.casefold() == 'port' or key in CONTROLS):
            raise ValueError('Ambiguous KissMP alias')
    values = {}
    for control, (native, kind) in CONTROLS.items():
        value = data.get(native, env.get(control) or defaults[native])
        if native in data and type(value) is not kind:
            raise ValueError('Invalid native type')
        if kind is str:
            value = racing.text({control:value}, control, '', 1024)
        elif kind is int:
            value = racing.number({control:value}, control, 8, 0 if control == 'MAX_CARS' else 1, 255)
        else:
            value = racing.boolean({control:value}, control, False)
        values[native] = value
    if 'server_identifier' in data and (type(data['server_identifier']) is not str or not data['server_identifier'] or any(ord(c)<32 for c in data['server_identifier'])):
        raise ValueError('Invalid native identity')
    # Scan complete top-level JSON scalar/value spans, never key-like strings.
    spans = {}; i = text.index('{') + 1
    while True:
        while text[i].isspace(): i += 1
        if text[i] == '}': break
        key, stop = decoder.raw_decode(text, i)
        i = stop
        while text[i].isspace(): i += 1
        if text[i] != ':': raise ValueError('Invalid JSON member')
        i += 1
        while text[i].isspace(): i += 1
        begin = i
        _, i = decoder.raw_decode(text, i)
        spans[key] = (begin, i)
        while text[i].isspace(): i += 1
        if text[i] == '}': break
        if text[i] != ',': raise ValueError('Invalid JSON separator')
        i += 1
    close = i
    missing = {key:values.get(key, value) for key,value in defaults.items() if key not in data}
    if 'port' not in data: missing['port'] = port
    newline = '\r\n' if '\r\n' in text else '\n'
    addition = ((',' if data else '') + newline + ','.join(json.dumps(k)+': '+json.dumps(v) for k,v in missing.items()) + newline) if missing else ''
    edits = [(close, close, addition)] if addition else []
    if 'port' in data and data['port'] != port:
        edits.append((*spans['port'], str(port)))
    for begin, stop, value in sorted(edits, reverse=True):
        text = text[:begin] + value + text[stop:]
    # The publisher rejects a BOM; configure backs up the original bytes first.
    updated = text if raw else text + '\n'
    return file, raw, updated.encode('utf-8')


def configure(root, env, racing=None):
    import time
    file, previous, updated = prepare(root, env)
    racing = racing or load_racing()
    if previous != updated:
        if previous:
            backup = Path(root) / '.voltra/kissmp/config-backups'
            backup.mkdir(parents=True, exist_ok=True)
            racing.config.private_write(backup / (str(time.time_ns())+'-config.json'), previous.decode('utf-8'))
        racing.write(file, updated.decode('utf-8'))
    return file


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

