#!/usr/bin/env python3
"""MIT. Optional crash policy around the existing native console supervisor.

This module owns no PTY, engine signals, redaction, saves or ordered stops.
Each attempt delegates those to native_console.run with its normal defaults.
Private launch configuration travels through an anonymous inherited pipe.
"""
import base64
import json
import os
from pathlib import Path
import queue
import signal
import subprocess
import sys
import threading
import time


BOOTSTRAP="""import base64,json,os,sys
sys.path.insert(0,sys.argv[2])
from native_console import run
def decode(value):
 if set(value)=={'__voltra_native_bytes__'}:return base64.b64decode(value['__voltra_native_bytes__'],validate=True)
 return value
with os.fdopen(int(sys.argv[1]),'r') as control: configuration=json.load(control,object_hook=decode)
if 'stop_sequence' in configuration:configuration['stop_sequence']=tuple(tuple(step) for step in configuration['stop_sequence'])
sys.exit(run(**configuration))
"""


def run_restarting(configuration, initial_delay=1, maximum_delay=30):
    if os.name!='posix':raise ValueError('Native crash policy requires a POSIX node')
    if isinstance(initial_delay,bool) or isinstance(maximum_delay,bool) or not isinstance(initial_delay,(int,float)) or not isinstance(maximum_delay,(int,float)) or not 0.05<=initial_delay<=maximum_delay<=60:
        raise ValueError('Native restart backoff must be between .05 and 60 seconds')
    configuration=dict(configuration)
    if configuration.get('restart_on_failure'):raise ValueError('Nested restart supervisors are forbidden')
    if 'stop_sequence' in configuration and (not isinstance(configuration['stop_sequence'],tuple) or any(not isinstance(step,tuple) for step in configuration['stop_sequence'])):
        raise ValueError('Ordered stop policy must retain native tuple types')
    stop_command=configuration['stop_command'].encode('utf-8').strip().lower()
    root=Path(configuration['root']).resolve();configuration['root']=str(root)
    configuration['argv']=[str(value) for value in configuration['argv']]
    configuration['environment']=dict(configuration['environment'])
    def encode(value):
        if isinstance(value,bytes):return {'__voltra_native_bytes__':base64.b64encode(value).decode('ascii')}
        raise TypeError('Unsupported private native supervisor configuration type')
    payload=json.dumps(configuration,default=encode).encode('utf-8')
    if len(payload)>1024**2:raise ValueError('Native supervisor configuration exceeds bound')
    stopping,finished=threading.Event(),threading.Event()
    current_lock=threading.Lock();current=[None];pending=queue.Queue(maxsize=256)

    def signal_stop(*_):
        stopping.set()
        with current_lock:child=current[0]
        if child is not None and child.poll() is None:
            try:child.send_signal(signal.SIGTERM)
            except ProcessLookupError:pass

    def read_input():
        incomplete=b''
        try:
            while not finished.is_set():
                block=os.read(sys.stdin.fileno(),65536)
                if not block:
                    signal_stop();return
                commands=(incomplete+block).splitlines(keepends=True);incomplete=b''
                for command in commands:
                    if command.endswith((b'\r',b'\n')):
                        if command.strip().lstrip(b'/').lower()==stop_command:stopping.set()
                    else:incomplete=command[-4096:]
                while not finished.is_set():
                    try:pending.put(block,timeout=.1);break
                    except queue.Full:pass
        except OSError:
            signal_stop()

    def write_input():
        while not finished.is_set():
            try:block=pending.get(timeout=.1)
            except queue.Empty:continue
            while not finished.is_set():
                with current_lock:child=current[0]
                if child is not None and child.poll() is None:
                    try:child.stdin.write(block);child.stdin.flush();break
                    except (BrokenPipeError,OSError,ValueError):pass
                elif stopping.is_set():return
                finished.wait(.05)

    old_handlers={number:signal.getsignal(number) for number in (signal.SIGTERM,signal.SIGINT)}
    for number in old_handlers:signal.signal(number,signal_stop)
    threading.Thread(target=read_input,daemon=True).start();threading.Thread(target=write_input,daemon=True).start()
    attempt=0;delay=initial_delay;last_code=0
    try:
        while not stopping.is_set():
            reader,writer=os.pipe();child=None;started=time.monotonic()
            try:
                child=subprocess.Popen([sys.executable,'-c',BOOTSTRAP,str(reader),str(Path(__file__).parent)],cwd=root,
                    env=dict(os.environ),stdin=subprocess.PIPE,stdout=None,stderr=None,pass_fds=(reader,),start_new_session=True)
                os.close(reader);reader=None
                with os.fdopen(writer,'wb') as control:writer=None;control.write(payload)
                with current_lock:current[0]=child
                # A signal during startup must not be lost before publication.
                if stopping.is_set():signal_stop()
                last_code=child.wait()
            finally:
                if reader is not None:os.close(reader)
                if writer is not None:os.close(writer)
                with current_lock:current[0]=None
                if child is not None:
                    if child.stdin:child.stdin.close()
                    if child.poll() is None:
                        try:child.send_signal(signal.SIGTERM)
                        except ProcessLookupError:pass
                        child.wait()
            if last_code==0 or stopping.is_set():return last_code
            if time.monotonic()-started>=60:delay=initial_delay;attempt=0
            attempt+=1
            print('Native process failed; restart attempt '+str(attempt)+' after '+str(delay)+' seconds.',flush=True)
            if stopping.wait(delay):return last_code
            delay=min(maximum_delay,delay*2)
        return last_code
    finally:
        finished.set()
        for number,handler in old_handlers.items():signal.signal(number,handler)
