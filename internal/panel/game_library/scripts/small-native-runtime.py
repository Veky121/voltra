#!/usr/bin/env python3
"""MIT. Native configuration and argv launch for OpenRCT2 and CS2D."""
import importlib.util
import json
import os
from pathlib import Path
import re
import queue
import secrets
import signal
import subprocess
import sys
import threading
import time
import urllib.request

spec=importlib.util.spec_from_file_location('ini',Path(__file__).with_name('native-config.py'))
ini=importlib.util.module_from_spec(spec);spec.loader.exec_module(ini)

def integer(env,key,default,minimum,maximum):
    value=int(env.get(key,str(default)))
    if not minimum<=value<=maximum:raise ValueError(key+' outside native range')
    return value

def quoted(value,maximum=1024):
    if len(value.encode())>maximum or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Native value exceeds byte limit or contains control characters')
    return '"'+value.replace('\\','\\\\').replace('"','\\"')+'"'

def cs_quoted(value,maximum=1024):
    quoted(value,maximum)
    # CS2D does not implement backslash-escaped quotation marks. Backslashes
    # themselves are literal; inventing escaping here silently changes names.
    if '"' in value:raise ValueError('Native CS2D values cannot contain quotation marks')
    return '"'+value+'"'

def confined(root,text):
    path=(root/text).resolve()
    if not path.is_relative_to(root.resolve()):raise ValueError('Native path escapes server volume')
    return path

def patch_commands(previous,settings):
    result=[];seen=set();newline='\r\n' if '\r\n' in previous else '\n'
    for line in previous.splitlines(keepends=True):
        key=line.strip().split(' ',1)[0].split('\t',1)[0]
        if key in settings:
            if key in seen:raise ValueError('Duplicate managed native command: '+key)
            seen.add(key);line=key+' '+settings[key]+newline
        result.append(line)
    if result and not result[-1].endswith(('\r','\n')):result[-1]+=newline
    result.extend(key+' '+value+newline for key,value in settings.items() if key not in seen)
    return ''.join(result)

def configure_cs2d(root,env):
    game=root/'cs2d';port=integer(env,'SERVER_PORT',36963,1,65535)
    maximum=integer(env,'SERVER_PLAYERS',12,1,32)
    name=env.get('SERVER_NAME','CS2D Server');password=env.get('SERVER_PASSWORD','')
    game_map=env.get('SERVER_MAP','de_dust2')
    if not re.fullmatch(r'[A-Za-z0-9 _-]{1,100}',game_map) or not (game/'maps'/(game_map+'.map')).is_file():raise ValueError('Selected CS2D map missing')
    public=env.get('PUBLIC_SERVER','0')
    if public not in ('0','1'):raise ValueError('Invalid public listing mode')
    credential=root/'.voltra/cs2d/rcon-password';rcon=env.get('RCON_PASSWORD','')
    if not rcon:
        if not credential.exists():ini.private_write(credential,secrets.token_hex(16))
        rcon=credential.read_text()
    values={'sv_hostport':str(port),'sv_name':cs_quoted(name,64),'sv_password':cs_quoted(password,32),'sv_maxplayers':str(maximum),'sv_map':cs_quoted(game_map,100),'sv_lan':'0' if public=='1' else '1','sv_rcon':cs_quoted(rcon,64),'sv_gamemode':str(integer(env,'GAME_MODE',0,0,5)),'bot_count':str(integer(env,'BOT_COUNT',0,0,32))}
    config=confined(root,'cs2d/sys/server.cfg');original=config.read_text() if config.exists() else '';updated=patch_commands(original,values)
    if updated!=original:
        if original:ini.private_write(root/'.voltra/cs2d/previous-server.cfg',original)
        ini.private_write(config,updated)
    adapter=game/'sys/lua/autorun/voltra-console.lua'
    ini.private_write(adapter,Path(__file__).with_name('cs2d-console.lua').read_text())
    mailbox=root/'.voltra/cs2d/console-command'
    if mailbox.is_symlink():raise ValueError('Native console mailbox must not use symlinks')
    mailbox.unlink(missing_ok=True)
    return [str(game/'cs2d_dedicated'),'-port',str(port),'-maxplayers',str(maximum)],game

def configure_openrct2(root,env):
    data=confined(root,'ServerData');data.mkdir(parents=True,exist_ok=True)
    general={'autosave':str(integer(env,'AUTOSAVE_INTERVAL',1,0,5)),'autosave_amount':str(integer(env,'AUTOSAVE_AMOUNT',10,0,10000))}
    network={'default_port':str(integer(env,'SERVER_PORT',11753,1,65535)),'maxplayers':str(integer(env,'MAX_PLAYERS',16,1,255))}
    for key,variable in [('player_name','SERVER_PLAYER_NAME'),('default_password','SERVER_PASSWORD'),('server_name','SERVER_NAME'),('server_description','SERVER_DESCRIPTION'),('server_greeting','SERVER_GREETING'),('provider_name','PROVIDER_NAME'),('provider_email','PROVIDER_EMAIL'),('provider_website','PROVIDER_WEBSITE')]:network[key]=quoted(env.get(variable,'Server' if variable=='SERVER_PLAYER_NAME' else ''),1024)
    for key,variable,default in [('advertise','SERVER_ADVERTISE','false'),('pause_server_if_no_clients','PAUSE_NO_CLIENTS','false'),('log_chat','LOG_CHAT','false'),('log_server_actions','LOG_SERVER_ACTIONS','false')]:
        value=env.get(variable,default)
        if value not in ('true','false'):raise ValueError('Invalid OpenRCT2 boolean')
        network[key]=value
    asset=env.get('RCT2_DATA_PATH','')
    if asset:general['game_path']=quoted(str(confined(root,asset)))
    ini.configure_ini(root,data/'config.ini',{'general':general,'network':network},root/'.voltra/openrct2/config-backups')
    autosave=env.get('LOAD_AUTOSAVE','true')
    if autosave not in ('true','false'):raise ValueError('Invalid autosave selection')
    saves=sorted((data/'save/autosave').glob('*'),key=lambda p:p.stat().st_mtime_ns,reverse=True) if (data/'save/autosave').is_dir() else []
    saves=[p for p in saves if p.is_file() and p.suffix.lower() in ('.park','.sv6','.sv4')]
    uri=env.get('SAVE_URI','ServerData/save/save.park')
    if autosave=='true' and saves:selected=saves[0]
    elif uri.startswith('https://'):
        # Keep private URI out of argv and reports; bounded fetch to owned file.
        selected=data/'save/remote.park';selected.parent.mkdir(parents=True,exist_ok=True)
        with urllib.request.urlopen(uri,timeout=60) as source:
            if not source.url.startswith('https://'):raise ValueError('Save download redirected outside HTTPS')
            content=source.read(128*1024**2+1)
        if len(content)>128*1024**2:raise ValueError('Remote park exceeds128MiB')
        temporary=selected.with_suffix('.tmp');temporary.write_bytes(content);os.replace(temporary,selected)
    elif '://' in uri:raise ValueError('Remote saves require HTTPS')
    else:selected=confined(root,uri)
    if not selected.is_file():raise ValueError('Upload a compatible saved park through Files and set Save File; the server cannot create a new park automatically')
    game=root/'OpenRCT2';libraries=env.get('LD_LIBRARY_PATH','./OpenRCT2/lib')
    # Retain original advanced library path, resolving it within this volume.
    os.environ['LD_LIBRARY_PATH']=str(confined(root,libraries))+':'+str(game/'lib')
    return [str(game/'bin/openrct2-cli'),'host',str(selected),'--port',network['default_port'],'--user-data-path',str(data)],root

def run_native(argv,cwd,credentials,mailbox=None):
    # Preserve native console bytes; only remove credentials from output.
    spec=importlib.util.spec_from_file_location('console',Path(__file__).with_name('steam_template.py'))
    console=importlib.util.module_from_spec(spec);spec.loader.exec_module(console)
    child=subprocess.Popen(argv,cwd=cwd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
    commands=queue.Queue(maxsize=128)
    def enqueue(data):
        if not data or len(data)>65536 or b'\x00' in data:return
        try:commands.put_nowait(data)
        except queue.Full:print('Native console queue is full; command rejected.',flush=True)
    def publish_commands():
        while child.poll() is None:
            try:data=commands.get(timeout=.25)
            except queue.Empty:continue
            while mailbox.exists() and child.poll() is None:time.sleep(.05)
            if child.poll() is not None:return
            temporary=mailbox.with_suffix('.tmp')
            with open(temporary,'wb',opener=lambda p,f:os.open(p,f,0o600)) as out:out.write(data)
            os.replace(temporary,mailbox)
    def forward():
        try:
            pending=b''
            for block in iter(lambda:os.read(sys.stdin.fileno(),65536),b''):
                if mailbox is None:child.stdin.write(block);child.stdin.flush()
                else:
                    pending+=block
                    while b'\n' in pending:
                        line,pending=pending.split(b'\n',1);enqueue(line+b'\n')
                    if len(pending)>65536:pending=b''
        except (OSError,ValueError):pass
    def stop(*_):
        if mailbox is not None:enqueue(b'quit\n');return
        try:os.killpg(child.pid,signal.SIGINT)
        except ProcessLookupError:pass
    signal.signal(signal.SIGINT,stop);signal.signal(signal.SIGTERM,stop)
    threading.Thread(target=forward,daemon=True).start()
    if mailbox is not None:threading.Thread(target=publish_commands,daemon=True).start()
    redactor=console.Redactor(credentials)
    for line in iter(child.stdout.readline,b''):
        sys.stdout.buffer.write(redactor.feed(line,final=line.endswith(b'\n')));sys.stdout.buffer.flush()
    sys.stdout.buffer.write(redactor.feed(b'',final=True));sys.stdout.buffer.flush()
    return child.wait()

if __name__=='__main__':
    root=Path.cwd().resolve();game=sys.argv[1]
    try:argv,cwd=(configure_cs2d if game=='cs2d' else configure_openrct2)(root,os.environ)
    except (ValueError,OSError):
        print('Native '+game+' settings or operator files are invalid. Check recipe requirements and settings; private values were not printed.',file=sys.stderr);raise SystemExit(1)
    os.environ.pop('PYTHONHOME',None);os.environ.pop('PYTHONPATH',None)
    credentials=[os.environ.get(key,'') for key in ('SERVER_PASSWORD','RCON_PASSWORD')]
    credential=root/'.voltra/cs2d/rcon-password'
    if game=='cs2d' and credential.is_file():credentials.append(credential.read_text())
    raise SystemExit(run_native(argv,cwd,credentials,root/'.voltra/cs2d/console-command' if game=='cs2d' else None))

