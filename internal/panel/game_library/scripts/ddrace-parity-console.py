#!/usr/bin/env python3
"""DDRace native FIFO bridge. Initialization is not protocol acceptance."""
import errno, os, queue, signal, stat, subprocess, sys, threading, time

def run(root, argv):
    fifo = root / '.voltra/ddnet/console.fifo'
    child = subprocess.Popen(argv, cwd=root / 'ddnet', stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    commands = queue.Queue(maxsize=128)
    stopping = threading.Event()
    native_ready = threading.Event()
    def stop(*_):
        stopping.set()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    def input_lines():
        for line in sys.stdin:
            if '\x00' in line or len(line.encode('utf-8')) > 4096:
                continue
            commands.put(line.rstrip('\r\n') + '\n')
    def output_lines():
        for line in iter(child.stdout.readline, b''):
            sys.stdout.buffer.write(line)
            sys.stdout.buffer.flush()
            if (b'server name is ' in line):
                native_ready.set()
    threading.Thread(target=input_lines, daemon=True).start()
    output = threading.Thread(target=output_lines, daemon=True)
    output.start()
    writer, shutdown_sent, reported, pending = None, False, False, None
    stop_deadline = None
    try:
        while child.poll() is None:
            if stopping.is_set():
                if stop_deadline is None:
                    stop_deadline = time.monotonic() + 15
                elif time.monotonic() >= stop_deadline:
                    child.kill()
                    return child.wait()
            if writer is None:
                try:
                    if fifo.exists() and stat.S_ISFIFO(fifo.lstat().st_mode):
                        writer = os.open(fifo, os.O_WRONLY | os.O_NONBLOCK)
                except OSError as error:
                    if error.errno not in (errno.ENXIO, errno.ENOENT):
                        raise
            if writer is not None:
                if native_ready.is_set() and not reported:
                    print('Voltra DDRace native initialized', flush=True)
                    reported = True
                if stopping.is_set() and not shutdown_sent:
                    pending = 'shutdown\n'
                    shutdown_sent = True
                elif pending is None:
                    try:
                        pending = commands.get_nowait()
                    except queue.Empty:
                        pass
                if pending:
                    try:
                        os.write(writer, pending.encode('utf-8'))
                        pending = None
                    except BlockingIOError:
                        pass
            time.sleep(0.02)
        return child.returncode
    finally:
        if child.poll() is None:
            child.send_signal(signal.SIGINT)
            child.wait(timeout=15)
        output.join(timeout=5)
        if writer is not None:
            os.close(writer)


