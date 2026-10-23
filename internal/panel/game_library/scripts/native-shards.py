#!/usr/bin/env python3
"""MIT. Coordinate native shard processes without shell command interpolation."""
import os
import queue
import signal
import subprocess
import sys
import threading
from steam_template import Redactor


def run(root, specs, environment, stop_command, credentials=(), ready_message='VOLTRA_SHARDS_READY'):
    if not specs or len({spec['name'] for spec in specs}) != len(specs):
        raise ValueError('Choose distinct native shard names')
    children, readers = {}, []
    events, stopping, ready = queue.Queue(maxsize=1024), threading.Event(), set()
    write_lock = threading.Lock()

    def send(name, command):
        child = children[name]
        try:
            with write_lock:
                if child.poll() is None:
                    child.stdin.write(command);child.stdin.flush()
        except (BrokenPipeError, OSError):pass

    def read(spec, child):
        redactor, tail = Redactor(credentials), b''
        try:
            while True:
                block = child.stdout.readline()
                if not block:break
                tail = (tail + block)[-max(1024, len(spec['ready']) * 2):]
                if spec['ready'] in tail:events.put(('ready', spec['name'], None))
                if any(marker in tail for marker in spec.get('failed', ())):
                    events.put(('error', spec['name'], b'Native shard reported a fatal startup failure\n'))
                    stopping.set()
                filtered = redactor.feed(block, final=block.endswith(b'\n'))
                if filtered:events.put(('output', spec['name'], filtered))
            filtered = redactor.feed(b'', final=True)
            if filtered:events.put(('output', spec['name'], filtered))
        finally:events.put(('eof', spec['name'], None))

    def forward():
        pending = b''
        try:
            for block in iter(lambda:os.read(sys.stdin.fileno(), 65536), b''):
                pending += block
                if len(pending) > 1048576:
                    events.put(('error', '', b'Native console command exceeded its size limit\n'));stopping.set();return
                while b'\n' in pending:
                    command, pending = pending.split(b'\n', 1)
                    if command.rstrip(b'\r').decode('utf-8', errors='replace') == stop_command:
                        stopping.set();continue
                    name = specs[0]['name']
                    for candidate in children:
                        prefix = (candidate + '> ').encode()
                        if command.startswith(prefix):name, command = candidate, command[len(prefix):];break
                    send(name, command + b'\n')
        except OSError:pass

    def stop(*_):stopping.set()
    signal.signal(signal.SIGTERM, stop);signal.signal(signal.SIGINT, stop)
    try:
        for spec in specs:
            child = subprocess.Popen(spec['argv'], cwd=root, env=environment, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
            children[spec['name']] = child
            reader = threading.Thread(target=read, args=(spec, child), daemon=True)
            reader.start();readers.append(reader)
    except BaseException:
        for child in children.values():child.terminate()
        for child in children.values():child.wait()
        raise
    threading.Thread(target=forward, daemon=True).start()
    failed, stop_sent, announced, ended = False, False, False, set()
    while len(ended) < len(children):
        if not stopping.is_set() and any(child.poll() is not None for child in children.values()):
            failed = True;stopping.set()
        if stopping.is_set() and not stop_sent:
            for name in children:send(name, (stop_command + '\n').encode())
            stop_sent = True
        try:kind, name, value = events.get(timeout=0.1)
        except queue.Empty:continue
        if kind == 'ready':ready.add(name)
        elif kind == 'eof':ended.add(name)
        elif kind in ('output', 'error'):
            sys.stdout.buffer.write(('[' + name + '] ').encode() + value);sys.stdout.buffer.flush()
            if kind == 'error':failed = True
        if len(ready) == len(children) and not announced and not stopping.is_set():
            print(ready_message, flush=True);announced = True
    statuses = [child.wait() for child in children.values()]
    for child in children.values():child.stdin.close();child.stdout.close()
    for reader in readers:reader.join(timeout=2)
    return 1 if failed or not announced or any(status != 0 for status in statuses) else 0
