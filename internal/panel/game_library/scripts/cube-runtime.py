#!/usr/bin/env python3
"""MIT. AssaultCube and Sauerbraten setup, native info readiness and interrupt Stop."""
import json
import errno
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import tempfile
import threading
from cube_query import query
from steam_template import Redactor


def confined(root,path):
    if not path.resolve().is_relative_to(root.resolve()):raise ValueError('Native Cube path escapes the volume')
    return path


def text(value,limit=2048):
    if len(value.encode('utf8'))>limit or any(c in value for c in '\x00\r\n'):raise ValueError('Native Cube setting exceeds its byte limit or contains a line break')
    return value


def quoted(value):
    return '"'+text(value).replace('^','^^').replace('"','^"')+'"'


def private_write(path,content):
    content=content.encode('utf8') if isinstance(content,str) else content
    if not path.is_file() or path.read_bytes()!=content:
        path.parent.mkdir(parents=True,exist_ok=True)
        descriptor,temporary=tempfile.mkstemp(prefix='.voltra-',dir=path.parent)
        try:
            with os.fdopen(descriptor,'wb') as output:output.write(content)
            os.replace(temporary,path)
        finally:
            if os.path.exists(temporary):os.unlink(temporary)


def configure(root,env,kind):
    if kind not in ('assaultcube','sauerbraten'):raise ValueError('Unknown Cube game')
    port=int(env['SERVER_PORT']);public=env.get('PUBLIC_SERVER','0')
    if not 1<=port<=65534 or public not in ('0','1'):raise ValueError('Invalid consecutive game/query ports or public listing')
    game=confined(root,root/kind);home=confined(root,game/'userdata');home.mkdir(parents=True,exist_ok=True)
    state=confined(root,root/'.voltra'/kind);state.mkdir(parents=True,exist_ok=True)
    prefix='ASSAULT_SERVER_' if kind=='assaultcube' else 'CUBE_'
    maximum=int(env.get(prefix+'MAXPLAYERS','16' if kind=='assaultcube' else '4'))
    if not 1<=maximum<=16:raise ValueError('Native player count must be from 1 to 16')
    admin=text(env.get(prefix+'ADMINPASSWORD','') or '')
    if not admin:
        credential=confined(root,state/'admin-password')
        if credential.exists():admin=text(credential.read_text(),512)
        else:
            admin=secrets.token_hex(24);private_write(credential,admin)
    if len(admin)<5:raise ValueError('Administrator password must contain at least five characters')
    master=text(env.get(prefix+'MASTERSERVER','ms.cubers.net' if kind=='assaultcube' else 'sauerbraten.org'),512)
    if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,512}',master):raise ValueError('Master server must be a hostname or IP address')
    description=text(env.get('ASSAULT_SERVER_DESCRIPTION' if kind=='assaultcube' else 'CUBE_SERVERDESCRIPTION','AssaultCube server' if kind=='assaultcube' else 'Sauerbraten server'),2048)
    password=text(env.get('ASSAULT_SERVER_PLAYERPASSWORD' if kind=='assaultcube' else 'SERVER_PASSWORD',''),2048)
    argv=[str(game/'bin_unix/linux_64_server')]
    if kind=='assaultcube':
        confined(root,game/'logs').mkdir(parents=True,exist_ok=True)
        key=env.get('ASSAULT_SERVER_KEY','')
        if key and not re.fullmatch(r'[0-9a-fA-F]{64}',key):raise ValueError('AssaultCube private identity key must be 64 hexadecimal characters')
        if key=='A'*64:raise ValueError('The packaged example AssaultCube identity key must not be used')
        if public=='1' and not key:raise ValueError('Public AssaultCube registration requires an operator identity key')
        options=confined(root,game/'config/voltra-options.txt')
        if not options.exists():private_write(options,'// Additional native server options, one switch per line.\n// Map rotation, bans and passwords retain their native files.\n')
        argv+=['-Cconfig/voltra-options.txt','-f'+str(port),'-c'+str(maximum),'-n'+description,'-o'+text(env.get('ASSAULT_SERVER_MOTD','')),
               '-x'+admin,'-p'+password,'-m'+(master if public=='1' else 'localhost')]
        if key:argv.append('-Y'+key)
        # Native default files remain under config and packages/maps. No
        # example servercmdline file (which contains a placeholder key) is run.
        credentials=[admin,password,key]
    else:
        operator=confined(root,game/'server-init.cfg')
        original=operator.read_bytes() if operator.exists() else b'// Native operator settings.\n'
        if len(original)>1024**2:raise ValueError('Native operator configuration exceeds 1 MiB')
        settings=['serverip "0.0.0.0"','serverport '+str(port),'maxclients '+str(maximum),
                  'serverdesc '+quoted(description),'adminpass '+quoted(admin),'serverpass '+quoted(password),
                  'mastername '+quoted(master if public=='1' else ''),'updatemaster '+public,
                  'servermotd '+quoted(env.get('SERVER_MOTD',''))]
        managed=confined(root,home/'server-init.cfg')
        private_write(managed,original+('\n// Voltra managed settings after operator configuration.\n'+'\n'.join(settings)+'\n').encode('utf8'))
        argv+=['-q'+str(home),'-j'+str(port),'-m'+(master if public=='1' else '')]
        credentials=[admin,password]
    return game,argv,credentials,port


def completion_status(kind,code,requested,ready,failed):
    normalized=kind=='sauerbraten' and requested and code in (-signal.SIGINT,128+signal.SIGINT) and ready and not failed
    if normalized:return True,0
    return False,code if code and code>0 else 1 if code or not ready or failed else 0


def run(root,env,kind):
    game,argv,credentials,port=configure(root,env,kind)
    environment=dict(env);environment.pop('PYTHONHOME',None);environment.pop('PYTHONPATH',None)
    environment.pop('LD_PRELOAD',None);environment.pop('LD_LIBRARY_PATH',None)
    master=slave=None
    if kind=='assaultcube':
        # The publisher's stdio becomes fully buffered on a pipe. A private
        # output terminal enables its normal live line buffering; stdin remains
        # noninteractive, as in the native dedicated executable.
        import pty,termios
        master,slave=pty.openpty();attributes=termios.tcgetattr(slave)
        attributes[3]&=~(termios.ECHO|termios.ECHONL);attributes[1]&=~termios.OPOST
        termios.tcsetattr(slave,termios.TCSANOW,attributes)
    try:
        child=subprocess.Popen(argv,cwd=game,env=environment,stdin=subprocess.DEVNULL,stdout=slave if slave is not None else subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
    except BaseException:
        if master is not None:os.close(master)
        raise
    finally:
        if slave is not None:os.close(slave)
    output=os.fdopen(master,'rb') if master is not None else child.stdout
    requested,ready,failed=threading.Event(),threading.Event(),threading.Event()
    def stop(*_):
        requested.set()
        if child.poll() is None:child.send_signal(signal.SIGINT)
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    def ready_query():
        for _ in range(600):
            if child.poll() is not None:return
            try:
                result=query(kind,'127.0.0.1',port)
                if result['maxplayers']!=int(env.get('ASSAULT_SERVER_MAXPLAYERS' if kind=='assaultcube' else 'CUBE_MAXPLAYERS','16' if kind=='assaultcube' else '4')):
                    raise ValueError('Native player limit not applied')
                ready.set();print('VOLTRA_CUBE_NATIVE_READY',flush=True);return
            except (OSError,ValueError):
                if requested.wait(.2):return
        failed.set();print('Native Cube info readiness timed out.',flush=True)
        if child.poll() is None:child.send_signal(signal.SIGINT)
    probe=threading.Thread(target=ready_query,daemon=True);probe.start()
    redactor=Redactor(credentials)
    while True:
        try:line=output.readline()
        except OSError as error:
            if master is not None and error.errno==errno.EIO:break
            raise
        if not line:break
        sys.stdout.buffer.write(redactor.feed(line,final=line.endswith(b'\n')));sys.stdout.buffer.flush()
    sys.stdout.buffer.write(redactor.feed(b'',final=True));sys.stdout.buffer.flush()
    code=child.wait()
    output.close()
    probe.join(timeout=2)
    normalized,result=completion_status(kind,code,requested.is_set(),ready.is_set(),failed.is_set())
    print('\nVOLTRA_CUBE_EXIT '+json.dumps({'game':kind,'raw_child_returncode':code,'stop_requested':requested.is_set(),'expected_publisher_interrupt':normalized,'ready':ready.is_set()}),flush=True)
    return result


if __name__=='__main__':raise SystemExit(run(Path.cwd(),os.environ,sys.argv[1]))
