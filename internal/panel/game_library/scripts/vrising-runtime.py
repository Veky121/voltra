#!/usr/bin/env python3
"""MIT. Native V Rising JSON settings, private Proton and authenticated console."""
import json
import hashlib
import os
from pathlib import Path
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
from native_config import private_write
from steam_template import Redactor
from enshrouded_proton import location


def configure(root,env):
    root=Path(root).resolve();modded=env.get('VOLTRA_VRISING_VARIANT','vanilla')=='bepinex'
    def key(normal,mod):return mod if modded else normal
    def text(normal,mod,default='',maximum=4096):
        value=env.get(key(normal,mod),default)
        if not isinstance(value,str) or len(value)>maximum or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid '+key(normal,mod))
        return value
    def number(normal,mod,default,minimum=0,maximum=2147483647):
        value=int(text(normal,mod,str(default)))
        if not minimum<=value<=maximum:raise ValueError('Invalid '+key(normal,mod))
        return value
    def boolean(normal,mod,default='false'):
        value=text(normal,mod,default)
        if value not in ('true','false'):raise ValueError('Use true or false for '+key(normal,mod))
        return value=='true'
    allocated={int(p)for p in env.get('VOLTRA_ALLOCATED_PORTS','').split(',')if p};port=int(env['SERVER_PORT'])
    if port not in allocated:raise ValueError('Gameplay port must be allocated')
    used={port}
    def selected(normal,mod,default):
        value=number(normal,mod,default,1,65535)
        if value not in allocated or value in used:value=next((p for p in sorted(allocated)if p not in used),0)
        if not value:raise ValueError('Allocate gameplay, query and RCON ports')
        used.add(value);return value
    query=selected('VR_QUERY_PORT','QUERY_PORT',9877);rcon_port=selected('VR_RCON_PORT','RCON_PORT',25575)
    password=text('VR_PASSWORD','SERVER_PASSWORD');rcon_password=text('VR_RCON_PASSWORD','RCON_PASS','somepassword',128)
    enabled=boolean('VR_RCON_ENABLED','RCON')
    if enabled and not rcon_password:raise ValueError('Enabled RCON needs a nonempty password')
    save=text('VR_SAVE_NAME','SAVE_NAME','world1',128)
    if not save or save in ('.','..') or any(c in save for c in '/\\:'):raise ValueError('Save name must be a single directory name')
    target=root/'save-data/Settings/ServerHostSettings.json';backup=root/'.voltra/vrising/config-backups'
    if not all(p.resolve().is_relative_to(root)for p in (target,backup)):raise ValueError('V Rising configuration leaves the volume')
    previous=target.read_text(encoding='utf-8-sig')if target.exists() and target.stat().st_size<8*1024**2 else ''
    if target.exists() and not previous:raise ValueError('Invalid or oversized native host settings')
    data=json.loads(previous)if previous else {}
    if not isinstance(data,dict):raise ValueError('Expected native settings object')
    data.update({'Name':text('VR_NAME','SERVER_NAME','V Rising Dedicated Server',128),'Description':text('VR_DESCRIPTION','DESCRIPTION','Welcome to the server!'),
        'Port':port,'QueryPort':query,'Address':'0.0.0.0','MaxConnectedUsers':number('VR_MAX_USERS','MAX_PLAYERS',40,1,128),'MaxConnectedAdmins':number('VR_MAX_ADMINS','MAX_ADMINS',4,0,128),
        'ServerFps':number('VR_FPS','FPS',30,1,1000),'SaveName':save,'Password':password,'Secure':boolean('VR_SECURE','SERVER_SECURE','true'),
        'AutoSaveCount':number('VR_SAVE_COUNT','SAVE_COUNT',20),'AutoSaveInterval':number('VR_SAVE_INTERVAL','SAVE_INTERVAL',120,1),
        'GameSettingsPreset':text('VR_PRESET','GAME_SETTINGS_PRESET'),'ListOnSteam':boolean('VR_LIST_ON_STEAM','SERVER_LIST','true'),'ListOnEOS':boolean('VR_LIST_ON_EOS','SERVER_LIST','true')})
    rcon=data.setdefault('Rcon',{})
    if not isinstance(rcon,dict):raise ValueError('Expected native Rcon settings object')
    rcon.update({'Enabled':enabled,'Password':rcon_password,'Port':rcon_port,'BindAddress':'0.0.0.0'})
    if modded:data.update({'AdminOnlyDebugEvents':boolean('','ADMIN_ONLY_DEBUG_EVENTS','true'),'DisableDebugEvents':boolean('','DEBUG_EVENTS')})
    else:data.update({'HideIPAddress':boolean('VR_HIDEIPADDRESS',''),'GameDifficultyPreset':text('VR_DIFFICULTY_PRESET','','Difficulty_Normal'),'LowerFpsWhenEmpty':boolean('VR_LOWER_FPS_WHEN_EMPTY',''),'LowerFpsWhenEmptyValue':number('VR_LOWER_FPS_WHEN_EMPTY_VALUE','',10,1,1000)})
    updated=json.dumps(data,ensure_ascii=False,indent=2)+'\n'
    if updated!=previous:
        if previous:private_write(backup/(str(time.time_ns())+'-ServerHostSettings.json'),previous)
        private_write(target,updated)
    else:target.chmod(0o600)
    binary=root/'VRisingServer.exe'
    if not binary.is_file() or not binary.resolve().is_relative_to(root):raise ValueError('Missing confined V Rising executable')
    environment=dict(os.environ)
    for name in list(environment):
        if name in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD') or name.startswith('VR_'):environment.pop(name,None)
    # The publisher's steam_appid.txt is 1604030. 1829350 is the separate
    # dedicated-server download and private-prefix identity, not its game ID.
    environment.update({'HOME':str(root),'DISPLAY':':99','LD_LIBRARY_PATH':str(root/'.voltra/proton/lib')+':'+str(root/'.steam/sdk64'),'STEAM_COMPAT_CLIENT_INSTALL_PATH':str(root/'.steam/steam'),'STEAM_COMPAT_DATA_PATH':str(root/'.steam/steam/steamapps/compatdata/1829350'),'SteamAppId':'1604030','WINEDEBUG':env.get('WINEDEBUG','-all'),'WINEARCH':'win64','WINEPATH':str(root)})
    # Proton's optional desktop accessibility frontend is unnecessary for a
    # dedicated headless process and otherwise emits a misleading display error.
    environment['PROTON_USE_XALIA']='0'
    for name in ('STEAM_COMPAT_CLIENT_INSTALL_PATH','STEAM_COMPAT_DATA_PATH'):
        path=Path(environment[name])
        if not path.resolve().is_relative_to(root):raise ValueError('V Rising Proton prefix leaves volume')
        path.mkdir(parents=True,exist_ok=True)
    if modded:
        if not (root/'winhttp.dll').is_file() or not (root/'BepInEx/core/BepInEx.Unity.IL2CPP.dll').is_file():raise ValueError('V Rising BepInEx installation is incomplete')
        if env.get('VOLTRA_WINETRICKS_RUN')!='mono' or env.get('WINETRICKS_RUN',''):raise ValueError('Private Wine runtime ownership is missing; use the reviewed recipe environment hook')
        environment.update({'WINEDLLOVERRIDES':'winhttp=n,b;mscoree=b','VOLTRA_PRIVATE_MONO':'mono'})
    else:environment['WINEDLLOVERRIDES']='winhttp=b'
    log=root/'.voltra/vrising/native.log';log.parent.mkdir(parents=True,exist_ok=True)
    args=[str(location(root)),'run',str(binary),'-persistentDataPath','save-data','-address','0.0.0.0','-logFile','Z:'+str(log).replace('/','\\')]
    credentials=[password,rcon_password]+[env.get(k,'')for k in ('STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    return args,environment,credentials,log,(rcon_port,rcon_password)if enabled else None


def private_mono(root,proton,environment):
    """Honor the recipe's fixed Mono control inside its own GE-Proton prefix."""
    if environment.get('VOLTRA_PRIVATE_MONO')!='mono':return
    from valheim_vrising_install import MONO_RELEASE
    root=Path(root).resolve();state=root/'.voltra/vrising';receipt=state/'mono-installed.json'
    package=state/'wine-mono-9.1.0-x86.msi'
    prefix=Path(environment['STEAM_COMPAT_DATA_PATH'])/'pfx'
    runtime=prefix/'drive_c/windows/mono/mono-2.0/lib/mono/4.5/mscorlib.dll'
    if not all(p.resolve().is_relative_to(root)for p in (package,receipt,runtime)):raise ValueError('Private Mono paths leave the volume')
    if receipt.exists():
        previous=json.loads(receipt.read_text())
        if previous.get('package_sha256')==MONO_RELEASE['sha256']and runtime.is_file()and hashlib.sha256(runtime.read_bytes()).hexdigest()==previous.get('mscorlib_sha256'):return
        raise ValueError('Existing private Mono runtime differs; keep it for operator review')
    if not package.is_file()or hashlib.sha256(package.read_bytes()).hexdigest()!=MONO_RELEASE['sha256']:raise ValueError('Private Mono package failed integrity validation')
    setup=dict(environment);setup['WINEDLLOVERRIDES']='mscoree=;winhttp=b'
    commands=[[str(proton),'run','cmd.exe','/d','/c','exit','0'],[str(proton),'run','msiexec.exe','/i','Z:'+str(package).replace('/','\\'),'/qn','/norestart']]
    outputs=[]
    for command in commands:
        result=subprocess.run(command,cwd=root,env=setup,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180)
        outputs.append(result.stdout.decode('utf-8','replace'))
        if result.returncode:
            private_write(state/'mono-setup.log','\n'.join(outputs));raise RuntimeError('Private Mono setup failed with native exit '+str(result.returncode))
    if not runtime.is_file():
        private_write(state/'mono-setup.log','\n'.join(outputs));raise RuntimeError('Native Mono installer did not create its runtime in the private prefix')
    private_write(receipt,json.dumps({'version':MONO_RELEASE['version'],'package_sha256':MONO_RELEASE['sha256'],'prefix':str(prefix.relative_to(root)),'mscorlib_sha256':hashlib.sha256(runtime.read_bytes()).hexdigest(),'native_installer_exit':0},indent=2)+'\n')
    print('Pinned Wine Mono installed in the private game prefix.',flush=True)


class RCON:
    def __init__(self,port,password):
        self.connection=socket.create_connection(('127.0.0.1',port),timeout=4);self.connection.settimeout(4)
        self.send(3,password,31)
        for _ in range(4):
            identifier,kind,_=self.receive()
            if identifier==-1:raise ValueError('RCON authentication rejected')
            if kind==2 and identifier==31:return
        raise ValueError('RCON authentication response missing')
    def send(self,kind,body,identifier=32):
        data=struct.pack('<ii',identifier,kind)+body.encode()+b'\0\0'
        self.connection.sendall(struct.pack('<i',len(data))+data)
    def exact(self,count):
        data=b''
        while len(data)<count:
            block=self.connection.recv(count-len(data))
            if not block:raise OSError('RCON closed')
            data+=block
        return data
    def receive(self):
        length=struct.unpack('<i',self.exact(4))[0]
        if not 10<=length<=1024**2:raise ValueError('Invalid RCON frame')
        data=self.exact(length)
        if not data.endswith(b'\0\0'):raise ValueError('Invalid RCON terminator')
        identifier,kind=struct.unpack('<ii',data[:8]);return identifier,kind,data[8:-2].decode('utf-8','replace')
    def command(self,command):
        if any(c in command for c in '\r\n\0') or len(command)>8192:raise ValueError('Invalid console command')
        self.send(2,command)
        for _ in range(16):
            identifier,kind,body=self.receive()
            if identifier==32:return body
        raise ValueError('RCON command response missing')
    def close(self):self.connection.close()


def native_pids(root,proc=Path('/proc')):
    binary=str(Path(root).resolve()/'VRisingServer.exe');expected={binary.lower(),('Z:'+binary.replace('/','\\')).lower()};matches=[]
    for entry in proc.iterdir():
        if not entry.name.isdigit():continue
        try:
            if entry.stat().st_uid==os.getuid() and (entry/'cmdline').read_bytes().split(b'\0',1)[0].decode().lower() in expected:matches.append(int(entry.name))
        except (OSError,UnicodeError):pass
    return matches


def run(root,args,environment,credentials,log,rcon):
    display=subprocess.Popen(['/usr/bin/Xvfb',':99','-screen','0','1024x768x16','-nolisten','tcp'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    for _ in range(100):
        if display.poll() is not None:raise RuntimeError('V Rising display exited')
        if Path('/tmp/.X11-unix/X99').exists():break
        time.sleep(.05)
    else:display.terminate();display.wait();raise RuntimeError('V Rising display not ready')
    offset=log.stat().st_size if log.exists()else 0
    try:
        private_mono(root,args[0],environment)
        child=subprocess.Popen(args,cwd=root,env=environment,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
    except BaseException:display.terminate();display.wait();raise
    finished=threading.Event();lock=threading.Lock();ready=threading.Event();stopping=False
    def emit(line,redactor):
        if b'[Server] Startup Completed - Disabling Scene Loading Systems' in line or b'GameServer.LogOn successful' in line or b'Game server connected' in line:
            if not ready.is_set():print('VOLTRA_VRISING_READY',flush=True);ready.set()
        with lock:sys.stdout.buffer.write(redactor.feed(line,final=line.endswith(b'\n')));sys.stdout.buffer.flush()
    def tail():
        nonlocal offset
        redactor=Redactor(credentials)
        while not finished.wait(.1):
            if not log.exists():continue
            if log.stat().st_size<offset:offset=0
            with log.open('rb')as stream:
                stream.seek(offset)
                while True:
                    line=stream.readline()
                    if not line.endswith(b'\n'):break
                    offset=stream.tell();emit(line,redactor)
    def console():
        if rcon is None:return
        try:
            pending=b''
            while not finished.is_set():
                data=os.read(sys.stdin.fileno(),65536)
                if not data:return
                pending+=data
                while b'\n'in pending:
                    line,pending=pending.split(b'\n',1);command=line.decode().rstrip('\r')
                    if not command:continue
                    client=None
                    try:client=RCON(*rcon);answer=client.command(command);emit((answer+'\n').encode(),Redactor(credentials))
                    except (OSError,ValueError):print('V Rising console command could not complete.',flush=True)
                    finally:
                        if client:client.close()
        except OSError:pass
    def stop(*_):
        nonlocal stopping
        if not stopping and child.poll()is None:
            stopping=True;targets=native_pids(root)
            if targets:
                for pid in targets:
                    try:os.kill(pid,signal.SIGINT)
                    except ProcessLookupError:pass
            else:os.killpg(child.pid,signal.SIGINT)
    signal.signal(signal.SIGINT,stop);signal.signal(signal.SIGTERM,stop)
    followers=[threading.Thread(target=tail,daemon=True),threading.Thread(target=console,daemon=True)]
    for thread in followers:thread.start()
    redactor=Redactor(credentials)
    try:
        for line in iter(child.stdout.readline,b''):emit(line,redactor)
        result=child.wait();return result if ready.is_set()else(result or 1)
    finally:
        finished.set();followers[0].join(timeout=2);child.stdout.close();display.terminate();display.wait(timeout=5)
        sys.stdout.buffer.write(redactor.feed(b'',final=True));sys.stdout.buffer.flush()


def main():
    root=Path.cwd();env=dict(os.environ)
    if env.get('VOLTRA_STEAM_AUTO_UPDATE','0')=='1':
        from valheim_vrising_install import install
        install(root,'vrising',env)
    return run(root,*configure(root,env))


if __name__=='__main__':sys.exit(main())
