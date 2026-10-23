#!/usr/bin/env python3
"""MIT. Source Windows console/log lifecycle on the reviewed stock Wine host."""
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import threading
import tempfile
import csv
import io
from source_l4d import local_query_address, rcon_packet, rcon_read
from steam_template import Redactor
from source_wine_build import verified_build


def native_pids(root,proc=Path('/proc')):
    binary=str(Path(root).resolve()/'contagionds.exe')
    expected={binary.casefold(),('Z:'+binary.replace('/','\\')).casefold()};found=[]
    for path in proc.iterdir():
        if not path.name.isdigit():continue
        try:
            if path.stat().st_uid!=os.getuid():continue
            first=(path/'cmdline').read_bytes().split(b'\0',1)[0].decode('utf-8','strict')
            if first.casefold() in expected:found.append(int(path.name))
        except (FileNotFoundError,PermissionError,UnicodeError):pass
    return found


def command(host,port,password,text,cancel):
    if not text or len(text)>8192 or any(c in text for c in '\0\r\n'):raise ValueError('Invalid native console command')
    with socket.create_connection((host,port),timeout=0.5) as connection:
        connection.settimeout(0.5);connection.sendall(rcon_packet(4101,3,password))
        for _ in range(4):
            identifier,kind,_=rcon_read(connection,cancel)
            if identifier==-1:raise ValueError('Native console authentication failed')
            if identifier==4101 and kind==2:break
        else:raise ValueError('Native console authentication did not complete')
        connection.sendall(rcon_packet(4200,2,text)+rcon_packet(4201,0,''));output=''
        for _ in range(32):
            identifier,kind,body=rcon_read(connection,cancel)
            if identifier==4201 and kind==0:return output
            if identifier!=4200 or kind!=0:raise ValueError('Unexpected native console response')
            output+=body
            if len(output)>65536:raise ValueError('Native console output exceeds limit')
        raise ValueError('Native console response did not terminate')


def native_input(root,environment,text):
    root=Path(root).resolve()
    if not isinstance(text,str) or not text or len(text.encode('utf-8'))>8192 or any(c in text for c in '\0\r\n'):raise ValueError('Invalid bounded native console input')
    if environment.get('WINEPREFIX')!=str(root/'.wine') or not (root/'.wine').resolve().is_relative_to(root):raise ValueError('Native console requires the private server Wine prefix')
    if not verified_build(root):raise ValueError('Reinstall to restore the verified native console helper')
    if len(native_pids(root))!=1:raise ValueError('Exactly one owned Windows dedicated process is required')
    env=dict(environment)
    for key in ('PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH','LD_PRELOAD'):env.pop(key,None)
    env['WINEDEBUG']='-all'
    listed=subprocess.run(['wine','tasklist','/FO','CSV','/NH'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=8)
    if listed.returncode or len(listed.stdout)>65536:raise ValueError('Private Wine process enumeration did not complete')
    matches=[row for row in csv.reader(io.StringIO(listed.stdout.decode('utf-8','strict'))) if row and row[0].casefold()=='contagionds.exe']
    if len(matches)!=1 or len(matches[0])<2 or not re_pid(matches[0][1]):raise ValueError('Exactly one private Windows dedicated PID is required')
    result=subprocess.run(['wine',str(root/'.voltra/source_wine_console.exe'),matches[0][1]],input=text.encode('utf-8')+b'\n',env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=8)
    if result.returncode:raise ValueError('Native console input did not complete')


def re_pid(value):
    return value.isascii() and value.isdecimal() and len(value)<=10 and 0<int(value)<=0xffffffff


def run(root,argv,environment,stop_command,credentials=(),terminal_input=False,output_observer=None):
    if output_observer is not None and not callable(output_observer):raise ValueError('Invalid private output observer')
    if output_observer is not None:credentials=tuple(credentials)
    root=Path(root).resolve();log=root/'contagion/console.log'
    if not verified_build(root):raise ValueError('Reinstall to restore the verified native console helper')
    reset_log(root,log)
    finished=threading.Event();lock=threading.Lock();stopping=False
    child=subprocess.Popen(argv,cwd=root,env=environment,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
    newline_safe=output_observer is None or all('\n' not in value and '\r' not in value for value in credentials)
    def emit(data,redactor,final=False):
        with lock:
            if output_observer is not None and data and not finished.is_set() and not stopping and child.poll() is None:
                try:output_observer(data)
                except Exception:
                    redactor.pending=b''
                    raise RuntimeError('Private native output observer failed') from None
            public_final=final and (not data or output_observer is None or newline_safe)
            sys.stdout.buffer.write(redactor.feed(data,final=public_final));sys.stdout.buffer.flush()
    def tail():
        offset=0;redactor=Redactor(credentials)
        while not finished.wait(0.1):
            try:
                if not log.resolve().is_relative_to(root):return
                if log.stat().st_size<offset:offset=0
                with log.open('rb') as stream:
                    stream.seek(offset);data=stream.read(65536);offset=stream.tell()
                if data:emit(data,redactor,final=data.endswith(b'\n'))
            except FileNotFoundError:pass
        try:
            if log.resolve().is_relative_to(root):
                with log.open('rb') as stream:stream.seek(offset);emit(stream.read(65536),redactor)
        except FileNotFoundError:pass
        emit(b'',redactor,True)
    def stop(*_):
        nonlocal stopping
        if stopping or child.poll()is not None:return
        stopping=True
        try:native_input(root,environment,stop_command)
        except (OSError,ValueError,UnicodeError,subprocess.TimeoutExpired):print('Native console Stop did not complete; no forced termination was attempted.',flush=True)
    def console():
        pending=b''
        while not finished.is_set():
            try:data=os.read(sys.stdin.fileno(),65536)
            except OSError:return
            if not data:return
            pending+=data
            if len(pending)>16384:pending=b'';print('Native console command exceeds limit.',flush=True);continue
            while b'\n'in pending:
                line,pending=pending.split(b'\n',1);text=line.decode('utf-8','replace').rstrip('\r')
                if not text:continue
                if text==stop_command:stop();continue
                try:native_input(root,environment,text)
                except (OSError,ValueError,UnicodeError,subprocess.TimeoutExpired):print('Native console command did not complete.',flush=True)
    signal.signal(signal.SIGINT,stop);signal.signal(signal.SIGTERM,stop)
    follower=threading.Thread(target=tail,daemon=True);reader=threading.Thread(target=console,daemon=True);follower.start();reader.start()
    redactor=Redactor(credentials)
    try:
        while True:
            data=child.stdout.read1(65536)
            if not data:break
            emit(data,redactor,final=data.endswith(b'\n'))
        result=child.wait()
        if native_pids(root):raise RuntimeError('Wine launcher exited while its native dedicated process remains active')
        return result
    finally:
        finished.set();follower.join(timeout=1);child.stdout.close();emit(b'',redactor,True)


def reset_log(root,log):
    """A boot observer must never consume a previous native process's output."""
    root=Path(root).resolve();log=Path(log);backups=root/'.voltra/source-next/console-backups'
    if log.is_symlink() or not log.resolve().is_relative_to(root) or not backups.resolve().is_relative_to(root):raise ValueError('Wine native log escapes server volume')
    log.parent.mkdir(parents=True,exist_ok=True)
    if log.exists():
        if not log.is_file():raise ValueError('Wine native log must be a regular file')
        backups.mkdir(parents=True,exist_ok=True);fd,name=tempfile.mkstemp(prefix='contagion-',suffix='.log',dir=backups);os.close(fd);moved=False
        try:
            os.replace(log,name);moved=True
            os.chmod(name,0o600)
        except BaseException:
            if not moved and os.path.exists(name):os.unlink(name)
            raise
    with log.open('xb'):pass
    log.chmod(0o600)
