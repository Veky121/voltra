#!/usr/bin/env python3
"""MIT. Native Rust settings, persistent identity and authenticated WebRCON console."""
import base64
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import secrets
import shlex
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import quote, urlsplit
from steam_template import Redactor, update


def value(text, maximum=4096):
    if len(text.encode('utf-8')) > maximum or any(ord(c) < 32 or ord(c) == 127 for c in text):
        raise ValueError('Rust settings cannot contain controls or exceed their size limit')
    return text


def number(env, key, default, low, high):
    result = int(env.get(key, str(default)))
    if not low <= result <= high:raise ValueError('Invalid Rust setting: ' + key)
    return result


def private_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.voltra-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:stream.write(data)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)


def configure(root, env):
    root = root.resolve()
    identity = env.get('SERVER_ID', 'rust')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', identity):raise ValueError('Invalid Rust save identity')
    state, config = root/'.voltra/rust', root/'server'/identity/'cfg/server.cfg'
    if any(not p.resolve().is_relative_to(root) for p in (state, config)):
        raise ValueError('Rust configuration escapes this server volume')
    allocated = {int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if p}
    primary = number(env, 'SERVER_PORT', 28015, 1, 65535)
    remaining = sorted(allocated - {primary})
    if len(remaining) < 3 or primary not in allocated:raise ValueError('Allocate four distinct Rust ports on the same address')
    # The shared form selects the allocations; stale upstream hardcoded port defaults
    # are replaced only when they are not part of the selected allocations.
    ports = [primary]
    for key in ('QUERY_PORT', 'RCON_PORT', 'APP_PORT'):
        requested = int(env.get(key, '0'))
        if key == 'APP_PORT' and requested == -1:
            ports.append(-1);continue
        chosen = requested if requested in remaining else remaining[0]
        ports.append(chosen);remaining.remove(chosen)
    game, query_port, rcon, app = ports
    password = value(env.get('RCON_PASS', ''), 128)
    password_file = state/'rcon-password'
    if not password or password == 'CHANGEME':
        password = password_file.read_text().strip() if password_file.exists() else secrets.token_urlsafe(32)
    if not 8 <= len(password) <= 128:raise ValueError('Rust RCON password must contain 8 to 128 characters')
    value(password, 128)
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', password):raise ValueError('Use letters, digits, underscores, dots or hyphens for RCON password')
    maximum = number(env, 'MAX_PLAYERS', 40, 1, 1000)
    size = number(env, 'WORLD_SIZE', 3000, 1000, 6000)
    interval = number(env, 'SAVEINTERVAL', 60, 1, 86400)
    seed = number(env, 'WORLD_SEED', 0, 0, 2147483647) if env.get('WORLD_SEED', '') else 0
    seed_file = root/'seed.txt'
    if not seed_file.resolve().is_relative_to(root):raise ValueError('Rust seed path escapes volume')
    if not seed:
        seed = int(seed_file.read_text().strip()) if seed_file.exists() else secrets.randbelow(2147483646)+1
        if not 0 <= seed <= 2147483647:raise ValueError('Invalid stored Rust world seed')
    settings = {
        'server.port': str(game), 'server.queryport': str(query_port),
        'rcon.ip': '0.0.0.0', 'rcon.port': str(rcon), 'rcon.web': 'true',
        'rcon.password': password, 'app.port': str(app),
        'server.hostname': value(env.get('HOSTNAME', 'A Rust Server'), 512),
        'server.level': value(env.get('LEVEL', 'Procedural Map'), 128),
        'server.description': value(env.get('DESCRIPTION', ''), 4096),
        'server.url': value(env.get('SERVER_URL', ''), 2048),
        'server.headerimage': value(env.get('SERVER_IMG', ''), 2048),
        'server.logoimage': value(env.get('SERVER_LOGO', ''), 2048),
        'server.maxplayers': str(maximum), 'server.saveinterval': str(interval),
        'server.worldsize': str(size), 'server.seed': str(seed),
        'server.levelurl': value(env.get('MAP_URL', ''), 2048),
    }
    if settings['server.levelurl'] and urlsplit(settings['server.levelurl']).scheme != 'https':
        raise ValueError('Custom Rust maps require an HTTPS URL')
    extras = shlex.split(value(env.get('ADDITIONAL_ARGS', ''), 8192))
    # Additional native switches remain supported. Reject managed duplicates which
    # would make form settings and actual binding disagree.
    if any(arg.lstrip('+-').casefold() in settings or arg.lstrip('+-').casefold() == 'server.identity' for arg in extras):
        raise ValueError('Set managed Rust settings using their form fields')
    original = config.read_text(encoding='utf-8') if config.exists() else ''
    lines = [line for line in original.splitlines() if not line.strip() or line.lstrip().startswith('//') or line.strip().split(None, 1)[0].casefold() not in settings]
    lines += [key + ' ' + json.dumps(item, ensure_ascii=False) for key, item in settings.items()]
    content = '\n'.join(lines)+'\n'
    binary = root/'RustDedicated'
    if not binary.is_file():raise ValueError('Steam installation is missing RustDedicated')
    private_write(password_file, password+'\n')
    if not seed_file.exists():private_write(seed_file, str(seed)+'\n')
    if original != content:
        if config.exists():private_write(state/'config-backups'/(str(time.time_ns())+'-server.cfg'), original)
        private_write(config, content)
    else:config.chmod(0o600)
    child_env = dict(os.environ)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD'):child_env.pop(key, None)
    child_env['LD_LIBRARY_PATH'] = str(root/'RustDedicated_Data/Plugins/x86_64')+':'+str(root/'.steam/sdk64')
    framework = env.get('FRAMEWORK', 'vanilla')
    metadata = state/'framework.json'
    if not metadata.resolve().is_relative_to(root):raise ValueError('Rust framework metadata escapes this volume')
    if metadata.exists():
        if metadata.stat().st_size > 65536:raise ValueError('Invalid Rust framework metadata')
        if json.loads(metadata.read_text()).get('framework') != framework:
            raise ValueError('Reinstall or enable automatic updates after changing the Rust framework')
    elif framework != 'vanilla':raise ValueError('Install the selected Rust framework before starting')
    if framework == 'carbon':
        loader = root/'libdoorstop.so'
        assembly = root/'carbon/managed/Carbon.Preloader.dll'
        if not loader.is_file() or not assembly.is_file():raise ValueError('Carbon loader is missing; reinstall the selected framework')
        child_env.update({'LD_PRELOAD':str(loader), 'DOORSTOP_ENABLED':'1', 'DOORSTOP_TARGET_ASSEMBLY':str(assembly), 'TERM':'xterm', 'LD_LIBRARY_PATH':str(root)+':'+child_env['LD_LIBRARY_PATH']})
    elif framework not in ('vanilla', 'oxide'):raise ValueError('Choose vanilla, oxide or carbon')
    # Rust initializes WebRCON before reading server.cfg. These initial binding
    # values must be explicit native arguments; log output is redacted by run().
    argv = [str(binary), '-batchmode', '-nographics', '-logfile', '-', '+server.identity', identity,
            '+server.port', str(game), '+server.queryport', str(query_port),
            '+rcon.ip', '0.0.0.0', '+rcon.port', str(rcon), '+rcon.web', '1', '+rcon.password', password,
            '+app.port', '1-' if app == -1 else str(app), *extras]
    return argv, child_env, rcon, password


class WebRCON:
    """Small bounded RFC6455 client for Rust's native JSON RCON protocol."""
    def __init__(self, port, password):
        self.socket = socket.create_connection(('127.0.0.1', port), timeout=3)
        self.buffer = b''
        key = base64.b64encode(secrets.token_bytes(16)).decode()
        request = 'GET /'+quote(password, safe='')+' HTTP/1.1\r\nHost: 127.0.0.1:'+str(port)+'\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: '+key+'\r\nSec-WebSocket-Version: 13\r\n\r\n'
        self.socket.sendall(request.encode())
        while b'\r\n\r\n' not in self.buffer:
            block = self.socket.recv(4096)
            if not block:raise OSError('Rust WebRCON closed during handshake')
            self.buffer += block
            if len(self.buffer) > 16384:raise ValueError('Oversized WebRCON handshake')
        header, self.buffer = self.buffer.split(b'\r\n\r\n', 1)
        expected = base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
        headers = {}
        for line in header.split(b'\r\n')[1:]:
            if b':' in line:
                name, item = line.split(b':', 1);headers[name.lower()] = item.strip()
        if not header.split(b'\r\n')[0].startswith(b'HTTP/1.1 101 ') or headers.get(b'sec-websocket-accept') != expected:
            self.close();raise OSError('Rust WebRCON authentication or upgrade failed')
        self.sequence = 0

    def close(self):self.socket.close()

    def frame(self, payload, opcode=1):
        if len(payload) > 1048576:raise ValueError('WebRCON message exceeds limit')
        mask = secrets.token_bytes(4)
        length = len(payload)
        prefix = bytes([0x80 | opcode, 0x80 | length]) if length < 126 else bytes([0x80 | opcode, 0xfe])+struct.pack('!H', length) if length <= 65535 else bytes([0x80 | opcode, 0xff])+struct.pack('!Q', length)
        self.socket.sendall(prefix+mask+bytes(byte ^ mask[i%4] for i, byte in enumerate(payload)))

    def send(self, command):
        self.sequence += 1
        self.frame(json.dumps({'Identifier':self.sequence, 'Message':command, 'Name':'Voltra'}).encode())

    def take(self, count):
        while len(self.buffer) < count:
            block = self.socket.recv(max(4096, count-len(self.buffer)))
            if not block:raise OSError('Rust WebRCON disconnected')
            self.buffer += block
        result, self.buffer = self.buffer[:count], self.buffer[count:]
        return result

    def receive(self):
        # Keep the complete frame buffered until available. A socket timeout in
        # a fragmented frame must not discard its already-read header.
        def ensure(count):
            while len(self.buffer) < count:
                block = self.socket.recv(max(4096, count-len(self.buffer)))
                if not block:raise OSError('Rust WebRCON disconnected')
                self.buffer += block
        ensure(2)
        first, second = self.buffer[:2]
        length = second & 127
        offset = 2
        if length == 126:
            ensure(4);length = struct.unpack('!H', self.buffer[2:4])[0];offset = 4
        elif length == 127:
            ensure(10);length = struct.unpack('!Q', self.buffer[2:10])[0];offset = 10
        if length > 1048576:raise ValueError('WebRCON response exceeds limit')
        if second & 128:raise ValueError('Server WebSocket frame must not be masked')
        ensure(offset+length)
        payload, self.buffer = self.buffer[offset:offset+length], self.buffer[offset+length:]
        opcode = first & 15
        if opcode == 8:raise OSError('Rust WebRCON closed')
        if opcode == 9:self.frame(payload, 10);return None
        if opcode != 1 or not first & 128:raise ValueError('Unsupported Rust WebRCON frame')
        return json.loads(payload)


def run(root, argv, environment, port, password, credentials=()):
    child = subprocess.Popen(argv, cwd=root, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    finished, ready, stopping, transport_ready = threading.Event(), threading.Event(), threading.Event(), threading.Event()
    commands = queue.Queue(maxsize=256)
    lock = threading.Lock()
    announcement_lock = threading.Lock()
    announced = False
    def emit(data):
        with lock:
            sys.stdout.buffer.write(data);sys.stdout.buffer.flush()
    def announce():
        nonlocal announced
        with announcement_lock:
            if ready.is_set() and transport_ready.is_set() and not announced:
                announced = True;emit(b'VOLTRA_RUST_READY\n')
    def output():
        redactor = Redactor([password, *credentials])
        for line in iter(child.stdout.readline, b''):
            if b'Server startup complete' in line:ready.set();announce()
            emit(redactor.feed(line, final=line.endswith(b'\n')))
        emit(redactor.feed(b'', final=True))
    def input_commands():
        pending = b''
        try:
            for block in iter(lambda:os.read(sys.stdin.fileno(), 65536), b''):
                pending += block
                if len(pending) > 1048576:raise ValueError('Rust console input exceeds limit')
                while b'\n' in pending:
                    line, pending = pending.split(b'\n', 1)
                    command = line.decode('utf-8').rstrip('\r')
                    if command.strip().casefold() == 'quit':stopping.set()
                    elif command.strip():commands.put(command, timeout=3)
        except (OSError, ValueError, queue.Full):emit(b'Rust console input rejected or closed.\n')
    def rcon_loop():
        stop_sent = False
        while not finished.is_set():
            connection = None
            try:
                connection = WebRCON(port, password)
                transport_ready.set();announce()
                emit(b'VOLTRA_RUST_RCON_READY\n')
                # Native stdout is authoritative; RCON replies supply command results.
                redactor = Redactor([password, *credentials])
                while not finished.is_set():
                    if stopping.is_set() and not stop_sent:
                        connection.send('quit');stop_sent = True
                    try:command = commands.get_nowait()
                    except queue.Empty:command = None
                    if command:connection.send(command)
                    connection.socket.settimeout(0.2)
                    try:message = connection.receive()
                    except socket.timeout:continue
                    if isinstance(message, dict) and message.get('Identifier', 0) > 0:
                        emit(redactor.feed((str(message.get('Message', ''))+'\n').encode(), final=True))
            except (OSError, ValueError, json.JSONDecodeError):
                if not finished.wait(1):continue
            finally:
                if connection:connection.close()
    native_stopping = threading.Event()
    def stop(*_):
        # Rust's RCON quit path terminates differently from Unity's native
        # shutdown signal. Let the publisher finish its save and teardown hooks.
        if child.poll() is None and not native_stopping.is_set():
            native_stopping.set();child.send_signal(signal.SIGTERM)
    signal.signal(signal.SIGTERM, stop);signal.signal(signal.SIGINT, stop)
    threads = [threading.Thread(target=target, daemon=True) for target in (output, input_commands, rcon_loop)]
    for thread in threads:thread.start()
    try:
        code = child.wait()
        threads[0].join(timeout=2)
        return code if announced else (code or 1)
    finally:
        finished.set();threads[0].join(timeout=2);child.stdout.close()


def main():
    root = Path.cwd().resolve()
    environment = dict(os.environ)
    if environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '0')) == '1':
        from rust_install import install
        install(root, environment, wipe=False)
    argv, child_env, port, password = configure(root, environment)
    return run(root, argv, child_env, port, password, [environment.get(name, '') for name in ('STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')])


if __name__ == '__main__':raise SystemExit(main())
