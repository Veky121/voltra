#!/usr/bin/env python3
"""MIT. Shared native stdin/output supervision with redaction and ready autosave."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
from steam_template import Redactor


def terminal_queries(data, pending=b'', final=False):
    """Minimal opt-in DSR replies, not a VT screen emulator. Position is 1;1."""
    data=pending+data;output=bytearray();replies=[];index=0
    queries={b'\x1b[6n':b'\x1b[1;1R',b'\x1b[5n':b'\x1b[0n'}
    while index<len(data):
        matched=next((q for q in queries if data.startswith(q,index)),None)
        if matched:
            replies.append(queries[matched]);index+=len(matched);continue
        if not final and any(q.startswith(data[index:]) for q in queries):return bytes(output),data[index:],replies
        output.append(data[index]);index+=1
    return bytes(output),b'',replies

def carriage_return_input(data, previous_cr=False):
    """Normalize command Enter bytes, including CRLF split across reads."""
    output=bytearray()
    for byte in data:
        if byte==10:
            if not previous_cr:output.append(13)
        else:output.append(byte)
        previous_cr=byte==13
    return bytes(output),previous_cr


def validated_stop_sequence(sequence):
    if not isinstance(sequence,tuple)or len(sequence)>8:raise ValueError('Stop sequence must be a bounded tuple')
    for index,step in enumerate(sequence):
        if not isinstance(step,tuple)or len(step)!=2:raise ValueError('Stop steps require command and acknowledgment')
        command,marker=step
        if not isinstance(command,str)or not command or len(command)>2048 or any(c in command for c in '\r\n\0'):raise ValueError('Invalid stop sequence command')
        if marker is None:
            if index!=len(sequence)-1:raise ValueError('Only final stop command may omit acknowledgment')
        elif not isinstance(marker,bytes)or not marker or len(marker)>512:raise ValueError('Invalid stop acknowledgment marker')
    return sequence


def run(root, argv, environment, stop_command, credentials=(), ready_marker=None, autosave_seconds=0, save_command='save', terminal_input=False, terminal_query_reply=False, terminal_enter_carriage_return=False, stop_sequence=(), stop_sequence_timeout=30, output_observer=None):
    if output_observer is not None and not callable(output_observer):raise ValueError('Invalid private output observer')
    if output_observer is not None:credentials=tuple(credentials)
    if any(c in stop_command + save_command for c in '\r\n\x00') or autosave_seconds < 0:
        raise ValueError('Invalid native console control settings')
    if terminal_query_reply and not terminal_input:raise ValueError('Terminal query replies require a native PTY')
    if terminal_enter_carriage_return and not terminal_input:raise ValueError('Carriage-return Enter requires a native PTY')
    stop_sequence=validated_stop_sequence(stop_sequence)
    if not isinstance(stop_sequence_timeout,(int,float))or not 0<stop_sequence_timeout<=300:raise ValueError('Invalid stop acknowledgment timeout')
    master = slave = None
    if terminal_input:
        import fcntl
        import pty
        import struct
        import termios
        master, slave = pty.openpty()
        attributes = termios.tcgetattr(slave)
        if terminal_enter_carriage_return:
            # Preserve the opt-in Enter CR at the native descriptor: the
            # inherited ICRNL flag would otherwise turn it back into LF.
            attributes[0] &= ~(termios.ICRNL | termios.INLCR | termios.IGNCR)
        attributes[3] &= ~(termios.ECHO | termios.ECHONL)
        attributes[1] &= ~termios.OPOST
        termios.tcsetattr(slave, termios.TCSANOW, attributes)
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 120, 0, 0))
    def attach_terminal():
        # Mono console APIs also open /dev/tty. Give the new child session its
        # own controlling terminal rather than only a tty-shaped descriptor.
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)
    try:
        child = subprocess.Popen(argv, cwd=root, env=environment, stdin=slave if terminal_input else subprocess.PIPE,
                                 stdout=slave if terminal_input else subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True,
                                 preexec_fn=attach_terminal if terminal_input else None)
    except BaseException:
        if master is not None:os.close(master)
        raise
    finally:
        if slave is not None:os.close(slave)
    output = os.fdopen(os.dup(master), 'rb') if terminal_input else child.stdout
    ready, finished, write_lock = threading.Event(), threading.Event(), threading.Lock()
    if ready_marker is None:
        ready.set()

    previous_input_cr=False
    def send(data,native_input=True):
        nonlocal previous_input_cr
        try:
            with write_lock:
                if child.poll() is None:
                    if terminal_enter_carriage_return and native_input:
                        data,previous_input_cr=carriage_return_input(data,previous_input_cr)
                    if master is None:
                        child.stdin.write(data); child.stdin.flush()
                    else:
                        remaining = memoryview(data)
                        while remaining:
                            remaining = remaining[os.write(master, remaining):]
        except (BrokenPipeError, OSError):
            pass

    def forward():
        try:
            # Buffered stdin reads in daemon threads can abort interpreter exit
            # while Wings retains the console pipe. Keep descriptor reads raw.
            for block in iter(lambda: os.read(sys.stdin.fileno(), 65536), b''):
                send(block)
        except OSError:
            pass

    stopping=threading.Event();stop_state=None
    def ordered_stop():
        nonlocal stop_state
        import time
        for command,marker in stop_sequence:
            # Each step owns its own event. A late output read acknowledging
            # an earlier step can never acknowledge the following command.
            state={'marker':marker,'event':threading.Event(),'tail':b''};stop_state=state
            send((command+'\n').encode('utf-8'))
            if marker is not None:
                deadline=time.monotonic()+stop_sequence_timeout
                while not state['event'].wait(.05):
                    if finished.is_set()or child.poll()is not None:return
                    if time.monotonic()>=deadline:
                        print('Native stop acknowledgment missing; final stop command was not sent.',flush=True);return
        stop_state=None
    def stop(*_):
        if not stop_sequence:
            send((stop_command + '\n').encode('utf-8'));return
        if not stopping.is_set():
            stopping.set();threading.Thread(target=ordered_stop,daemon=True).start()

    def autosave():
        ready.wait()
        while not finished.wait(autosave_seconds):
            if stopping.is_set():return
            if child.poll() is not None:
                return
            send((save_command + '\n').encode('utf-8'))

    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)
    threading.Thread(target=forward, daemon=True).start()
    saver = None
    if autosave_seconds:
        saver = threading.Thread(target=autosave, daemon=True); saver.start()
    redactor = Redactor(credentials)
    newline_safe = all('\n' not in value and '\r' not in value for value in credentials)
    query_pending,ready_tail=b'',b''
    try:
        while True:
            try:
                line = os.read(output.fileno(),65536) if terminal_query_reply or output_observer is not None else output.readline()
            except OSError as error:
                import errno
                if terminal_input and error.errno == errno.EIO:break
                raise
            if not line:break
            if output_observer is not None and child.poll() is None:
                try:output_observer(line)
                except Exception:raise RuntimeError('Private native output observer failed') from None
            if terminal_query_reply:
                line,query_pending,replies=terminal_queries(line,query_pending)
                for reply in replies:send(reply,native_input=False)
            state=stop_state
            if state and state['marker']:
                state['tail']=(state['tail']+line)[-max(65536,len(state['marker'])):]
                if state['marker']in state['tail']:state['event'].set()
            if ready_marker and ready_marker in ready_tail+line:
                ready.set()
            if ready_marker:ready_tail=(ready_tail+line)[-len(ready_marker):]
            sys.stdout.buffer.write(redactor.feed(line, final=line.endswith(b'\n') and (not (terminal_query_reply or output_observer is not None) or newline_safe)))
            sys.stdout.buffer.flush()
        if terminal_query_reply and query_pending:
            tail,_,_=terminal_queries(b'',query_pending,final=True)
            sys.stdout.buffer.write(redactor.feed(tail))
        sys.stdout.buffer.write(redactor.feed(b'', final=True)); sys.stdout.buffer.flush()
        return child.wait()
    finally:
        finished.set(); ready.set()
        if saver:
            saver.join(timeout=2)
        output.close()
        if master is not None:os.close(master)

