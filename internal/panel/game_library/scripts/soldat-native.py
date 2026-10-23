#!/usr/bin/env python3
"""MIT. Typed Soldat/Soldat2 setup around the original publisher executables."""
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

def helper(name):
    target=Path(__file__).with_name(name+'.py')
    if name=='steam-template' and target.with_name('steam_template.py').exists():target=target.with_name('steam_template.py')
    spec=importlib.util.spec_from_file_location(name,target)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    if name=='steam-template':sys.modules.setdefault('steam_template',module)
    return module

native=helper('native-config');release=helper('native-release')
SOLDAT2={'version':'0.8.71.A','url':'https://dl.thd.vg/soldat2-linuxserver-release.tar.gz','sha256':'795871c1fa8837ef6d5805438a87333e521e32bdbcc5c148db7a810f8c20774c','bytes':164082723,'prefix':'soldat2-linuxserver-release'}

def number(env,key,default,low,high):
    value=str(env.get(key,default))
    if not re.fullmatch(r'[0-9]+',value) or not low<=int(value)<=high:raise ValueError('Invalid '+key)
    return int(value)

def text(env,key,default='',limit=200):
    value=env.get(key,default)
    if not isinstance(value,str) or len(value)>limit or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid '+key)
    return value

def confined(root,path):
    path=Path(path)
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):raise ValueError('Soldat path leaves volume')
    return path

def credential(root,game,value):
    if value:return value
    path=confined(root,root/'.voltra'/game/'admin-password')
    if path.exists():return path.read_text().strip()
    value=secrets.token_hex(10);native.private_write(path,value+'\n');return value

def configure(root,game,env):
    root=Path(root).resolve();port=number(env,'SERVER_PORT',23073 if game=='soldat' else 33073,1,65535)
    raw=env.get('VOLTRA_ALLOCATED_PORTS','')
    if not re.fullmatch(r'[0-9]+(?:,[0-9]+)*',raw):raise ValueError('Missing native port allocations')
    ports={int(p) for p in raw.split(',')}
    if port not in ports or any(not 1<=p<=65535 for p in ports):raise ValueError('Invalid native port allocation')
    if game=='soldat':
        if port+10 not in ports:raise ValueError('Soldat requires primary TCP/UDP and allocated TCP primary+10')
        admin=credential(root,game,text(env,'ADMIN_PASSWD','',20))
        values={'Port':str(port),'Max_Players':str(number(env,'MAX_PLAYERS',10,1,20)),
                'Game_Password':text(env,'SRV_PWD','',20),'Admin_Password':admin,'Server_Name':text(env,'SRV_NAME','MySoldatServer',100)}
        if 'PUBLIC_SERVER' in env:values['Lobby_Register']='1' if number(env,'PUBLIC_SERVER',0,0,1) else '0'
        path=confined(root,root/'soldat.ini');sections={'NETWORK':values};argv=[str(root/'soldatserver')]
    elif game=='soldat2':
        ws=number(env,'WEBSOCKETS_PORT',0,0,65535);rcon=number(env,'RCON_PORT',0,0,65535)
        used={port}
        for selected in (ws,rcon):
            if not selected:continue
            if selected not in ports or selected in used:raise ValueError('Enabled Soldat2 WebSocket ports require distinct allocations')
            used.add(selected)
        admin=credential(root,game,text(env,'RCON_PASSWORD','',100)) if rcon else text(env,'RCON_PASSWORD','',100)
        values={'Name':text(env,'SERVER_NAME','PterodactylServer',50),'Port':str(port),'WebSocketsPort':str(ws),'WebSocketsRconPort':str(rcon),
                'MaxPlayers':str(number(env,'MAX_PLAYERS',12,1,12)),'ServerPassword':text(env,'SERVER_PASSWORD','',100),'RconPassword':admin,
                'GreetMessage':text(env,'GREET_MESSAGE','Welcome! Be friendly and have fun!',200),'AdminPlayfabId':text(env,'ADMIN_PLAYFAB_ID','',100)}
        if 'PUBLIC_SERVER' in env:values['VisibleInGamesList']='True' if number(env,'PUBLIC_SERVER',0,0,1) else 'False'
        path=confined(root,root/'autoconfig.ini');sections={'GameServerConfig':values}
        if not path.exists():
            # Reviewed publisher0.8.71.A migrates files without this marker as
            # obsolete and discards their managed passwords on first startup.
            # Existing files keep their own migration version and native path.
            sections['ConfigUpdater']={'Version':'36'}
        # Native key=value arguments are individual argv elements, so spaces,
        # quotes and shell punctuation remain literal values.
        argv=[str(root/'soldat2'),'-batchmode','-nographics','-logFile','-',*['%s=%s'%(k,v) for k,v in values.items() if k not in ('ServerPassword','RconPassword')]]
    else:raise ValueError('Unsupported Soldat game')
    native.configure_ini(root,path,sections,confined(root,root/'.voltra'/game/'config-backups'))
    return argv,admin

def install_soldat(root,env):
    if env.get('SRCDS_APPID','638500')!='638500':raise ValueError('Soldat requires Steam app638500')
    steam=helper('steam-template');restore=helper('source-install').restore_file
    state=confined(root,root/'.voltra/soldat');state.mkdir(parents=True,exist_ok=True)
    receipt=confined(root,state/'publisher-files.json');old=json.loads(receipt.read_text()) if receipt.exists() else {}
    excluded={'.voltra','.steam','.cache','steamapps','steamcmd','logs','linux32','linux64'}
    def files():return [p for p in root.rglob('*') if not any(part in excluded for part in p.relative_to(root).parts) and p.is_file() and p.name!='soldatserver']
    records=[]
    with tempfile.TemporaryDirectory(prefix='.preserve-',dir=state) as directory:
        for index,path in enumerate(files()):
            confined(root,path);name=path.relative_to(root).as_posix()
            managed=path.suffix.lower() in ('.ini','.cfg','.txt','.json','.pas')
            if not managed and old.get(name)==release.sha256(path):continue
            info=path.stat();backup=Path(directory)/str(index);shutil.copyfile(path,backup);backup.chmod(0o600)
            records.append({'path':name,'target':name,'backup':str(backup),'uid':info.st_uid,'gid':info.st_gid,'mode':info.st_mode&0o7777,'atime_ns':info.st_atime_ns,'mtime_ns':info.st_mtime_ns,'link':None})
        try:
            result=steam.update(root,638500,env,required=('soldatserver',))
            hashes={p.relative_to(root).as_posix():release.sha256(p) for p in files()}
            content=json.dumps(hashes,sort_keys=True,indent=2)+'\n'
            if not receipt.exists() or receipt.read_text()!=content:
                previous=receipt.stat() if receipt.exists() else None;native.private_write(receipt,content)
                if previous:os.chown(receipt,previous.st_uid,previous.st_gid);receipt.chmod(previous.st_mode&0o777)
            (root/'soldatserver').chmod(0o755)
            return result
        finally:
            for record in records:restore(root,record)

def install(root,game,env):
    root=Path(root).resolve()
    if game=='soldat':return install_soldat(root,env)
    if game!='soldat2':raise ValueError('Unsupported Soldat game')
    identity=dict(SOLDAT2)
    if env.get('RELEASE_SHA256'):identity['sha256']=text(env,'RELEASE_SHA256','',64)
    if not re.fullmatch('[0-9a-f]{64}',identity['sha256']):raise ValueError('Invalid publisher SHA256')
    # This volume hosts one dedicated game. Root layout retains the original
    # autoconfig/Levels/Rules/Scripts paths and all publisher license notices.
    return release.install_release(root,identity,'.','soldat2')

def run_soldat2(root,argv,credentials=(),stop_timeout=45):
    """Native main-thread quit request; report raw failures, never normalize."""
    root=Path(root).resolve();state=confined(root,root/'.voltra/soldat2');state.mkdir(parents=True,exist_ok=True);state.chmod(0o700)
    request=confined(root,state/'stop-request');ack=confined(root,state/'stop-ack');token=secrets.token_hex(16)
    for stale in (request,ack):
        if stale.exists():stale.unlink()
    native.private_write(confined(root,state/'launch-token'),token+'\n')
    native.private_write(request,'')
    child=subprocess.Popen(argv,cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
    steam=helper('steam-template');redactor=steam.Redactor(credentials)
    observed={'stop_requested':False,'native_lifecycle_ready':False,'native_quit_seen':False,'stop_timed_out':False,'fallback_signal':None}
    deadline=None
    def output():
        for line in iter(child.stdout.readline,b''):
            if b'VOLTRA_LIFECYCLE_READY' in line:observed['native_lifecycle_ready']=True
            if b'VOLTRA_NATIVE_QUIT_REQUEST' in line:
                observed['native_quit_seen']=True
                if token.encode() in line:observed['native_token_ack']=True
            sys.stdout.buffer.write(redactor.feed(line.replace(token.encode(),b'[LIFECYCLE_TOKEN]'),final=line.endswith(b'\n')));sys.stdout.buffer.flush()
        sys.stdout.buffer.write(redactor.feed(b'',final=True));sys.stdout.buffer.flush()
    reader=threading.Thread(target=output,daemon=True);reader.start()
    def forward():
        try:
            while True:
                data=os.read(sys.stdin.fileno(),65536)
                if not data:return
                child.stdin.write(data);child.stdin.flush()
        except (OSError,ValueError):pass
    threading.Thread(target=forward,daemon=True).start()
    def stop(*_):
        nonlocal deadline
        if child.poll() is None and not observed['stop_requested']:
            observed['stop_requested']=True;native.private_write(request,'stop:'+token+'\n');deadline=time.monotonic()+stop_timeout
    old={key:signal.getsignal(key) for key in (signal.SIGTERM,signal.SIGINT)}
    for key in old:signal.signal(key,stop)
    try:
        while child.poll() is None:
            if deadline is not None and time.monotonic()>=deadline:
                observed['stop_timed_out']=True;observed['fallback_signal']='SIGTERM';child.send_signal(signal.SIGTERM)
                try:child.wait(timeout=5)
                except subprocess.TimeoutExpired:observed['fallback_signal']='SIGKILL';child.kill()
                break
            time.sleep(0.05)
        code=child.wait();reader.join(timeout=2)
        observed.update(native_return_code=code,acknowledged=observed.get('native_token_ack',False))
        native.private_write(confined(root,state/'lifecycle-last.json'),json.dumps(observed,indent=2)+'\n')
        return code if code>=0 else 128-code
    finally:
        for key,value in old.items():signal.signal(key,value)
        child.stdin.close();child.stdout.close()

def main():
    mode,game=sys.argv[1:3];root=Path.cwd();env=dict(os.environ)
    if mode=='install':install(root,game,env);return 0
    if mode!='run':raise ValueError('Unsupported Soldat action')
    argv,admin=configure(root,game,env)
    if game=='soldat2':return run_soldat2(root,argv,(admin,env.get('SERVER_PASSWORD','')))
    # Soldat retains its original native signal path and raw publisher status.
    os.execv(argv[0],argv)

if __name__=='__main__':
    try:sys.exit(main())
    except (ValueError,OSError,KeyError):
        print('Soldat setup failed. Check native configuration, publisher install and allocated ports.',file=sys.stderr);sys.exit(1)
