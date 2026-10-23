#!/usr/bin/env python3
"""MIT. Original Assetto, AGPL AssettoServer and Automobilista2 native setup."""
import importlib.util
import json
import os
import platform
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

def helper(name):
    path=Path(__file__).with_name(name+'.py')
    if not path.exists():path=path.with_name(name.replace('-','_')+'.py')
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    sys.modules.setdefault(name.replace('-','_'),module)
    return module

native=helper('native-config');steam=helper('steam-template');release=helper('native-release')
ASSETTO_SERVER={'version':'v0.0.54','url':'https://github.com/compujuckel/AssettoServer/releases/download/v0.0.54/assetto-server-linux-x64.tar.gz','sha256':'1067344bd8a98e1fa3575c43a55dcc9ce64f4da20ae6db6da335715e4187e36f','bytes':46236246,'prefix':None}
ASSETTO_SERVER_ARM64={**ASSETTO_SERVER,'url':'https://github.com/compujuckel/AssettoServer/releases/download/v0.0.54/assetto-server-linux-arm64.tar.gz','sha256':'3f58e90eff70d8551fc54aa60e2e89498ecdabb6c277b64b6f117d0ff7f29fe0','bytes':44371542}

def assettoserver_release():
    machine=platform.machine().lower()
    if machine in ('x86_64','amd64'):return ASSETTO_SERVER
    if machine in ('aarch64','arm64'):return ASSETTO_SERVER_ARM64
    raise ValueError('AssettoServer supports the reviewed Linuxx64 and ARM64 releases only')

def confined(root,path):
    path=Path(path)
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):raise ValueError('Racing path leaves server volume')
    for parent in path.parents:
        if parent==root:break
        if parent.is_symlink():raise ValueError('Racing path uses symbolic links')
    return path

def text(env,key,default='',limit=100):
    value=env.get(key,default)
    if not isinstance(value,str) or len(value)>limit or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid '+key)
    return value

def integer(env,key,default,low=1,high=65535):
    value=str(env.get(key,default))
    if not re.fullmatch('[0-9]+',value) or not low<=int(value)<=high:raise ValueError('Invalid '+key)
    return int(value)

def roles(env,keys):
    primary=integer(env,'SERVER_PORT',9600);raw=env.get('VOLTRA_ALLOCATED_PORTS','')
    if not re.fullmatch('[0-9]+(?:,[0-9]+)*',raw):raise ValueError('Missing allocated native ports')
    available={int(x) for x in raw.split(',')}
    if primary not in available or any(not 1<=x<=65535 for x in available):raise ValueError('Invalid native port allocation')
    result={'primary':primary};used={primary}
    # Explicit roles are assigned first so automatic roles cannot consume them.
    for key in keys:
        if env.get(key,''):
            selected=integer(env,key,0)
            if selected not in available or selected in used:raise ValueError('Native port roles require distinct allocated ports')
            used.add(selected);result[key]=selected
    for key in keys:
        if key not in result:
            remaining=sorted(available-used)
            if not remaining:raise ValueError('Missing additional allocation for '+key)
            result[key]=remaining[0];used.add(remaining[0])
    return result

def patch_colon_config(content,values):
    """Lossless native scalar updates; strings/comments/nested addons survive."""
    tokens=[];i=0
    while i<len(content):
        start=i;c=content[i]
        if c.isspace():i+=1;continue
        if content.startswith('//',i) or c=='#':
            i=content.find('\n',i)
            if i<0:break
            continue
        if content.startswith('/*',i):
            end=content.find('*/',i+2)
            if end<0:raise ValueError('Unterminated native configuration comment')
            i=end+2;continue
        if c=='"':
            i+=1
            while i<len(content):
                if content[i]=='\\':i+=2;continue
                if content[i]=='"':i+=1;break
                if ord(content[i])<32:raise ValueError('Invalid native configuration string')
                i+=1
            else:raise ValueError('Unterminated native configuration string')
            value=json.loads(content[start:i]);kind='string'
        elif c in '{}[]:,;':i+=1;value=c;kind=c
        else:
            while i<len(content) and not content[i].isspace() and content[i] not in '{}[]:,;"#' and not content.startswith('//',i) and not content.startswith('/*',i):i+=1
            if i==start:raise ValueError('Invalid native configuration token')
            value=content[start:i];kind='scalar'
        tokens.append((kind,value,start,i))
    base=1 if tokens and tokens[0][0]=='{' else 0;depth=0;stack=[];seen=set();changes=[]
    for index,token in enumerate(tokens):
        kind,value,start,end=token
        if depth==base and kind in ('scalar','string') and value in values and index+1<len(tokens) and tokens[index+1][0]==':':
            if value in seen:raise ValueError('Duplicate managed native field '+value)
            seen.add(value)
            if index+2>=len(tokens) or tokens[index+2][0] not in ('string','scalar'):raise ValueError('Managed native field must be scalar')
            target=tokens[index+2];changes.append((target[2],target[3],json.dumps(values[value],ensure_ascii=False)))
        if kind in ('{','['):depth+=1;stack.append(kind)
        elif kind in ('}',']'):
            if not stack or stack.pop()!=('{' if kind=='}' else '['):raise ValueError('Mismatched native configuration container')
            depth-=1
            if depth<0:raise ValueError('Unbalanced native configuration')
    if depth:raise ValueError('Unbalanced native configuration')
    if seen!=set(values):raise ValueError('Publisher configuration missing managed native fields: '+','.join(sorted(set(values)-seen)))
    for start,end,value in reversed(changes):content=content[:start]+value+content[end:]
    return content

def configure(root,game,env):
    root=Path(root).resolve()
    if game in ('assetto','assettoserver'):
        selected=roles(env,['HTTP_PORT']);custom=game=='assettoserver'
        values={'NAME':text(env,'SERVER_NAME' if custom else 'HOSTNAME','Assetto server',40 if custom else 45),
                'PASSWORD':text(env,'SERVER_PASSWORD' if custom else 'PASSWORD','',64 if custom else 40),
                'ADMIN_PASSWORD':text(env,'ADMIN_PASSWORD','',64 if custom else 40),
                'UDP_PORT':str(selected['primary']),'TCP_PORT':str(selected['primary']),'HTTP_PORT':str(selected['HTTP_PORT'])}
        if len(values['ADMIN_PASSWORD'])<8:raise ValueError('Native Assetto administrator password requires at least8 characters')
        if custom:values['MAX_CLIENTS']=str(integer(env,'MAX_CLIENTS',18,2,25))
        if 'PUBLIC_SERVER' in env:values['REGISTER_TO_LOBBY']=str(integer(env,'PUBLIC_SERVER',0,0,1))
        target=confined(root,root/'cfg/server_cfg.ini');native.configure_ini(root,target,{'SERVER':values},confined(root,root/'.voltra/assetto/config-backups'))
        return [str(root/('AssettoServer' if custom else 'acServer'))],(values['ADMIN_PASSWORD'],values['PASSWORD'])
    if game!='ams2':raise ValueError('Unsupported racing recipe')
    selected=roles(env,['STEAM_PORT','QUERY_PORT']);target=confined(root,root/'server.cfg')
    values={'name':text(env,'SERVER_NAME','Automobilista2',100),'password':text(env,'SERVER_PASSWORD','',32),
            'steamPort':selected['STEAM_PORT'],'hostPort':selected['primary'],'queryPort':selected['QUERY_PORT'],'maxPlayerCount':integer(env,'MAX_PLAYERS',16,1,32)}
    previous=target.read_text(encoding='utf-8-sig');updated=patch_colon_config(previous,values)
    if updated!=previous:
        backup=confined(root,root/'.voltra/ams2/config-backups'/str(time.time_ns()));native.private_write(backup,previous);native.private_write(target,updated)
    else:target.chmod(0o600)
    return ['wine',str(root/'DedicatedServerCmd.exe')],(values['password'],)

def install_steam(root,game,env,validate=True):
    app=302550 if game=='assetto' else 1338040
    if env.get('SRCDS_APPID',str(app))!=str(app):raise ValueError('Wrong native racing Steam application')
    if game=='assetto' and env.get('STEAM_USER','') not in ('','anonymous'):raise ValueError('Assetto account installation remains unavailable until private Steam credential transport is verified; no account login attempted')
    # Snapshot operator configuration and any modified non-binary assets before
    # Steam validate, including its failure path. Never copy credentials to logs.
    restore=helper('source-install').restore_file;state=confined(root,root/'.voltra/racing-preserve');state.mkdir(parents=True,exist_ok=True)
    receipt=confined(root,state/'publisher-files.json');old=json.loads(receipt.read_text()) if receipt.exists() else {};excluded={'.voltra','.steam','.cache','steamapps','steamcmd','logs','.wine'}
    files=lambda:[p for p in root.rglob('*') if not any(part in excluded for part in p.relative_to(root).parts) and p.is_file() and p.name not in ('acServer','acServer.exe','DedicatedServerCmd.exe')]
    records=[]
    with tempfile.TemporaryDirectory(prefix='.preserve-',dir=state) as temporary:
        for index,path in enumerate(files()):
            confined(root,path);name=path.relative_to(root).as_posix()
            if not path.suffix.lower() in ('.cfg','.ini','.txt','.json','.yml','.yaml','.lua') and old.get(name)==release.sha256(path):continue
            info=path.stat();backup=Path(temporary)/str(index);shutil.copyfile(path,backup);backup.chmod(0o600)
            records.append({'path':name,'target':name,'backup':str(backup),'uid':info.st_uid,'gid':info.st_gid,'mode':info.st_mode&0o7777,'atime_ns':info.st_atime_ns,'mtime_ns':info.st_mtime_ns,'link':None})
        try:
            result=steam.update(root,app,env,validate=validate,required=('acServer',) if game=='assetto' else ('DedicatedServerCmd.exe',),platform='windows',force_platform=True)
            native.private_write(receipt,json.dumps({p.relative_to(root).as_posix():release.sha256(p) for p in files()},sort_keys=True)+'\n')
            if game=='assetto':(root/'acServer').chmod(0o755)
            else:
                config=confined(root,root/'server.cfg')
                if not config.exists():shutil.copyfile(confined(root,root/'config_sample/server_with_lists.cfg'),config);config.chmod(0o600)
            return result
        finally:
            for record in records:restore(root,record)

def install(root,game,env):
    root=Path(root).resolve()
    if game in ('assetto','ams2'):return install_steam(root,game,env)
    if game!='assettoserver':raise ValueError('Unsupported racing recipe')
    release.install_release(root,assettoserver_release(),'.','AssettoServer')
    # Operator must supply their real server preset and content. Do not invent
    # car/track assets, AI splines, DLC licenses, or a successfully ready server.
    folder=confined(root,root/'cfg');folder.mkdir(parents=True,exist_ok=True)
    entry=confined(root,folder/'entry_list.ini')
    if not entry.exists():native.private_write(entry,'; Import your licensed/operator-provided server preset.\n')

def run(root,game,env):
    if game in ('assetto','ams2') and env.get('VOLTRA_STEAM_AUTO_UPDATE','0')=='1':install_steam(root,game,env,validate=env.get('VALIDATE','0')=='1')
    argv,secrets=configure(root,game,env)
    environment=dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH','LD_PRELOAD'):environment.pop(key,None)
    environment['HOME']=str(root)
    if game=='ams2':
        # Image-global Xvfb is signalled by tini before the native server saves.
        # Own a separate display session and keep it alive through native exit.
        environment['WINEDEBUG']=text(env,'WINEDEBUG','-all',20)
        environment['DISPLAY']=':99'
        display=subprocess.Popen(['Xvfb',':99','-screen','0','1024x768x24','-nolisten','tcp','-noreset'],
            env=environment,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
        try:
            for _ in range(100):
                if display.poll() is not None:raise ValueError('Private dedicated display failed to start')
                if Path('/tmp/.X11-unix/X99').exists():break
                time.sleep(.05)
            else:raise ValueError('Private dedicated display did not become ready')
            code=helper('native-console').run(root,argv,environment,'\x03',secrets,
                terminal_input=True,terminal_query_reply=True,terminal_enter_carriage_return=True)
            return code if code>=0 else 128-code
        finally:
            if display.poll() is None:
                display.terminate()
                try:display.wait(timeout=5)
                except subprocess.TimeoutExpired:display.kill();display.wait()
    redactor=steam.Redactor(secrets);child=subprocess.Popen(argv,cwd=root,env=environment,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
    def forward():
        try:
            while True:
                data=os.read(sys.stdin.fileno(),65536)
                if not data:return
                child.stdin.write(data);child.stdin.flush()
        except (OSError,ValueError):pass
    threading.Thread(target=forward,daemon=True).start()
    def stop(*_):
        if child.poll() is None:os.killpg(child.pid,signal.SIGINT)
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    try:
        while True:
            data=child.stdout.read1(16384)
            if not data:break
            sys.stdout.buffer.write(redactor.feed(data));sys.stdout.buffer.flush()
        sys.stdout.buffer.write(redactor.feed(b'',final=True));sys.stdout.buffer.flush();code=child.wait();return code if code>=0 else 128-code
    finally:child.stdin.close();child.stdout.close()

def main():
    mode,game=sys.argv[1:3];root=Path.cwd();env=dict(os.environ)
    if mode=='install':install(root,game,env);return 0
    if mode=='run':return run(root,game,env)
    raise ValueError('Unsupported native racing action')

if __name__=='__main__':
    try:sys.exit(main())
    except (ValueError,OSError,KeyError):print('Racing setup failed. Review native configuration, allocations, operator content and installation prerequisites; private Steam account transport is unsupported.',file=sys.stderr);sys.exit(1)
