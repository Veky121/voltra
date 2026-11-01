#!/usr/bin/env python3
"""IW4x-only strict config preflight around the retained arena supervisor."""
import importlib.util
import os
from pathlib import Path
import re
import sys
import secrets
import socket
import threading
import types

READY = 'VOLTRA_IW4X_LOCAL_MATCH_READY'


def valid_info(packet, challenge, mod):
    prefix = b'\xff\xff\xff\xffinfoResponse\n'
    if len(packet) > 8192 or not packet.startswith(prefix):
        return False
    try:
        text = packet[len(prefix):].decode('utf-8', errors='strict')
        if any(ord(c) < 32 for c in text) or not text.startswith('\\'):
            return False
        parts = text[1:].split('\\')
        if len(parts) % 2:
            return False
        info = {}
        for key, value in zip(parts[::2], parts[1::2]):
            if not key or key in info:
                return False
            info[key] = value
        return (info.get('challenge') == challenge and info.get('gamename') == 'IW4'
                and info.get('sv_running') == '1' and info.get('matchtype') == '2'
                and info.get('fs_game') == mod and bool(info.get('version'))
                and info.get('protocol', '').isdigit()
                and bool(re.fullmatch(r'[A-Za-z0-9_-]+', info.get('mapname', '')))
                and bool(re.fullmatch(r'[A-Za-z0-9_-]+', info.get('gametype', ''))))
    except UnicodeError:
        return False


def local_query(port, mod):
    challenge = secrets.token_hex(16)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as channel:
        channel.settimeout(0.5)
        channel.connect(('127.0.0.1', port))
        channel.send(b'\xff\xff\xff\xffgetinfo\n' + challenge.encode())
        return valid_info(channel.recv(8193), challenge, mod)


def readiness(child, finished, query, emit):
    while not finished.is_set() and child.poll() is None:
        try:
            matched = query()
        except OSError:
            matched = False
        if matched and not finished.is_set() and child.poll() is None:
            emit(READY)
            return
        if finished.wait(1):
            return


def supervised_run(console, root, argv, environment, *args, **kwargs):
    # A private module namespace intercepts only this supervisor's child creation.
    # The shared module and process-wide subprocess module are never mutated.
    finished = threading.Event()
    workers = []
    original = console.subprocess
    def spawn(*positional, **named):
        if '-dedicated' in argv:
            port = int(argv[argv.index('net_port') + 1])
            # Refuse an already occupied local listener before creating a child.
            # No SO_REUSEADDR: an old server must not satisfy the new gate.
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
                probe.bind(('127.0.0.1', port))
        child = original.Popen(*positional, **named)
        if '-dedicated' in argv:
            port = int(argv[argv.index('net_port') + 1])
            mod = argv[argv.index('fs_game') + 1]
            worker = threading.Thread(target=readiness, args=(child, finished,
                lambda: local_query(port, mod), lambda message: print(message, flush=True)), daemon=True)
            workers.append(worker)
            worker.start()
        return child
    console.subprocess = types.SimpleNamespace(**{**vars(original), 'Popen': spawn})
    try:
        return console.run(root, argv, environment, *args, **kwargs)
    finally:
        finished.set()
        for worker in workers:
            worker.join(timeout=2)
        console.subprocess = original


def run(root, env):
    original = arena.helper
    configure = arena.configure
    def checked_configure(root, game, env):
        preflight(root, env)
        return configure(root, game, env)
    def helper(name):
        module = original(name)
        if name != 'native-console':
            return module
        native_run = module.run
        proxy = types.SimpleNamespace(**vars(module))
        def invoke(*args, **kwargs):
            # Keep the function globals in the freshly loaded private module.
            module.run = native_run
            return supervised_run(module, *args, **kwargs)
        proxy.run = invoke
        return proxy
    arena.helper = helper
    arena.configure = checked_configure
    try:
        return arena.run(root, 'iw4x', env)
    finally:
        arena.helper = original
        arena.configure = configure


def load():
    spec = importlib.util.spec_from_file_location('iw4x_arena', Path(__file__).with_name('arena-native.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def commands(content):
    """Tokenize native command rows, preserving source spans for managed edits.

    Reject ambiguity rather than silently dropping chained operator commands.
    Unknown well-formed commands remain byte-for-byte unchanged.
    """
    if any(ord(c) < 32 and c not in '\r\n\t' for c in content):
        raise ValueError('Control character in IW4x config')
    rows = []
    for line in content.splitlines(keepends=True):
        quoted = False
        end = len(line.rstrip('\r\n'))
        for i, char in enumerate(line[:end]):
            if char == '"':
                quoted = not quoted
            if not quoted and line.startswith('//', i):
                end = i
                break
            if not quoted and char == ';':
                raise ValueError('Split chained IW4x commands into separate rows before editing')
        code = line[:end]
        if quoted or '\\"' in code or '/*' in code or '*/' in code:
            raise ValueError('Ambiguous quoting or block comment in IW4x config')
        tokens = re.findall(r'"[^"\r\n]*"|[^\s"]+', code)
        rows.append((line, end, tokens))
    return rows


def patch(content, name, password):
    values = {'sv_hostname': arena.iw4_text(name), 'g_password': arena.iw4_text(password)}
    seen = set()
    output = []
    newline = '\r\n' if '\r\n' in content else '\n'
    for line, end, tokens in commands(content):
        offset = 1 if tokens and tokens[0].lower() in ('set', 'seta', 'sets') else 0
        key = tokens[offset].lower() if len(tokens) > offset else ''
        if key in values:
            if key in seen or len(tokens) != offset + 2:
                raise ValueError('Duplicate or malformed managed IW4x Dvar')
            seen.add(key)
            indent = line[:len(line) - len(line.lstrip())]
            comment = line[end:].rstrip('\r\n')
            line = indent + 'set ' + key + ' ' + values[key] + (' ' + comment if comment else '') + newline
        output.append(line)
    for key in (key for key in values if key not in seen):
        if output and not output[-1].endswith(('\r', '\n')):
            output[-1] += newline
        output.append('set ' + key + ' ' + values[key] + newline)
    return ''.join(output)


def preflight(root, env):
    root = Path(root).resolve()
    if env.get('INSTALL_MODE', 'existing') != 'existing':
        raise ValueError('IW4x requires a legitimate operator-owned prepared package; private acquisition is unavailable')
    # Refuse links at every component, including links which resolve internally.
    for name in ('.voltra', 'userraw', 'main', 'zone', 'iw4x', 'players', 'mods', 'iw4x.exe', 'iw4x.dll', 'iw4x-launcher'):
        path = root / name
        if path.is_symlink():
            raise ValueError('IW4x payload/config links are unsupported')
        if path.is_dir():
            for item in path.rglob('*'):
                if item.is_symlink():
                    raise ValueError('IW4x payload/config links are unsupported')
    arena.validate(root, 'iw4x', env)
    mod = env.get('MOD_DIR', '')
    if mod:
        if not re.fullmatch(r'mods/[A-Za-z0-9_-]+', mod):
            raise ValueError('IW4x Mod Dir must be an uploaded mods/name directory')
        if not (root / mod).is_dir():
            raise ValueError('Upload the selected IW4x mod first')
        # A mod-local server.cfg shadows userraw/server.cfg through fs_game.
        if (root / mod / 'server.cfg').exists():
            raise ValueError('Mod-local server.cfg shadows the managed userraw/server.cfg')
    # Loose configs can supersede the selected document or run before it.
    for directory in ('', 'main', 'iw4x', 'players', 'userraw', mod):
        for filename in ('server.cfg', 'autoexec.cfg', 'default_mp.cfg'):
            candidate = root / directory / filename
            if candidate == root / 'userraw/server.cfg':
                continue
            if candidate.exists() or candidate.is_symlink():
                raise ValueError('IW4x loose config shadows managed authority')
    path = root / 'userraw/server.cfg'
    with path.open(encoding='utf-8-sig', newline='') as source:
        content = source.read()
        # Do not follow arbitrary exec/vstr/alias graphs or accept commands that
        # can alter filesystem selection. Unknown scalar Dvars stay untouched.
        for _, _, tokens in commands(content):
            if not tokens:
                continue
            offset = 1 if tokens[0].lower() in ('set', 'seta', 'sets') else 0
            if len(tokens) != offset + 2 or (offset == 0 and tokens[0].lower() in ('exec', 'vstr', 'alias', 'wait', 'map', 'map_rotate')):
                raise ValueError('IW4x executable config chain is unsupported')
            if tokens[offset].lower().startswith('fs_'):
                raise ValueError('IW4x filesystem Dvars are launcher-owned')
        patch(content, env.get('SERVER_NAME', 'Pterodactyl IW4X'), env.get('SERVER_PASSWORD', ''))


arena = load()
arena.patch_iw4 = patch

if __name__ == '__main__':
    try:
        mode = sys.argv[1]
        preflight(Path.cwd(), dict(os.environ))
        if mode == 'preflight':
            print('IW4x structural preflight passed; ownership, completeness and native readiness unverified')
        elif mode == 'install':
            arena.install(Path.cwd(), 'iw4x', dict(os.environ))
        elif mode == 'run':
            sys.exit(run(Path.cwd(), dict(os.environ)))
        else:
            raise ValueError('Expected preflight, install or run')
    except Exception:
        # Config/path exceptions must never echo uploaded secrets.
        print('IW4x preflight/runtime failed; verify owned payload, Dvar syntax, allocation and launcher pin', file=sys.stderr)
        sys.exit(1)
