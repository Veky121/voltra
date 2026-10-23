#!/usr/bin/env python3
"""MIT. Enshrouded native JSON roles and Proton process/log lifecycle."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
from native_config import private_write
from steam_template import Redactor
from additional_survival_install import install
from enshrouded_proton import location


def text(value, limit=128):
    if not isinstance(value,str) or len(value.encode())>limit or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid Enshrouded text setting')
    return value


def boolean(env,key,default='0'):
    if env.get(key,default) not in ('0','1'):raise ValueError(key+' must be 0 or 1')
    return env.get(key,default)=='1'


def configure(root, env):
    root=Path(root).resolve();target=root/'enshrouded_server.json'
    if not target.resolve().is_relative_to(root) or not (root/'.voltra/enshrouded/config-backups').resolve().is_relative_to(root):raise ValueError('Enshrouded configuration leaves the volume')
    previous=target.read_text(encoding='utf-8-sig') if target.exists() and target.stat().st_size<=8*1024*1024 else ''
    if target.exists() and not previous:raise ValueError('Invalid or oversized Enshrouded configuration')
    data=json.loads(previous) if previous else {}
    if not isinstance(data,dict):raise ValueError('Expected native JSON object')
    maximum=int(env.get('MAX_PLAYERS','16'));port=int(env['SERVER_PORT'])
    allocated={int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS','').split(',') if p}
    if not 1<=maximum<=16 or not 1<=port<=65535 or port not in allocated:raise ValueError('Choose 1..16 slots and an allocated query port')
    data.update({'name':text(env.get('SRV_NAME','Enshrouded server')),'slotCount':maximum,'queryPort':port,'ip':'0.0.0.0'})
    for key,default in [('saveDirectory','./savegame'),('logDirectory','./logs')]:
        relative=data.get(key,default)
        if not isinstance(relative,str) or not relative or '\\' in relative or Path(relative).is_absolute() or not (root/relative).resolve().is_relative_to(root):raise ValueError('Native save and log directories must remain in this server volume')
        data[key]=relative;(root/relative).mkdir(parents=True,exist_ok=True)
    preset=env.get('GAME_PRESET','Default')
    if preset not in ('Default','Relaxed','Hard','Survival','Custom'):raise ValueError('Unsupported native difficulty preset')
    data['gameSettingsPreset']=preset
    data['enableVoiceChat']=boolean(env,'VOICE_CHAT');data['enableTextChat']=boolean(env,'TEXT_CHAT')
    data.setdefault('voiceChatMode','Proximity')
    groups=data.setdefault('userGroups',[])
    if not isinstance(groups,list) or any(not isinstance(g,dict) for g in groups):raise ValueError('Native userGroups must be an array of objects')
    passwords=[]
    for index,(name,key) in enumerate([('Admin','SRV_PW'),('Friend','SRV_PW2'),('Guest','SRV_PW3'),('Visitor','SRV_PW4')]):
        password=text(env.get(key,'ChangeMe'+str(index+1)),128)
        if not password or password.isdigit():raise ValueError('Each role needs a nonempty password containing nonnumeric characters')
        passwords.append(password)
        matches=[g for g in groups if g.get('name')==name]
        if len(matches)>1:raise ValueError('Duplicate managed native user group')
        if matches:group=matches[0]
        elif index==0 and groups:group=groups[0]
        else:
            group={'name':name,'canKickBan':index==0,'canAccessInventories':index<2,'canEditBase':index<2,'canExtendBase':index<2,'canEditWorld':index<3}
            groups.append(group)
        group['password']=password
    if len(set(passwords))!=4:raise ValueError('Use distinct passwords for all four native roles')
    updated=json.dumps(data,ensure_ascii=False,indent=2)+'\n'
    if updated!=previous:
        if previous:private_write(root/'.voltra/enshrouded/config-backups'/(str(time.time_ns())+'-enshrouded_server.json'),previous)
        private_write(target,updated)
    else:target.chmod(0o600)
    binary=root/'enshrouded_server.exe'
    if not binary.is_file() or not binary.resolve().is_relative_to(root):raise ValueError('Steam installation is missing a confined enshrouded_server.exe')
    environment=dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD'):environment.pop(key,None)
    environment['HOME']=str(root)
    environment['DISPLAY']=':99'
    environment['VOLTRA_MANAGED_DISPLAY']='1'
    environment['LD_LIBRARY_PATH']=str(root/'.voltra/proton/lib')+':'+str(root/'.steam/sdk64')
    environment['STEAM_COMPAT_CLIENT_INSTALL_PATH']=str(root/'.steam/steam')
    environment['STEAM_COMPAT_DATA_PATH']=str(root/'.steam/steam/steamapps/compatdata/2278520')
    for key in ('STEAM_COMPAT_CLIENT_INSTALL_PATH','STEAM_COMPAT_DATA_PATH'):
        if not Path(environment[key]).resolve().is_relative_to(root):raise ValueError('Proton prefix leaves the server volume')
        Path(environment[key]).mkdir(parents=True,exist_ok=True)
    passwords.extend(g.get('password','') for g in groups if isinstance(g.get('password',''),str))
    credentials=passwords+[env.get(k,'') for k in ('STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    log=root/data['logDirectory']/'enshrouded_server.log'
    if not log.resolve().is_relative_to(root):raise ValueError('Native log leaves the server volume')
    return [str(location(root)),'run',str(binary)],environment,credentials,log


def native_pids(root,proc=Path('/proc')):
    """Wine reparents the Windows server; match its exact argv0 and current UID."""
    binary=str(root.resolve()/'enshrouded_server.exe')
    expected={binary.lower(),('Z:'+binary.replace('/','\\')).lower()}
    matches=[]
    for entry in proc.iterdir():
        if not entry.name.isdigit():continue
        try:
            if entry.stat().st_uid!=os.getuid():continue
            argument=(entry/'cmdline').read_bytes().split(b'\0',1)[0].decode('utf-8','strict')
            if argument.lower() in expected:matches.append(int(entry.name))
        except (FileNotFoundError,PermissionError,UnicodeError):continue
    return matches


def run(root,argv,environment,credentials,log):
    # Keep historical logs. Follow only bytes emitted by this process launch.
    offset=log.stat().st_size if log.exists() else 0
    identity=(log.stat().st_dev,log.stat().st_ino) if log.exists() else None
    display=None
    if environment.get('VOLTRA_MANAGED_DISPLAY')=='1':
        display=subprocess.Popen(['/usr/bin/Xvfb',':99','-screen','0','1024x768x16','-nolisten','tcp'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
        for _ in range(100):
            if display.poll() is not None:raise RuntimeError('Private native display exited before startup')
            if Path('/tmp/.X11-unix/X99').exists():break
            time.sleep(0.05)
        else:
            display.terminate();display.wait();raise RuntimeError('Private native display did not become ready')
    try:
        child=subprocess.Popen(argv,cwd=root,env=environment,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
    except BaseException:
        if display is not None:display.terminate();display.wait()
        raise
    finished,ready,stopping=threading.Event(),threading.Event(),threading.Event();lock=threading.Lock()
    def emit(line,redactor):
        if b"[Session] 'HostOnline' (up)!" in line:ready.set()
        with lock:
            sys.stdout.buffer.write(redactor.feed(line,final=line.endswith(b'\n')));sys.stdout.buffer.flush()
    def follow():
        nonlocal offset,identity
        redactor=Redactor(credentials)
        while not finished.wait(0.1):
            if not log.exists():continue
            stat=log.stat();size=stat.st_size;current=(stat.st_dev,stat.st_ino)
            if size<offset or current!=identity:offset=0
            identity=current
            with log.open('rb') as source:
                source.seek(offset)
                for line in source:
                    if not line.endswith(b'\n'):break
                    offset=source.tell();emit(line,redactor)
        with lock:sys.stdout.buffer.write(redactor.feed(b'',final=True));sys.stdout.buffer.flush()
    def stop(*_):
        if child.poll() is None and not stopping.is_set():
            stopping.set()
            targets=native_pids(root)
            if targets:
                for pid in targets:
                    try:os.kill(pid,signal.SIGINT)
                    except ProcessLookupError:pass
            else:os.killpg(child.pid,signal.SIGINT)
    signal.signal(signal.SIGINT,stop);signal.signal(signal.SIGTERM,stop)
    tail=threading.Thread(target=follow,daemon=True);tail.start();redactor=Redactor(credentials)
    print('Enshrouded uses native configuration files; this dedicated server has no interactive stdin console.',flush=True)
    try:
        for line in iter(child.stdout.readline,b''):emit(line,redactor)
        result=child.wait()
        return result if ready.is_set() else (result or 1)
    finally:
        finished.set();tail.join(timeout=2)
        child.stdout.close()
        if display is not None:
            display.terminate();display.wait(timeout=5)
        with lock:sys.stdout.buffer.write(redactor.feed(b'',final=True));sys.stdout.buffer.flush()


def main():
    root=Path.cwd();env=dict(os.environ)
    if boolean(env,'VOLTRA_STEAM_AUTO_UPDATE'):install(root,'enshrouded',env,validate=boolean(env,'VALIDATE'))
    return run(root,*configure(root,env))


if __name__=='__main__':sys.exit(main())
