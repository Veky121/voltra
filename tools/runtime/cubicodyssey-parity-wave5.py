#!/usr/bin/env python3
"""Cubic-only native-file authority; shared acquisition/license and console retained."""
import codecs
import json
import os
from pathlib import Path
import re
import signal
import sys

FILE = 'config/server_config.txt'
NATIVE = {'serverName': 'SERVER_NAME', 'privateServer': 'PRIVATE_SERVER', 'galaxySeed': 'GALAXY_SEED'}


def shared_runtime():
    import crafting_runtime
    return crafting_runtime


def parse_config(data):
    if len(data) > 8 * 1024 * 1024:
        raise ValueError('Native Cubic config exceeds limit')
    text = data.decode('utf-8-sig')
    if '\x00' in text:
        raise ValueError('NUL in native Cubic config')
    lines, rows, offset = text.splitlines(keepends=True), {}, 0
    folded = {key.lower(): key for key in NATIVE}
    for line in lines:
        content = line.rstrip('\r\n')
        match = re.match(r'^([ \t]*)([A-Za-z][A-Za-z0-9]*)([ \t]+)(.*)$', content)
        if match and match[2].lower() in folded:
            key = folded[match[2].lower()]
            if match[2] != key or key in rows:
                raise ValueError('Ambiguous native Cubic config key')
            grammar = r'"([^"\\]*)"' if key == 'serverName' else r'(TRUE|FALSE)' if key == 'privateServer' else r'([0-9]{1,11})'
            value = re.fullmatch(grammar + r'([ \t]*(?://.*|#.*)?)', match[4])
            if not value:
                raise ValueError('Unsupported native Cubic scalar')
            start = offset + match.start(4)
            length = len(value[1]) + (2 if key == 'serverName' else 0)
            rows[key] = (value[1], start, start + length)
        offset += len(line)
    if set(rows) != set(NATIVE):
        raise ValueError('Publisher config must contain all three native Cubic keys')
    return text, rows


def effective_environment(shared, root, environment):
    kind, *_ = shared.selection(environment)
    if kind != 'cubic':
        raise ValueError('This adapter is Cubic Odyssey only')
    effective = dict(environment)
    file = shared.confined(root, FILE)
    if file.exists():
        _, rows = parse_config(shared.read_config(root, FILE, required=True))
        for key, variable in NATIVE.items():
            effective[variable] = rows[key][0]
    return effective


def controls(shared, environment):
    name = shared.text(environment.get('SERVER_NAME', 'Cubic Odyssey Server'))
    if any(char in name for char in '"\\'):
        raise ValueError('Native quoted server names cannot contain quotes/backslashes')
    privacy = environment.get('PRIVATE_SERVER', 'FALSE')
    seed = environment.get('GALAXY_SEED', '21945875634')
    mode = environment.get('GAMEMODE', 'adventure')
    if privacy not in ('TRUE', 'FALSE') or not re.fullmatch(r'[0-9]{1,11}', seed) or mode not in ('adventure', 'creative'):
        raise ValueError('Invalid original Cubic settings')
    shared.integer(environment, 'GAME_PORT', 20000, 1025, 65535)
    players = shared.integer(environment, 'MAX_PLAYERS', 20, 1, 2147483647)
    password = shared.text(environment.get('SERVER_PASSWORD', ''))
    return {'serverName': name, 'privateServer': privacy, 'galaxySeed': seed}, mode, players, password


def plan(shared, root, environment, require_payload=True):
    root = Path(root).resolve()
    effective = effective_environment(shared, root, environment)
    _, mode, players, password = controls(shared, effective)
    port = shared.integer(effective, 'SERVER_PORT', 8050, 1025, 65535)
    available = {int(value) for value in effective.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if value}
    if port not in available or any(not 1 <= value <= 65535 for value in available) or shared.integer(effective, 'GAME_PORT', 20000, 1025, 65535) != port:
        raise ValueError('Original GAME_PORT must match the selected primary allocation')
    binary = shared.confined(root, 'server/CubicOdysseyServer.exe')
    if require_payload and not binary.is_file():
        raise ValueError('Reinstall to restore the original Cubic server executable')
    if require_payload:
        shared.read_config(root, FILE, required=True)
    wine = shared.shutil.which('wine')
    if not wine or not os.environ.get('DISPLAY'):
        raise ValueError('Cubic requires its Wine runtime and headless display')
    child = {key: value for key, value in environment.items() if key not in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH')}
    child.update(HOME=str(root), LD_LIBRARY_PATH=str(root)+':'+str(root/'linux64')+':'+str(root/'.steam/sdk64'),
                 WINEARCH='win64', WINEPREFIX=str(shared.confined(root, '.wine')))
    credentials = [environment.get(key, '') for key in ('PASSWORD', 'SERVER_PASSWORD', 'STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    argv = [wine, str(binary), '-Port='+str(port), '-Password='+password, '-Gamemode='+mode, '-MaxNumPlayers='+str(players)]
    return argv, child, credentials, b'Lobbies (OnCreateLobbyFinished): lobby created.', '\x03'


def install(root, environment, validate=True, shared=None):
    shared = shared or shared_runtime()
    root = Path(root).resolve()
    effective = effective_environment(shared, root, environment)
    values, *_ = controls(shared, effective)
    config = shared.confined(root, FILE)
    absent = not config.exists()
    # The unchanged installer retains the explicit app_license_request, private
    # Steam refusal and all save/config/Wine-prefix preservation boundaries.
    result = shared.install(root, environment, validate=validate)
    if absent:
        previous = shared.read_config(root, FILE, required=True)
        content, rows = parse_config(previous)
        for key in sorted(rows, key=lambda key: rows[key][1], reverse=True):
            _, start, end = rows[key]
            value = json.dumps(values[key], ensure_ascii=False) if key == 'serverName' else values[key]
            content = content[:start] + value + content[end:]
        updated = (codecs.BOM_UTF8 if previous.startswith(codecs.BOM_UTF8) else b'') + content.encode()
        shared.publish_config(root, FILE, previous, updated)
    return result


def main(shared=None):
    shared = shared or shared_runtime()
    if sys.argv[1:] != ['run']:
        raise ValueError('Expected Cubic run')
    root, environment = Path.cwd().resolve(), dict(os.environ)
    automatic = environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '0'))
    if automatic not in ('0', '1'):
        raise ValueError('Invalid automatic update flag')
    plan(shared, root, environment, require_payload=automatic != '1')
    if automatic == '1':
        install(root, environment, validate=False, shared=shared)
    argv, child, credentials, ready, stop = plan(shared, root, environment)
    return shared.run(root, argv, child, stop, credentials=credentials, ready_marker=ready,
                      terminal_input=True, stop_signal=signal.SIGINT)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('Cubic startup refused; review native configuration, Wine/display and publisher prerequisites.', file=sys.stderr)
        sys.exit(1)
