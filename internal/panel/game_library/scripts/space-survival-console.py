#!/usr/bin/env python3
"""MIT. Empyrion's original raw loopback admin channel, supervised game group."""
import os
import queue
import signal
import socket
import subprocess
import sys
import threading
import time


def run(port, argv, environment):
    password=environment.pop('VOLTRA_EMPYRION_PASSWORD','')
    process=subprocess.Popen(argv,env=environment,start_new_session=True)
    commands=queue.Queue(maxsize=64);finished=threading.Event();connection=None
    def stdin():
        while not finished.is_set():
            data=sys.stdin.buffer.readline(8193)
            if not data:break
            if len(data)>8192 or b'\0'in data:continue
            try:commands.put(data.rstrip(b'\r\n')+b'\r\n',timeout=.2)
            except queue.Full:print('Admin command queue full; command rejected.',file=sys.stderr)
    reader=threading.Thread(target=stdin,daemon=True);reader.start()
    def interrupted(signum,frame):raise SystemExit(128+signum)
    previous={sig:signal.signal(sig,interrupted)for sig in(signal.SIGTERM,signal.SIGINT)}
    try:
        deadline=time.monotonic()+180
        while process.poll()is None and connection is None:
            try:connection=socket.create_connection(('127.0.0.1',port),timeout=.5)
            except OSError:
                if time.monotonic()>deadline:raise ValueError('Original loopback admin console did not open')
                finished.wait(.1)
        if connection is None:return process.wait()
        connection.settimeout(.1);authenticated=not password;banner=b'';shutdown_requested=False
        while process.poll()is None:
            try:
                data=connection.recv(65536)
                if not data:
                    if shutdown_requested:return process.wait(timeout=30)
                    raise ValueError('Original loopback admin console disconnected')
                sys.stdout.buffer.write(data);sys.stdout.buffer.flush()
                if not authenticated:
                    banner=(banner+data)[-8192:]
                    if b'password'in banner.lower():connection.sendall(password.encode('utf-8')+b'\r\n');authenticated=True
            except socket.timeout:pass
            if authenticated:
                while not commands.empty():
                    command=commands.get_nowait();connection.sendall(command)
                    if command.strip().lower()==b'saveandexit 0':shutdown_requested=True
        return process.wait()
    finally:
        finished.set()
        if connection:connection.close()
        # Wine may leave its own descendants after the launcher exits. This
        # group is the new session created for this exact child, never a name
        # match or a machine-wide wineserver operation.
        try:os.killpg(process.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        if process.poll()is None:
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
        for sig,handler in previous.items():signal.signal(sig,handler)


if __name__=='__main__':
    try:sys.exit(run(int(sys.argv[1]),sys.argv[2:],dict(os.environ)))
    except(OSError,ValueError,subprocess.SubprocessError):
        print('Empyrion loopback console failed; owned game group stopped, no save success inferred.',file=sys.stderr);sys.exit(1)
