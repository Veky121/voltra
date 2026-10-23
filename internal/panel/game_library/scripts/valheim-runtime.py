#!/usr/bin/env python3
"""MIT. Literal native Valheim arguments and graceful Unity lifecycle."""
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
from steam_template import Redactor
from private_nss import native_environment


def text(env, key, default='', maximum=128):
    value=env.get(key,default)
    if not isinstance(value,str) or len(value)>maximum or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid '+key)
    return value


def integer(env,key,default,minimum=0,maximum=2147483647):
    value=int(env.get(key,str(default)))
    if not minimum<=value<=maximum:raise ValueError('Invalid '+key)
    return value


def configure(root,env):
    root=Path(root).resolve();binary=root/'valheim_server.x86_64'
    if not binary.is_file() or not binary.resolve().is_relative_to(root):raise ValueError('Missing confined native Valheim executable')
    name=text(env,'SERVER_NAME','My Server',60);world=text(env,'WORLD','Dedicated',20);password=text(env,'PASSWORD','secret',20)
    if not name or not world or any(c in world for c in '/\\') or world in ('.','..'):raise ValueError('Choose a single saved world name')
    if len(password)<5 or password.casefold() in name.casefold():raise ValueError('Password needs five characters and must not appear in the server name')
    port=integer(env,'SERVER_PORT',2456,1,65534);allocated={int(p)for p in env.get('VOLTRA_ALLOCATED_PORTS','').split(',')if p}
    if not {port,port+1}.issubset(allocated):raise ValueError('Valheim requires allocated gameplay and consecutive query ports')
    args=[str(binary),'-nographics','-batchmode','-name',name,'-port',str(port),'-world',world,'-password',password]
    for flag,key,default in [('public','PUBLIC_SERVER',1),('saveinterval','BACKUP_INTERVAL',1800),('backups','BACKUP_COUNT',4),('backupshort','BACKUP_SHORTTIME',7200),('backuplong','BACKUP_LONGTIME',43200)]:
        args.extend(['-'+flag,str(integer(env,key,default,0,1 if key=='PUBLIC_SERVER' else 2147483647))])
    if integer(env,'ENABLE_CROSSPLAY',0,0,1):args.append('-crossplay')
    environment=dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD'):environment.pop(key,None)
    environment.update({'HOME':str(root),'SteamAppId':'892970','LD_LIBRARY_PATH':str(root/'.voltra/valheim/lib')+':'+str(root/'linux64')})
    variant=env.get('VOLTRA_VALHEIM_VARIANT','vanilla')
    if variant not in ('vanilla','bepinex','plus'):raise ValueError('Invalid Valheim recipe')
    if variant!='vanilla':
        library=root/'doorstop_libs/libdoorstop_x64.so';assembly=root/'BepInEx/core/BepInEx.Preloader.dll'
        if not all(p.is_file() and p.resolve().is_relative_to(root)for p in (library,assembly)):raise ValueError('Installed Valheim loader is incomplete; reinstall selected recipe')
        environment.update({'DOORSTOP_ENABLED':'1','DOORSTOP_TARGET_ASSEMBLY':str(assembly),'LD_PRELOAD':str(library),'LD_LIBRARY_PATH':str(root/'doorstop_libs')+':'+environment['LD_LIBRARY_PATH']})
    preloads=(str(root/'doorstop_libs/libdoorstop_x64.so'),)if variant!='vanilla'else()
    environment=native_environment(root,environment,binary,'valheim_server.x86_64',existing_preload=preloads)
    credentials=[password]+[env.get(k,'')for k in ('STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    return args,environment,credentials


def run(root,args,environment,credentials):
    child=subprocess.Popen(args,cwd=root,env=environment,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
    stopping=False
    def stop(*_):
        nonlocal stopping
        if not stopping and child.poll() is None:
            stopping=True
            try:os.killpg(child.pid,signal.SIGINT)
            except ProcessLookupError:pass
    signal.signal(signal.SIGINT,stop);signal.signal(signal.SIGTERM,stop)
    redactor=Redactor(credentials);ready=False
    print('Valheim uses native world and permission files; Stop requests native SIGINT and waits for the save.',flush=True)
    try:
        for line in iter(child.stdout.readline,b''):
            if b'Game server connected' in line or b'Game server connected' in line.replace(b'\x00',b''):
                if not ready:print('VOLTRA_VALHEIM_READY',flush=True);ready=True
            if not line.strip() or re.match(rb'^\(Filename:.*Line:\s+\d+\)',line):continue
            sys.stdout.buffer.write(redactor.feed(line,final=line.endswith(b'\n')));sys.stdout.buffer.flush()
        result=child.wait()
        return result if ready else (result or 1)
    finally:
        child.stdout.close();sys.stdout.buffer.write(redactor.feed(b'',final=True));sys.stdout.buffer.flush()


def main():
    root=Path.cwd();env=dict(os.environ)
    if integer(env,'VOLTRA_STEAM_AUTO_UPDATE',0,0,1):
        from valheim_vrising_install import install
        install(root,'valheim',env)
    return run(root,*configure(root,env))


if __name__=='__main__':sys.exit(main())
