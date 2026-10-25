#!/usr/bin/env python3
"""MIT. FortressCraft's authenticated loopback RCON console, not a game protocol query.

Framing follows the reviewed source-l4d.py standard RCON implementation. No command
is retried after a send begins: a lost acknowledgement is not proof of nonexecution.
"""
import os
from pathlib import Path
import queue
import signal
import socket
import struct
import subprocess
import sys
import threading
import time


class BeforeSend(Exception):
    pass


class AfterSend(Exception):
    pass


def packet(identifier, kind, body):
    data = struct.pack('<ii', identifier, kind) + body.encode('utf-8') + b'\0\0'
    return struct.pack('<i', len(data)) + data


def read(connection):
    deadline = time.monotonic() + connection.gettimeout() if connection.gettimeout() else None
    def exact(size):
        result = bytearray()
        while len(result) < size:
            if deadline is not None:
                connection.settimeout(max(0.001, deadline - time.monotonic()))
                if time.monotonic() >= deadline:
                    raise socket.timeout('RCON frame deadline')
            part = connection.recv(size - len(result))
            if not part:
                raise OSError('RCON connection closed')
            result.extend(part)
        return bytes(result)
    size, = struct.unpack('<i', exact(4))
    if not 10 <= size <= 65536:
        raise ValueError('Invalid RCON frame size')
    data = exact(size)
    if data[-2:] != b'\0\0':
        raise ValueError('Invalid RCON terminator')
    identifier, kind = struct.unpack('<ii', data[:8])
    return identifier, kind, data[8:-2].decode('utf-8', 'strict')


def command(port, password, text, timeout=2):
    if not 1 <= port <= 65535 or not text or len(text.encode('utf-8')) > 2048 or any(ord(c) < 32 or ord(c) == 127 for c in text):
        raise ValueError('Invalid allocated RCON port or console command')
    sent = False
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=timeout) as connection:
            connection.settimeout(timeout)
            connection.sendall(packet(4101, 3, password))
            for _ in range(8):
                identifier, kind, _ = read(connection)
                if identifier == -1:
                    raise ValueError('RCON authentication rejected')
                if identifier == 4101 and kind == 2:
                    break
            else:
                raise ValueError('Missing RCON authentication response')
            sent = True
            connection.sendall(packet(4102, 2, text))
            result = []
            total = 0
            for _ in range(32):
                try:
                    identifier, kind, body = read(connection)
                except OSError:
                    if result:
                        return ''.join(result)
                    raise
                if identifier == 4102 and kind == 0:
                    total += len(body.encode('utf-8'))
                    if total > 131072:
                        raise ValueError('RCON response exceeds bound')
                    result.append(body)
                elif identifier != 4101 or kind != 0:
                    raise ValueError('Unexpected RCON response identifier/type')
            raise ValueError('RCON response frame limit')
    except (OSError, ValueError, UnicodeError) as error:
        raise (AfterSend if sent else BeforeSend)('RCON command acknowledgement unavailable' if sent else 'RCON authentication/connection unavailable') from error


def native_environment(environment):
    result = dict(environment)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'VOLTRA_FORTRESS_RCON_PASSWORD', 'RCON_PASSWORD'):
        result.pop(key, None)
    return result


def bridge(argv, port, password, startup_timeout=60, stop_timeout=90):
    child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, env=native_environment(os.environ), start_new_session=True)
    commands = queue.Queue(maxsize=16)
    stopping = threading.Event()
    previous = {}
    for sig in (signal.SIGTERM, signal.SIGINT):
        previous[sig] = signal.signal(sig, lambda *_: stopping.set())

    def input_lines():
        pending = bytearray()
        try:
            while True:
                chunk = os.read(0, 1024)
                if not chunk:
                    return
                pending.extend(chunk)
                if len(pending) > 4096:
                    raise ValueError('Console input exceeds bound')
                while b'\n' in pending:
                    line, _, remainder = pending.partition(b'\n')
                    pending[:] = remainder
                    line = line.rstrip(b'\r').decode('utf-8', 'strict')
                    if line:
                        commands.put_nowait(line)
        except (OSError, ValueError, UnicodeError, queue.Full):
            print('Fortress console input rejected: bounded UTF-8 lines required.', flush=True)
    threading.Thread(target=input_lines, daemon=True).start()
    deadline = None
    quit_attempted = False
    try:
        while child.poll() is None:
            if stopping.is_set() and not quit_attempted:
                line = 'quit'
            else:
                try:
                    line = commands.get(timeout=0.1)
                except queue.Empty:
                    line = None
            if line and not quit_attempted:
                is_quit = line.strip().lower() == 'quit'
                if is_quit:
                    quit_attempted = True
                    deadline = time.monotonic() + startup_timeout + stop_timeout
                retry_until = time.monotonic() + startup_timeout
                while child.poll() is None:
                    try:
                        response = command(port, password, line)
                        print(response, flush=True)
                        break
                    except BeforeSend as error:
                        if isinstance(error.__cause__, (ValueError, UnicodeError)):
                            print('Fortress RCON authentication/protocol rejected; command not submitted.', flush=True)
                            break
                        if time.monotonic() >= retry_until:
                            print('Fortress RCON unavailable before command send; command not submitted.', flush=True)
                            break
                        time.sleep(0.1)
                    except (AfterSend, ValueError):
                        print('Fortress command outcome unconfirmed; command will not be replayed.', flush=True)
                        break
                if is_quit:
                    deadline = time.monotonic() + stop_timeout
            if deadline is not None and time.monotonic() >= deadline:
                print('Fortress graceful shutdown timed out; save completion unconfirmed.', flush=True)
                break
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
        return child.wait()
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
        # An exited leader can leave descendants in our separate owned session.
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def supervise(native, root, argv, environment, credentials, port):
    bridge_env = dict(environment)
    bridge_env.update(PYTHONHOME=sys.prefix, LD_LIBRARY_PATH=str(Path(sys.prefix) / 'lib'),
                      VOLTRA_FORTRESS_RCON_PASSWORD=credentials[0])
    return native.run(root, [sys.executable, str(Path(__file__).resolve()), str(port), *argv],
                      bridge_env, 'quit', credentials, terminal_input=True)


if __name__ == '__main__':
    code = bridge(sys.argv[2:], int(sys.argv[1]), os.environ['VOLTRA_FORTRESS_RCON_PASSWORD'])
    if code < 0:
        signal.signal(-code, signal.SIG_DFL)
        os.kill(os.getpid(), -code)
    sys.exit(code)
