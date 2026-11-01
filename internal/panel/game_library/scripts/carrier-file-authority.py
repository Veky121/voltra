#!/usr/bin/env python3
"""Carrier-only native XML authority; shared installer and console retained."""
import html
import importlib.util
import os
from pathlib import Path
import re
import sys
import time
import xml.parsers.expat
import xml.etree.ElementTree as ET

DOCUMENT = 'server_config.xml'
FIELDS = {
    'server_name': ('SERVER_NAME', 'A Pterodactyl Hosted Server', 128),
    'password': ('SERVER_PASSWORD', '', 64), 'save_name': ('SAVE_NAME', '', 100),
    'max_players': ('MAX_PLAYERS', 4, 1, 16), 'island_count': ('ISLAND_COUNT', 16, 4, 32),
    'island_count_per_team': ('ISLAND_COUNT_PER_TEAM', 1, 1, 8),
    'carrier_count_per_team': ('CARRIER_COUNT_PER_TEAM', 1, 1, 4),
    'team_count_ai': ('TEAM_COUNT_AI', 1, 0, 4), 'team_count_human': ('TEAM_COUNT_HUMAN', 1, 1, 4),
    'base_difficulty': ('BASE_DIFFICULTY', 0, 0, 2), 'loadout_type': ('LOADOUT_TYPE', 0, 0, 2),
    'blueprints': ('BLUEPRINTS', 0, 0, 1),
}
ATTRIBUTE = re.compile(rb'''\s+([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')''')


def load_runtime():
    folder = Path(__file__).resolve().parent
    file = folder / 'vehicle-sims.py'
    if not file.exists():
        file = folder.parents[1] / 'internal/panel/game_library/scripts/vehicle-sims.py'
    spec = importlib.util.spec_from_file_location('carrier_shared_vehicle', file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def root_attributes(runtime, data):
    if len(data) > 8 * 1024 * 1024:
        raise ValueError('Carrier XML exceeds 8 MiB')
    document = runtime.parse_xml(data.decode('utf-8-sig'), 'data')
    parser = xml.parsers.expat.ParserCreate()
    depth, start = 0, None

    def entered(name, attributes):
        nonlocal depth, start
        depth += 1
        if depth > 128:
            raise ValueError('Carrier XML nesting exceeds its limit')
        if depth == 1:
            start = parser.CurrentByteIndex

    def exited(name):
        nonlocal depth
        depth -= 1

    parser.StartElementHandler = entered
    parser.EndElementHandler = exited
    parser.Parse(data, True)
    end, quote = start + 1, None
    while end < len(data):
        current = data[end]
        if quote:
            if current == quote:
                quote = None
        elif current in (34, 39):
            quote = current
        elif current == 62:
            break
        end += 1
    spans, seen = {}, set()
    for match in ATTRIBUTE.finditer(data[start:end]):
        name = match[1].decode('ascii')
        canonical = name.casefold()
        if canonical not in FIELDS and canonical != 'port':
            continue
        if name != canonical or canonical in seen:
            raise ValueError('Ambiguous Carrier root attribute')
        seen.add(canonical)
        group = 2 if match.start(2) >= 0 else 3
        spans[canonical] = (start + match.start(group), start + match.end(group))
    return document, spans, end


def plan(runtime, root, environment, require_binary=True):
    root = Path(root).resolve()
    runtime.identity('carrier', environment)
    port = str(runtime.shared.roles(environment, [], offsets=(1, 2, 3))['primary'])
    target = runtime.shared.confined(root, root / DOCUMENT)
    binary = runtime.shared.confined(root, root / 'dedicated_server.exe')
    if binary.exists() and not binary.is_file():
        raise ValueError('Carrier executable must be a regular file')
    if require_binary and not binary.is_file():
        raise ValueError('Missing legitimately supplied Carrier executable')
    wine = runtime.shared.confined(root, root / '.wine')
    if wine.exists() and not wine.is_dir():
        raise ValueError('Carrier private prefix must be a directory')
    prefix = runtime.shared.confined(root, root / '.wine/system.reg')
    if prefix.exists():
        if not prefix.is_file():
            raise ValueError('Carrier prefix receipt must be a regular file')
        with prefix.open('r', encoding='utf-8', errors='replace') as source:
            if '#arch=win64' in source.read(1024):
                raise ValueError('Carrier requires its original private win32 prefix')
    history = runtime.shared.confined(root, root / '.voltra/carrier-config-history')
    if history.exists() and not history.is_dir():
        raise ValueError('Carrier configuration history must be a directory')
    if target.exists() and (not target.is_file() or target.stat().st_size > 8 * 1024 * 1024):
        raise ValueError('Carrier XML must be a bounded regular file')
    previous = target.read_bytes() if target.exists() else None
    source = previous if previous is not None else runtime.CARRIER_DEFAULT.encode()
    document, spans, end = root_attributes(runtime, source)
    changes, missing, effective = [], {}, dict(environment)
    for attribute, spec in FIELDS.items():
        variable, default, *bounds = spec
        value = document.get(attribute) if previous is not None and attribute in document.attrib else str(environment.get(variable, default))
        if len(bounds) == 2:
            value = str(runtime.number({variable: value}, variable, default, *bounds))
        elif attribute == 'save_name':
            value = runtime.world({variable: value}, variable)
        else:
            value = runtime.text({variable: value}, variable, default, bounds[0])
        effective[variable] = value
        if previous is None and attribute in spans:
            changes.append((*spans[attribute], html.escape(value, quote=True).encode()))
        elif attribute not in spans:
            missing[attribute] = value
    if 'port' in spans:
        changes.append((*spans['port'], port.encode()))
    else:
        missing['port'] = port
    insertion = end - 1 if source[end - 1:end] == b'/' else end
    if missing:
        addition = ''.join(' ' + key + '="' + html.escape(value, quote=True) + '"' for key, value in missing.items()).encode()
        changes.append((insertion, insertion, addition))
    updated = source
    for begin, finish, replacement in sorted(changes, key=lambda row: row[0], reverse=True):
        updated = updated[:begin] + replacement + updated[finish:]
    runtime.parse_xml(updated.decode('utf-8-sig'), 'data')
    return {'root': root, 'target': target, 'binary': binary, 'previous': previous, 'updated': updated,
            'password': effective['SERVER_PASSWORD']}


def publish(runtime, prepared):
    root, target = prepared['root'], prepared['target']
    runtime.shared.confined(root, target)
    current = target.read_bytes() if target.exists() else None
    if current != prepared['previous']:
        raise ValueError('Carrier settings changed during startup; retry')
    if current == prepared['updated']:
        return
    if current is not None:
        runtime.steam._publish(root, '.voltra/carrier-config-history/' + str(time.time_ns()) + '.xml', lambda stream: stream.write(current), 0o600)
    runtime.steam._publish(root, DOCUMENT, lambda stream: stream.write(prepared['updated']), 0o600)


def run(runtime, root, environment):
    root = Path(root).resolve()
    automatic = environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '0'))
    if automatic not in ('0', '1') or environment.get('INSTALL_MODE', 'steam') not in ('steam', 'operator_files'):
        raise ValueError('Invalid Carrier acquisition controls')
    plan(runtime, root, environment, require_binary=automatic != '1')
    if automatic == '1':
        runtime.install(root, 'carrier', environment)
    elif environment.get('INSTALL_MODE') == 'operator_files':
        runtime.operator_files(root, 'carrier')
    prepared = plan(runtime, root, environment)
    publish(runtime, prepared)
    child = dict(os.environ)
    credentials = [prepared['password']] + [environment.get(key, '') for key in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS'):
        child.pop(key, None)
    child.update(HOME=str(root), WINEPREFIX=str(root / '.wine'), WINEDEBUG='-all', WINEARCH='win32', SteamAppId='1489630', LD_LIBRARY_PATH=str(root / 'linux64'))
    code = runtime.helper('native-console').run(root, ['wine', str(prepared['binary'])], child, '\x03', credentials, terminal_input=True)
    return code if code >= 0 else 128 - code


if __name__ == '__main__':
    try:
        if sys.argv[1:] != ['run', 'carrier']:
            raise ValueError('Carrier runtime entrypoint only')
        sys.exit(run(load_runtime(), Path.cwd(), dict(os.environ)))
    except (ValueError, OSError, KeyError, xml.parsers.expat.ExpatError, ET.ParseError):
        print('Carrier setup refused. Review native configuration, allocations and licensed operator payload.', file=sys.stderr)
        sys.exit(1)
