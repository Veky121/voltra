#!/usr/bin/env python3
"""MIT. Original Avorion native options with allocated ports and native console."""
import math
import os
from pathlib import Path
import re
import sys
from native_console import run
from strategy_survival_install import install
from private_nss import native_environment


def integer(env,key,default,minimum,maximum):
    value=int(env.get(key,str(default)))
    if not minimum<=value<=maximum:
        raise ValueError(key+' is outside its native range')
    return value


def text(value,maximum):
    if len(value.encode())>maximum or any(ord(c)<32 or ord(c)==127 for c in value):
        raise ValueError('Native text exceeds its byte limit or contains control characters')
    return value


def arguments(root,env):
    root=Path(root).resolve()
    galaxy=text(env.get('GALAXY_NAME','Avorion'),32)
    if not galaxy or galaxy in ('.','..') or any(c in galaxy for c in '/\\'):
        raise ValueError('Galaxy name must be a confined directory name')
    directory=root/'galaxy'/galaxy
    if not directory.resolve().is_relative_to(root) or directory.is_symlink():
        raise ValueError('Galaxy data escapes the server volume')
    game=integer(env,'SERVER_PORT',27000,1,65535)
    allocated=sorted({int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS','').split(',') if p})
    if game not in allocated or len(allocated)<4 or any(not 1<=p<=65535 for p in allocated):
        raise ValueError('Choose four native allocations on the same address')
    keys=('QUERY_PORT','STEAM_MASTER_PORT','STEAM_QUERY_PORT')
    explicit=[int(env[key]) for key in keys if env.get(key)]
    if len(explicit)!=len(set(explicit)) or game in explicit or any(p not in allocated for p in explicit):
        raise ValueError('Native query/Steam ports must be distinct selected allocations')
    chosen=[game]
    for key in keys:
        port=int(env[key]) if env.get(key) else next((p for p in allocated if p not in chosen and p not in explicit),0)
        if port not in allocated or port in chosen:
            raise ValueError('Native query/Steam ports must be distinct selected allocations')
        chosen.append(port)
    collision=float(env.get('COLLISION_DMG','1'))
    if not math.isfinite(collision) or collision<0:
        raise ValueError('Collision damage must be a finite nonnegative multiplier')
    argv=[str(root/'bin/AvorionServer'),'--galaxy-name',galaxy,'--datapath',str(root/'galaxy'),
          '--port',str(game),'--query-port',str(chosen[1]),'--steam-master-port',str(chosen[2]),'--steam-query-port',str(chosen[3]),
          '--max-players',str(integer(env,'MAX_PLAYERS',10,1,64)),
          '--difficulty',str(integer(env,'DIFFICULTY',0,-3,3)),
          '--collision-damage',str(collision),'--save-interval',str(integer(env,'SAVE_INTERVAL',300,0,86400)),
          '--server-name',text(env.get('SERVER_NAME','Avorion Server'),64),
          '--threads',str(integer(env,'GAME_THREADS',1,0,20))]
    for key,flag,default in [('SAME_START_SECTOR','--same-start-sector','true'),('SERVER_LISTED','--listed','false')]:
        value=env.get(key,default)
        if value not in ('true','false'):
            raise ValueError(key+' must be true or false')
        argv.extend([flag,value])
    admin=env.get('ADMIN_ID','')
    if admin:
        if not re.fullmatch(r'[0-9]{17,20}',admin) or not 0<int(admin)<2**64:
            raise ValueError('Admin ID must be a numeric Steam64 ID, or empty for console-only administration')
        argv.extend(['--admin',admin])
    environment=dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD'):
        environment.pop(key,None)
    libraries=env.get('VOLTRA_NATIVE_LIBRARY_PATH','./linux64')
    paths=[]
    for value in libraries.split(':'):
        path=(root/value).resolve()
        if not value or not path.is_relative_to(root):
            raise ValueError('Native library path must remain in the server volume')
        paths.append(str(path))
    environment.update(HOME=str(root),LD_LIBRARY_PATH=':'.join([*paths,str(root/'.steam/sdk64')]))
    return argv,environment


if __name__=='__main__':
    root=Path.cwd();env=dict(os.environ)
    automatic=env.get('VOLTRA_STEAM_AUTO_UPDATE','0')
    if automatic not in ('0','1'):
        raise ValueError('Invalid automatic update flag')
    if automatic=='1':
        install(root,'avorion',env,validate=False)
    argv,environment=arguments(root,env)
    environment=native_environment(root,environment,argv[0],'bin/AvorionServer')
    raise SystemExit(run(root,argv,environment,'/stop',credentials=[env.get(k,'') for k in ('STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')],ready_marker=b'Server startup complete'))
