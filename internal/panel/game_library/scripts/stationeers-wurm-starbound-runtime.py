#!/usr/bin/env python3
"""MIT. Literal native settings for Stationeers, Wurm Unlimited and Starbound."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
from native_config import private_write,patch_ini
from native_console import run
from steam_template import Redactor


def configure(root,kind,env):
    root=Path(root).resolve()
    def text(key,default='',maximum=128):
        value=env.get(key,default)
        if not isinstance(value,str)or len(value)>maximum or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid '+key)
        return value
    def number(key,default,minimum,maximum):
        value=int(text(key,str(default)))
        if not minimum<=value<=maximum:raise ValueError('Invalid '+key)
        return value
    def boolean(key,default='false'):
        value=text(key,default)
        if value not in ('true','false'):raise ValueError('Use true or false for '+key)
        return value
    def confined(relative):
        p=root/relative
        if not p.resolve().is_relative_to(root)or p.resolve()==root:raise ValueError('Native path leaves the server volume')
        return p
    def single(key,default):
        value=text(key,default)
        if not value or value in ('.','..')or any(c in value for c in '/\\:'):raise ValueError('Invalid '+key)
        return value
    ports={int(p)for p in env.get('VOLTRA_ALLOCATED_PORTS','').split(',')if p};port=number('SERVER_PORT',27016,1,65535)
    if port not in ports:raise ValueError('Gameplay port must be allocated')
    def secondary(key,default):
        value=number(key,default,1,65535)
        if value not in ports or value==port:value=next((p for p in sorted(ports)if p!=port),0)
        if not value:raise ValueError('Allocate gameplay and secondary ports')
        return value
    environment=dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD'):environment.pop(key,None)
    environment.update({'HOME':str(root),'LD_LIBRARY_PATH':str(root/'.steam/sdk64')})
    credentials=[text(key,'',1024)for key in ('STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    options={}
    if kind=='stationeers':
        world=text('WORLD_NAME','moon')
        aliases={'moon':'Lunar','lunar':'Lunar','mars':'Mars2','mars2':'Mars2','europa':'Europa3','europa2':'Europa3','europa3':'Europa3','mimas':'MimasHerschel','mimasherschel':'MimasHerschel','vulcan':'Vulcan','vulcan2':'Vulcan2','venus':'Venus'}
        if world and world.lower()not in aliases:raise ValueError('This Stationeers build does not provide the selected world; choose a current world or leave the fallback empty for an existing save')
        password=text('SERVER_PASSWD','',128);credentials.append(password)
        binary=confined('rocketstation_DedicatedServer.x86_64')
        # Current publisher command replaces the retired -loadlatest launch
        # command. Legacy UI identifiers remain explicit aliases to current IDs.
        argv=[str(binary),'-batchmode','-nographics','-file','start',single('SAVE_NAME','stationeers_1')]
        if world:argv.append(aliases[world.lower()])
        argv+=['-settings','ServerName',text('SERVER_NAME','Pterodactyl Hosted Server',100),'StartLocalHost','true','ServerVisible','true','GamePort',str(port),'UpdatePort',str(secondary('UPDATE_PORT',27014)),'AutoSave',boolean('AUTOSAVE','true'),'SaveInterval',str(number('SAVE_INTERVAL',300,1,2147483647)),'ServerPassword',password,'ServerMaxPlayers',str(number('MAX_PLAYERS',10,1,30)),'UPNPEnabled',boolean('UPNP')]
        environment['LD_LIBRARY_PATH']=str(root/'rocketstation_DedicatedServer_Data/Plugins/x86_64')+':'+environment['LD_LIBRARY_PATH']
        preload=[]
        if env.get('VOLTRA_STATIONEERS_VARIANT','vanilla')=='bepinex':
            loader=confined('libdoorstop.so');assembly=confined('BepInEx/core/BepInEx.Preloader.dll')
            if not loader.is_file()or not assembly.is_file():raise ValueError('Stationeers BepInEx is incomplete')
            environment.update({'DOORSTOP_ENABLED':'1','DOORSTOP_TARGET_ASSEMBLY':str(assembly)});preload.append(loader)
        from stationeers_console_compat import native_preload
        environment['LD_PRELOAD']=native_preload(root,preload)
        # The publisher emits "saved world" after completing its save, distinct
        # from the preceding "saving world" request. Quit waits for that event.
        options={'ready_marker':b'World load complete','terminal_input':True,'terminal_query_reply':True,'terminal_enter_carriage_return':True,'stop_sequence':(('save',b"saved world '"),('quit',None))}
        stop='quit'
    elif kind=='wurm':
        from stationeers_wurm_starbound_install import world_relative
        binary=confined('WurmServerLauncher');world=world_relative(root,text('SERVER_WORLD','dist/Adventure'));confined(world)
        password=text('SERVERPWD','',64);admin=text('ADMINPWD','',20);credentials+=[password,admin]
        target=confined('LaunchConfig.ini');previous=target.read_text()if target.exists()else''
        replacement='CleanLogsOnStart='+boolean('SERVER_CLEAN_LOGS_ON_START','true');lines=[];seen=False
        for line in previous.splitlines():
            if not line.lstrip().startswith(('#',';'))and'='in line and line.split('=',1)[0].strip()=='CleanLogsOnStart':
                if seen:raise ValueError('Duplicate Wurm CleanLogsOnStart setting')
                line=replacement;seen=True
            lines.append(line)
        if not seen:lines.append(replacement)
        updated='\n'.join(lines)+'\n'
        if updated!=previous:private_write(target,updated)
        argv=[str(binary),'ip=0.0.0.0','externalport='+str(port),'start='+world,'maxplayers='+str(number('MAX_PLAYERS',25,1,1000)),'servername='+text('SERVERNAME','Wurm Unlimited',64),'adminpwd='+admin,'serverpassword='+password,'epicsettings='+boolean('EPIC'),'queryport='+str(secondary('QUERY_PORT',27016)),'pvp='+boolean('PVP','true')]
        environment.update({'DISPLAY':':99','LD_LIBRARY_PATH':str(root/'.voltra/wurm/lib')+':'+str(root/'nativelibs')+':'+environment['LD_LIBRARY_PATH']})
        stop='shutdown';options={'ready_marker':b'Wurm Server launcher finished at'}
    elif kind=='starbound':
        binary=confined('starbound_server');target=confined('storage/starbound_server.config');previous=target.read_text()if target.exists()else''
        if len(previous)>8*1024**2:raise ValueError('Oversized Starbound configuration')
        data=json.loads(previous)if previous else{}
        if not isinstance(data,dict):raise ValueError('Expected Starbound settings object')
        data['gameServerPort']=port
        updated=json.dumps(data,ensure_ascii=False,indent=2)+'\n'
        if updated!=previous:
            if previous:private_write(root/'.voltra/starbound/config-backups'/(str(time.time_ns())+'.json'),previous)
            private_write(target,updated)
        argv=[str(binary)];stop='';options={'ready_marker':b'Starting UniverseServer'}
    else:raise ValueError('Unsupported native family')
    if not binary.is_file()or not os.access(binary,os.X_OK):raise ValueError('Missing native server executable')
    return argv,environment,stop,credentials,options


def signal_run(root,argv,environment,credentials):
    child=subprocess.Popen(argv,cwd=root,env=environment,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
    stopping=False
    def stop(*_):
        nonlocal stopping
        if not stopping and child.poll()is None:
            stopping=True
            try:os.killpg(child.pid,signal.SIGINT)
            except ProcessLookupError:pass
    def forward():
        try:
            while child.poll()is None:
                block=os.read(sys.stdin.fileno(),65536)
                if not block:return
                child.stdin.write(block);child.stdin.flush()
        except (OSError,BrokenPipeError):pass
    signal.signal(signal.SIGINT,stop);signal.signal(signal.SIGTERM,stop)
    threading.Thread(target=forward,daemon=True).start();redactor=Redactor(credentials)
    try:
        for line in iter(child.stdout.readline,b''):
            sys.stdout.buffer.write(redactor.feed(line,final=line.endswith(b'\n')));sys.stdout.buffer.flush()
        sys.stdout.buffer.write(redactor.feed(b'',final=True));sys.stdout.buffer.flush();return child.wait()
    finally:child.stdout.close();child.stdin.close()


def main():
    root=Path.cwd();env=dict(os.environ);kind=env['VOLTRA_NATIVE_FAMILY']
    if env.get('VOLTRA_STEAM_AUTO_UPDATE','0')=='1':
        from stationeers_wurm_starbound_install import install
        install(root,kind,env)
    argv,environment,stop,credentials,options=configure(root,kind,env)
    display=None
    if kind=='wurm':
        display=subprocess.Popen(['/usr/bin/Xvfb',':99','-screen','0','1024x768x16','-nolisten','tcp'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
        for _ in range(100):
            if Path('/tmp/.X11-unix/X99').exists():break
            if display.poll()is not None:raise RuntimeError('Private Wurm display exited')
            time.sleep(.05)
        else:display.terminate();display.wait();raise RuntimeError('Private Wurm display unavailable')
    try:
        if kind=='starbound':return signal_run(root,argv,environment,credentials)
        return run(root,argv,environment,stop,credentials,**options)
    finally:
        if display:display.terminate();display.wait(timeout=5)


if __name__=='__main__':sys.exit(main())
