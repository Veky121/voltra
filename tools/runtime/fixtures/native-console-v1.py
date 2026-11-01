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


def _close_control_transport(transport):
    try:transport.close()
    except BaseException:
        # Cleanup hooks must not replace an already-observed native exit/error.
        try:print('[ERROR] Native control cleanup failed; original exit retained',flush=True)
        except OSError:pass


def _abort_control_start(child, output, master, transport):
    # Only the Popen created by run(start_new_session=True) is accepted here.
    # Kill the group even if its leader exits first and leaves descendants.
    try:
        if os.name == 'posix':
            try:os.killpg(child.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            try:child.wait(timeout=2)
            except subprocess.TimeoutExpired:pass
            try:os.killpg(child.pid,signal.SIGKILL)
            except ProcessLookupError:pass
        else:
            try:child.terminate()
            except OSError:pass
            try:child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                try:child.kill()
                except OSError:pass
        try:child.wait(timeout=2)
        except subprocess.TimeoutExpired:pass
    finally:
        try:_close_control_transport(transport)
        finally:
            try:output.close()
            finally:
                if master is not None:
                    try:os.close(master)
                    except OSError:pass


def run(root, argv, environment, stop_command, credentials=(), ready_marker=None, autosave_seconds=0, save_command='save', terminal_input=False, terminal_query_reply=False, terminal_enter_carriage_return=False, stop_sequence=(), stop_sequence_timeout=30, output_observer=None, stop_signal=None, stop_signal_timeout=60, control_transport=None):
    if control_transport is not None and not all(callable(getattr(control_transport, name, None)) for name in ('start', 'command', 'stop', 'close')):raise ValueError('Invalid native control transport')
    if control_transport is not None and stop_sequence:raise ValueError('Transport shutdown and stdin sequence are exclusive')
    if output_observer is not None and not callable(output_observer):raise ValueError('Invalid private output observer')
    if output_observer is not None:credentials=tuple(credentials)
    if any(c in stop_command + save_command for c in '\r\n\x00') or autosave_seconds < 0:
        raise ValueError('Invalid native console control settings')
    if terminal_query_reply and not terminal_input:raise ValueError('Terminal query replies require a native PTY')
    if terminal_enter_carriage_return and not terminal_input:raise ValueError('Carriage-return Enter requires a native PTY')
    stop_sequence=validated_stop_sequence(stop_sequence)
    if stop_signal is not None and (not isinstance(stop_signal,int)or isinstance(stop_signal,bool)or stop_signal not in (signal.SIGINT,signal.SIGTERM)):
        raise ValueError('Native stop signal must be SIGINT or SIGTERM')
    if stop_signal is not None and stop_sequence:raise ValueError('Choose native signal or acknowledged stdin shutdown')
    if not isinstance(stop_signal_timeout,(int,float))or isinstance(stop_signal_timeout,bool)or not 0<stop_signal_timeout<=300:
        raise ValueError('Invalid native signal grace timeout')
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
    requested_stop = threading.Event()
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
        if control_transport is not None:
            pending=b'';overflow=False
            try:
                for block in iter(lambda:os.read(sys.stdin.fileno(),65536),b''):
                    for byte in block:
                        if byte in (10,13):
                            if pending and not overflow and child.poll() is None:
                                try:line=pending.decode('utf-8',errors='strict')
                                except UnicodeError:line=''
                                if line==stop_command:stop()
                                elif line:
                                    try:control_transport.command(line)
                                    except Exception:emit_control('[ERROR] Native control command failed')
                            elif overflow:emit_control('[WARN] Native control input exceeds limit')
                            pending=b'';overflow=False
                        elif not overflow:
                            pending+=bytes([byte])
                            if len(pending)>4096:pending=b'';overflow=True
            except OSError:pass
            return
        pending=b''
        try:
            # Buffered stdin reads in daemon threads can abort interpreter exit
            # while Wings retains the console pipe. Keep descriptor reads raw.
            for block in iter(lambda: os.read(sys.stdin.fileno(), 65536), b''):
                # Keep only a bounded current line; never log console input.
                for piece in block.replace(b'\r',b'\n').splitlines(keepends=True):
                    pending=(pending+piece)[-4096:]
                    if piece.endswith(b'\n'):
                        if pending.rstrip(b'\n')==stop_command.encode('utf-8'):requested_stop.set()
                        pending=b''
                send(block)
        except OSError:
            pass

    stopping=threading.Event();stop_state=None
    def native_signal_stop():
        # The group was created by this invocation. Never accept an external PID.
        def deliver(value):
            try:os.killpg(child.pid,value)
            except ProcessLookupError:pass
        deliver(stop_signal if stop_signal is not None else signal.SIGINT)
        if finished.wait(stop_signal_timeout)or child.poll()is not None:return
        print('Native stop signal grace expired; escalating owned process group. Save completion is unconfirmed.',flush=True)
        deliver(signal.SIGTERM)
        if not finished.wait(10)and child.poll()is None:deliver(signal.SIGKILL)
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
    def transport_stop():
        try:control_transport.stop()
        except Exception:emit_control('[ERROR] Native control shutdown failed')
        if finished.wait(stop_signal_timeout)or child.poll()is not None:return
        emit_control('[WARN] Native protocol shutdown grace expired; using existing signal fallback; save completion unconfirmed')
        native_signal_stop()
    def stop(*_):
        requested_stop.set()
        if control_transport is not None:
            if not stopping.is_set():
                stopping.set();threading.Thread(target=transport_stop,daemon=True).start()
            return
        if stop_signal is not None:
            if not stopping.is_set():
                stopping.set();threading.Thread(target=native_signal_stop,daemon=True).start()
            return
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

    def emit_control(message):
        if not isinstance(message,str)or len(message)>8192:raise ValueError('Invalid transport message')
        # A separate redactor avoids racing the streamed native output state.
        safe=''.join(c for c in message if c=='\t'or 32<=ord(c)<127)
        print(Redactor(credentials).feed((safe+'\n').encode('utf-8'),final=True).decode('utf-8'),end='',flush=True)
    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)
    if control_transport is not None:
        try:control_transport.start(child,emit_control)
        except BaseException:
            try:_abort_control_start(child,output,master,control_transport)
            except BaseException:pass
            raise RuntimeError('Native control startup failed')from None
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
        status=child.wait()
        if status:
            requested=requested_stop.is_set()
            # A stop request does not make a subsequent crash successful.
            # Preserve a warning only for the normal stop signals themselves;
            # application failures and fatal signals retain error severity.
            severity='WARN' if requested and status in (-signal.SIGINT,-signal.SIGTERM) else 'ERROR'
            native_signal=-status if status<0 else None
            signal_detail=''
            if native_signal is not None:
                try:name=signal.Signals(native_signal).name
                except ValueError:name='unknown'
                signal_detail='; signal='+str(native_signal)+' ('+name+')'
            diagnostic=('['+severity+'] Native process exited: raw_status='+str(status)+signal_detail+
                        '; stop_requested='+str(requested).lower()+'.\n').encode('ascii')
            sys.stdout.buffer.write(redactor.feed(diagnostic,final=True));sys.stdout.buffer.flush()
        return status
    finally:
        finished.set(); ready.set()
        if control_transport is not None:_close_control_transport(control_transport)
        if saver:
            saver.join(timeout=2)
        output.close()
        if master is not None:os.close(master)

