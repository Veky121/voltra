#!/usr/bin/env python3
"""Wurm-only source adapter. Native worlds remain owned by the reviewed installer."""
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from native_config import private_write
from native_console import run
from stationeers_wurm_starbound_install import world_relative, install as shared_install


def launch_config(data, seed):
    if len(data)>1024*1024 or b'\x00' in data: raise ValueError('Invalid LaunchConfig.ini')
    text=data.decode('utf-8')
    rows=[]
    for match in re.finditer(r'(?m)^([^\r\n]*)',text):
        line=match[1].strip()
        if not line or line.startswith(('#',';','[')): continue
        if '=' in line and line.split('=',1)[0].strip().lower()=='cleanlogsonstart':
            key,value=line.split('=',1)
            if key.strip()!='CleanLogsOnStart' or value.strip() not in ('true','false'): raise ValueError('Ambiguous CleanLogsOnStart')
            rows.append(value.strip())
    if len(rows)>1: raise ValueError('Duplicate CleanLogsOnStart')
    if rows: return data
    newline=b'\r\n' if b'\r\n' in data else b'\n'
    # Do not guess a section for missing launcher configuration.
    if any(line.strip().startswith('[') for line in text.splitlines()): raise ValueError('Missing CleanLogsOnStart in sectioned launcher configuration')
    return data+(newline if data and not data.endswith(b'\n') else b'')+b'CleanLogsOnStart='+seed.encode()+newline


def plan(root,env,require_binary=True):
    root=Path(root).resolve()
    def text(key,default='',limit=128):
        value=env.get(key,default)
        if not isinstance(value,str) or len(value)>limit or any(ord(c)<32 or ord(c)==127 for c in value): raise ValueError('Invalid '+key)
        return value
    def boolean(key,default):
        value=text(key,default)
        if value not in ('true','false'): raise ValueError('Invalid '+key)
        return value
    def integer(key,default,lo,hi):
        value=text(key,default)
        if not value.isascii() or not value.isdecimal() or not lo<=int(value)<=hi: raise ValueError('Invalid '+key)
        return int(value)
    port=integer('SERVER_PORT','3724',1,65535);query=integer('QUERY_PORT','27016',1,65535)
    allocated=text('VOLTRA_ALLOCATED_PORTS','',4096).split(',')
    if any(not p.isascii() or not p.isdecimal() or not 1<=int(p)<=65535 for p in allocated): raise ValueError('Invalid allocations')
    if port==query or not {port,query}.issubset({int(p) for p in allocated}): raise ValueError('Allocate distinct gameplay and query ports')
    world=world_relative(root,text('SERVER_WORLD','dist/Adventure'))
    binary=root/'WurmServerLauncher';target=root/'LaunchConfig.ini'
    for path in (binary,target,root/'.voltra/wurm'):
        if path.is_symlink() or not path.resolve().is_relative_to(root): raise ValueError('Unsafe Wurm path')
    if require_binary and (not binary.is_file() or not os.access(binary,os.X_OK)): raise ValueError('Missing executable WurmServerLauncher')
    if target.exists() and not target.is_file(): raise ValueError('Invalid LaunchConfig.ini destination')
    password=text('SERVERPWD','',64);admin=text('ADMINPWD','',20)
    argv=[str(binary),'ip=0.0.0.0','externalport='+str(port),'start='+world,'maxplayers='+str(integer('MAX_PLAYERS','25',1,1000)),'servername='+text('SERVERNAME','Wurm Unlimited',64),'adminpwd='+admin,'serverpassword='+password,'epicsettings='+boolean('EPIC','false'),'queryport='+str(query),'pvp='+boolean('PVP','true')]
    seed=boolean('SERVER_CLEAN_LOGS_ON_START','true')
    if env.get('VOLTRA_STEAM_AUTO_UPDATE','0') not in ('0','1'): raise ValueError('Invalid update selection')
    if env.get('VALIDATE','false') not in ('true','false'): raise ValueError('Invalid validate selection')
    if env.get('SRCDS_BETAID','') not in ('','beta'): raise ValueError('Invalid branch')
    old=target.read_bytes() if target.exists() else b''
    updated=launch_config(old,seed)
    return argv,old,updated,[password,admin]+[text(k,'',1024) for k in ('STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]


def install(root,env):
    plan(root,env,False) # Refuse invalid selections before acquisition or writes.
    # Existing world quarantine and failure restoration remain unchanged.
    target=Path(root)/'LaunchConfig.ini'
    old=target.read_bytes() if target.exists() else None
    try: return shared_install(root,'wurm',env)
    finally:
        if old is not None and (not target.exists() or target.read_bytes()!=old):
            private_write(target,old.decode('utf-8'))


def configure(root,env):
    argv,old,updated,secrets=plan(root,env)
    if updated!=old: private_write(Path(root)/'LaunchConfig.ini',updated.decode('utf-8'))
    environment=dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD'): environment.pop(key,None)
    environment.update(HOME=str(root),DISPLAY=':99',LD_LIBRARY_PATH=':'.join(str(Path(root)/p) for p in ('.voltra/wurm/lib','nativelibs','.steam/sdk64')))
    return argv,environment,secrets


def main():
    if sys.argv[1:]: raise ValueError('Unexpected runtime arguments')
    root=Path.cwd();env=dict(os.environ)
    plan(root,env,False)
    if env.get('VOLTRA_STEAM_AUTO_UPDATE','0')=='1': install(root,env)
    argv,environment,secrets=configure(root,env)
    display=subprocess.Popen(['/usr/bin/Xvfb',':99','-screen','0','1024x768x16','-nolisten','tcp'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    try:
        for _ in range(100):
            if display.poll() is not None: raise RuntimeError('Private Wurm display exited')
            if Path('/tmp/.X11-unix/X99').exists(): break
            time.sleep(.05)
        else: raise RuntimeError('Private Wurm display unavailable')
        return run(root,argv,environment,'shutdown',secrets,ready_marker=b'Wurm Server launcher finished at')
    finally:
        display.terminate();display.wait(timeout=5)

if __name__=='__main__': sys.exit(main())
