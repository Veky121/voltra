"""MIT. Private Portal Knights Wine display, console input and log forwarding.

Source-only until real publisher/native acceptance. Never kills a shared wineserver.
"""
import csv
import codecs
import io
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import sys
import threading
import time
from fantasy_worlds_runtime import confined, read_json
from fantasy_worlds_wine_build import verified_build
from steam_template import Redactor

MARKERS = (b'Listening on', b'ReadyToServe', b'has started')


class PrivateStream:
    """Normalize publisher UTF-8/UTF-16 logs before per-stream redaction."""
    def __init__(self, secrets):
        self.decoder, self.initial, self.redactor = None, b'', Redactor(secrets)
        self.readiness = Readiness()

    def feed(self, data, final=False):
        if self.decoder is None:
            self.initial += data
            if len(self.initial) < 4 and not final:
                return b''
            encoding = 'utf-16' if self.initial.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig'
            self.decoder = codecs.getincrementaldecoder(encoding)('strict')
            data, self.initial = self.initial, b''
        text = self.decoder.decode(data, final=final).encode('utf-8')
        self.readiness.feed(text)
        return self.redactor.feed(text, final=final or text.endswith(b'\n'))


class Readiness:
    def __init__(self):
        self.tail, self.ready = b'', False

    def feed(self, data):
        combined = self.tail + data
        changed = not self.ready and any(marker in combined for marker in MARKERS)
        self.ready |= changed
        self.tail = combined[-64:]
        return changed


def windows_pid(data):
    if len(data) > 65536:
        raise ValueError('Wine process listing exceeds limit')
    rows = [row for row in csv.reader(io.StringIO(data.decode('utf-8', 'strict')))
            if row and row[0].casefold() == 'pk_dedicated_server.exe']
    if len(rows) != 1 or len(rows[0]) < 2 or not re.fullmatch(r'[0-9]{1,10}', rows[0][1]) or not 0 < int(rows[0][1]) <= 0xffffffff:
        raise ValueError('Exactly one private Portal Knights Windows PID is required')
    return rows[0][1]


def console(root, environment, command):
    if not verified_build(root):
        raise ValueError('Reinstall to restore verified Portal console helper')
    data = command.encode('utf-8')
    if not data or len(data) > 8192 or any(byte in data for byte in (0, 10, 13)):
        raise ValueError('Invalid bounded native console command')
    if any(byte < 32 for byte in data) and data != b'\x03':
        raise ValueError('Unsupported native console control byte')
    environment = dict(environment, WINEDEBUG='-all')
    listed = subprocess.run(['wine', 'tasklist', '/FO', 'CSV', '/NH'], env=environment,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=8)
    if listed.returncode:
        raise ValueError('Private Wine process enumeration failed')
    pid = windows_pid(listed.stdout)
    result = subprocess.run(['wine', str(confined(root, '.voltra/fantasy_worlds_wine_console.exe')), pid],
                            input=data + b'\n', env=environment, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, timeout=8)
    if result.returncode:
        raise ValueError('Native console input failed')


def private_prefix(root, environment):
    prefix = confined(root, '.wine')
    architecture = environment.get('WINEARCH', 'win64')
    if architecture not in ('win32', 'win64'):
        raise ValueError('Unsupported Wine architecture')
    registry = confined(root, '.wine/system.reg')
    if registry.exists():
        with registry.open('rb') as stream:
            header = stream.read(65536)
        match = re.search(rb'(?m)^#arch=(win32|win64)\r?$', header)
        if not match or match[1].decode() != architecture:
            raise ValueError('Existing private Wine prefix has a different or unknown architecture')
    return dict(environment, WINEPREFIX=str(prefix), WINEARCH=architecture)


def display(environment):
    read, write = os.pipe()
    child = None
    try:
        child = subprocess.Popen(['Xvfb', '-displayfd', str(write), '-screen', '0', '800x600x24', '-nolisten', 'tcp', '-ac'],
                                 env=environment, pass_fds=(write,), stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        os.close(write); write = None
        deadline, value = time.monotonic() + 10, b''
        while b'\n' not in value:
            if time.monotonic() >= deadline or child.poll() is not None:
                raise ValueError('Private Xvfb display failed')
            if select.select([read], [], [], .1)[0]:
                chunk = os.read(read, 16)
                if not chunk or len(value) + len(chunk) > 16:
                    raise ValueError('Invalid private Xvfb display response')
                value += chunk
        number = value.strip()
        if not re.fullmatch(rb'[0-9]{1,5}', number):
            raise ValueError('Invalid private Xvfb display number')
        return child, dict(environment, DISPLAY=':' + number.decode())
    except BaseException:
        if child and child.poll() is None:
            child.terminate(); child.wait(timeout=5)
        raise
    finally:
        os.close(read)
        if write is not None:
            os.close(write)


def run(root, environment):
    root = root.resolve()
    environment = private_prefix(root, environment)
    if not verified_build(root):
        raise ValueError('Portal console helper source/binary receipt does not match')
    program = confined(root, 'dedicated_server/pk_dedicated_server.exe')
    if not program.is_file():
        raise ValueError('Missing official Portal Knights dedicated-server executable')
    config = read_json(confined(root, 'dedicated_server/server_config.json'))
    secrets = [config.get(role, {}).get('credentials', {}).get('password', '') for role in ('admins', 'users', 'guests')]
    if any(not isinstance(value, str) for value in secrets):
        raise ValueError('Invalid private Portal credential configuration')
    log = confined(root, 'dedicated_server/server.log')
    if log.exists():
        # A previous ready message must never mark this new process ready.
        backup = confined(root, 'dedicated_server/server.log.' + str(time.time_ns()) + '.previous')
        os.rename(log, backup)
        backup.chmod(0o600)
    screen, environment = display(environment)
    child, finished, stopping, send_lock, output_lock = None, threading.Event(), threading.Event(), threading.Lock(), threading.Lock()
    readiness = Readiness()
    streams = {'stdout': PrivateStream(secrets), 'log': PrivateStream(secrets)}
    def output(data, stream=None, final=False):
        with output_lock:
            if stream:
                data = streams[stream].feed(data, final)
            # Redact each stream before merging so interleaved log fragments
            # cannot break an otherwise contiguous credential match.
            sys.stdout.buffer.write(data)
            if not readiness.ready and any(channel.readiness.ready for channel in streams.values()):
                readiness.ready = True
                sys.stdout.buffer.write(b'\nVOLTRA_PORTAL_READY\n')
            sys.stdout.buffer.flush()
    def send(command):
        with send_lock:
            if child is not None and child.poll() is None:
                console(root, environment, command)
    def stop(*_):
        if not stopping.is_set():
            stopping.set()
            def deliver():
                try:
                    send('\x03')
                except Exception:
                    output(b'Portal native stop could not be delivered; process remains owned by normal Wings supervision.\n')
            threading.Thread(target=deliver, daemon=True).start()
    def commands():
        while not finished.is_set():
            line = sys.stdin.buffer.readline(8194)
            if not line:
                return
            if len(line) > 8193 or not line.endswith(b'\n'):
                output(b'Portal command exceeds bounded line length; console input closed.\n'); return
            if stopping.is_set():
                continue
            try:
                send(line.rstrip(b'\r\n').decode('utf-8', 'strict'))
            except Exception:
                output(b'Portal native console command rejected or unavailable.\n')
    def logs():
        offset, identity = 0, None
        while not finished.wait(.1):
            try:
                path = confined(root, 'dedicated_server/server.log')
                if not path.is_file():
                    continue
                descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(descriptor, 'rb') as stream:
                    metadata = os.fstat(stream.fileno())
                    current = (metadata.st_dev, metadata.st_ino)
                    if identity != current or metadata.st_size < offset:
                        offset, identity = 0, current
                    stream.seek(offset)
                    chunk = stream.read(65536)
                    offset += len(chunk)
                if chunk:
                    output(chunk, 'log')
            except Exception:
                output(b'Portal native log forwarding stopped after unsafe file change.\n'); return
    previous = {}
    try:
        for number in (signal.SIGINT, signal.SIGTERM):
            previous[number] = signal.signal(number, stop)
        child = subprocess.Popen(['wine', str(program), '-config', 'server_config.json', '-log', 'server.log'],
                                 cwd=program.parent, env=environment, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        threading.Thread(target=commands, daemon=True).start()
        threading.Thread(target=logs, daemon=True).start()
        while True:
            data = os.read(child.stdout.fileno(), 65536)
            if not data:
                break
            output(data, 'stdout')
        output(b'', 'stdout', final=True)
        return child.wait()
    finally:
        finished.set()
        for number, handler in previous.items():
            signal.signal(number, handler)
        if screen.poll() is None:
            screen.terminate()
            try:
                screen.wait(timeout=5)
            except subprocess.TimeoutExpired:
                screen.kill(); screen.wait(timeout=5)


if __name__ == '__main__':
    try:
        sys.exit(run(Path.cwd(), dict(os.environ)))
    except Exception:
        print('Portal Knights private Wine startup failed. Check licensed publisher payload, prefix architecture, display and console-helper receipt.', file=sys.stderr)
        sys.exit(1)
