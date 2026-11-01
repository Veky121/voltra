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


def root_words(text):
    """Locate only publisher GameParams/m_server ServerParams row tokens."""
    words, stack, header, index = set(), [], [], 0
    masked = list(text)
    header_line, leading, outer, servers, closed = -1, False, 0, 0, False
    while index < len(text):
        char = text[index]
        if char in ' \t\r\n':
            index += 1
            continue
        if text.startswith('//', index) or char == '#':
            end = text.find('\n', index)
            end = len(text) if end < 0 else end
            for at in range(index, end):
                if text[at] not in '\r\n': masked[at] = ' '
            index = end
            continue
        if text.startswith('/*', index):
            end = text.find('*/', index + 2)
            if end < 0:
                raise ValueError('Unterminated native comment')
            for at in range(index, end + 2):
                if text[at] not in '\r\n': masked[at] = ' '
            index = end + 2
            continue
        if closed:
            raise ValueError('Unexpected text after native outer block')
        if char == '"':
            header = []
            index += 1
            while index < len(text):
                if ord(text[index]) < 32 or ord(text[index]) in (127, 133, 8232, 8233):
                    raise ValueError('Control in native quoted string')
                if text[index] == '\\':
                    index += 2
                elif text[index] == '"':
                    index += 1
                    break
                else:
                    index += 1
            else:
                raise ValueError('Unterminated native quoted string')
            continue
        if char in '{[':
            names = [word for word, *_ in header] if leading else []
            label = '?'
            if not stack:
                if char != '{' or names != ['GameParams'] or outer:
                    raise ValueError('Expected publisher GameParams object')
                outer += 1
                label = 'GameParams'
            elif len(stack) == 1 and stack[0][1] == 'GameParams' and names and names[0].lower() == 'm_server':
                if char != '{' or names != ['m_server', 'ServerParams'] or servers:
                    raise ValueError('Ambiguous publisher server namespace')
                servers += 1
                label = 'm_server'
            stack.append((char, label))
            header, header_line = [], -1
            if len(stack) > 128:
                raise ValueError('Native nesting limit exceeded')
            index += 1
            continue
        if char in '}]':
            if not stack or stack.pop()[0] != ('{' if char == '}' else '['):
                raise ValueError('Unbalanced native block')
            if not stack:
                closed = True
            header, header_line = [], -1
            index += 1
            continue
        start = index
        while index < len(text) and text[index] not in ' \t\r\n{}[]"#' and not text.startswith(('//', '/*'), index):
            index += 1
        if index == start:
            raise ValueError('Invalid native token')
        line = text.rfind('\n', 0, start) + 1
        if line != header_line:
            header, header_line = [], line
            leading = not ''.join(masked[line:start]).strip()
        header.append((text[start:index], start))
        if len(header) > 32:
            raise ValueError('Unsupported native header width')
        if [entry[1] for entry in stack] == ['GameParams', 'm_server'] and not ''.join(masked[line:start]).strip():
            words.add(start)
            if len(words) > 8000:
                raise ValueError('Native root row limit exceeded')
    if stack or outer != 1 or servers != 1:
        raise ValueError('Unbalanced native block')
    return words, ''.join(masked)


def parse_config(data):
    if len(data) > 8 * 1024 * 1024:
        raise ValueError('Native Cubic config exceeds limit')
    text = data.decode('utf-8-sig')
    if '\x00' in text:
        raise ValueError('NUL in native Cubic config')
    eligible, schema = root_words(text)
    lines, rows, offset = schema.splitlines(keepends=True), {}, 0
    folded = {key.lower(): key for key in NATIVE}
    for line in lines:
        content = line.rstrip('\r\n')
        prefix = re.match(r'^([ \t]*)([A-Za-z][A-Za-z0-9]*)(.*)$', content)
        match = re.match(r'^([ \t]*)([A-Za-z][A-Za-z0-9]*)([ \t]+)(.*)$', content)
        if prefix and offset + prefix.start(2) in eligible and prefix[2].lower() in folded:
            if not match:
                raise ValueError('Unsupported native field separator')
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
    directory = shared.confined(root, 'config')
    if directory.exists() and not directory.is_dir():
        raise ValueError('Native Cubic config parent must be a directory')
    file = shared.confined(root, FILE)
    if file.exists():
        _, rows = parse_config(shared.read_config(root, FILE, required=True))
        for key, variable in NATIVE.items():
            effective[variable] = rows[key][0]
    return effective


def controls(shared, environment):
    name = shared.text(environment.get('SERVER_NAME', 'Cubic Odyssey Server'))
    if any(char in name for char in '"\\') or any(ord(char) in (133, 8232, 8233) for char in name):
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
    if absent and shared.confined(root, FILE + '.sample').exists():
        parse_config(shared.read_config(root, FILE + '.sample', required=True))
    # The unchanged installer retains the explicit app_license_request, private
    # Steam refusal and all save/config/Wine-prefix preservation boundaries.
    result = shared.install(root, environment, validate=validate)
    if absent:
        # The actual publisher ships only .sample and ~server_config.txt. The
        # supported .sample is the first-install seed; the backup is not a
        # default. Existing operator config never enters this branch.
        previous = shared.read_config(root, FILE)
        seed = previous or shared.read_config(root, FILE + '.sample', required=True)
        content, rows = parse_config(seed)
        for key in sorted(rows, key=lambda key: rows[key][1], reverse=True):
            _, start, end = rows[key]
            value = json.dumps(values[key], ensure_ascii=False) if key == 'serverName' else values[key]
            content = content[:start] + value + content[end:]
        updated = (codecs.BOM_UTF8 if seed.startswith(codecs.BOM_UTF8) else b'') + content.encode()
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
