#!/usr/bin/env python3
"""MIT. Original native crafting config, Wine/.NET prerequisites and public log."""
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
from native_config import patch_ini
from native_console import run
from steam_template import _publish, _publication_parent, _publication_leaf
from tactical_runtime import integer,text
from crafting_install import selection,confined,install


def publish_config(root,name,previous,updated):
    if previous==updated:return
    target=confined(root,name)
    if previous:_publish(root,'.voltra/crafting/config-backups/'+str(time.time_ns()),lambda output:output.write(previous),0o600)
    metadata=target.stat()if target.exists()else None
    _publish(root,name,lambda output:output.write(updated),metadata.st_mode&0o777 if metadata else 0o600)
    if metadata and os.geteuid()==0:os.chown(target,metadata.st_uid,metadata.st_gid)


def read_config(root,name,required=False):
    target=confined(root,name)
    if required and not target.is_file():raise ValueError('Publisher configuration is missing: '+name)
    if target.exists()and target.stat().st_size>8*1024**2:raise ValueError('Native configuration exceeds limit')
    return target.read_bytes()if target.exists()else b''


def romestead_document(env,previous=b''):
    world=text(env.get('WORLD_NAME','Pterodactyl Server'),64);password=text(env.get('PASSWORD',''),64)
    if not world:raise ValueError('World name must not be blank')
    size=integer(env,'WORLD_SIZE',1,1,10);players=integer(env,'MAX_PLAYERS',8,1,8)
    cheats=env.get('CHEATS','false').lower()
    if cheats not in('0','1','true','false','yes','no','on','off'):raise ValueError('Invalid original cheats flag')
    seed=text(env.get('AUTO_CREATE_WORLD_SEED',''),128)
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise ValueError('Duplicate native JSON configuration key')
            result[key]=value
        return result
    data=json.loads(previous.decode('utf-8-sig'),object_pairs_hook=unique)if previous else{}
    if not isinstance(data,dict):raise ValueError('Expected Romestead native config object')
    data.update(AutoStartWorldName=world,AutoCreateWorldSize=size,Password=password,Port=integer(env,'SERVER_PORT',8050,1025,65535),MaxPlayers=players)
    for key,value in{'AutoCreateAndLoadWorld':True,'AutoCreateWorldSeed':seed or None,'EnableCheats':cheats in('1','true','yes','on'),'SleepThresholdMs':10}.items():data.setdefault(key,value)
    return(json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode()


def craftopia_document(root,previous,name,port):
    content=previous.decode('utf-8-sig');section=None;paths=[]
    for line in content.splitlines():
        header=re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:[;#].*)?',line.strip())
        if header:section=header.group(1)
        elif section=='Save'and not line.lstrip().startswith((';','#'))and '='in line:
            key,value=line.split('=',1)
            if key.strip()=='savePath':paths.append(value.strip())
    if len(paths)>1:raise ValueError('Duplicate Craftopia savePath is ambiguous')
    managed={'GameWorld':{'name':name},'Host':{'port':str(port)}}
    if not paths or paths[0]=='DedicatedServerSave/':
        # Current publisher concatenates ServerFolderPath + relative savePath
        # without a separator. Its supported absolute-path branch avoids that
        # bug while retaining the original intended, volume-owned directory.
        target=confined(root,'DedicatedServerSave')
        if target.exists()and not target.is_dir():raise ValueError('Craftopia default save path must be a directory')
        managed['Save']={'savePath':str(target)+'/'}
    return patch_ini(content,managed).encode()


def configure(root,env):
    root=Path(root).resolve();kind,app,platform,binary,preserve=selection(env);native=confined(root,binary)
    if not native.is_file():raise ValueError('Original dedicated server binary is missing')
    main=integer(env,'SERVER_PORT',8050,1025,65535);allocated={int(p)for p in env.get('VOLTRA_ALLOCATED_PORTS','').split(',')if p}
    if main not in allocated:raise ValueError('Gameplay port must be allocated')
    child=dict(os.environ)
    for key in('PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH'):child.pop(key,None)
    child['HOME']=str(root);child['LD_LIBRARY_PATH']=str(root)+':'+str(root/'linux64')+':'+str(root/'.steam/sdk64')
    secrets=[env.get(key,'')for key in('PASSWORD','SERVER_PASSWORD','STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    if kind=='craftopia':
        previous=read_config(root,'ServerSetting.ini',required=True)
        name=text(env.get('WORLD_NAME','Pterodactyl Server'),50)
        updated=craftopia_document(root,previous,name,main)
        argv=[str(native)];ready=b'World is loaded!';stop='\x03';target='ServerSetting.ini'
    elif kind=='cubic':
        game_port=integer(env,'GAME_PORT',20000,1025,65535)
        if game_port!=main:raise ValueError('Original GAME_PORT must match the selected primary gameplay allocation')
        mode=env.get('GAMEMODE','adventure');private=env.get('PRIVATE_SERVER','FALSE');seed=env.get('GALAXY_SEED','21945875634')
        if mode not in('adventure','creative')or private not in('TRUE','FALSE')or not re.fullmatch(r'[0-9]{1,11}',seed):raise ValueError('Invalid original game mode, privacy or numeric galaxy seed')
        maximum=integer(env,'MAX_PLAYERS',20,1,2147483647);name=text(env.get('SERVER_NAME','Cubic Odyssey Server'));password=text(env.get('SERVER_PASSWORD',''))
        if any(c in name for c in'"\\'):raise ValueError('Cubic native quoted server name cannot contain quotes or backslashes')
        wine=shutil.which('wine')
        if not wine:raise ValueError('Original Cubic Odyssey profile requires its Wine runtime image')
        if not os.environ.get('DISPLAY'):raise ValueError('Cubic Odyssey Wine runtime requires a headless display')
        prefix=confined(root,'.wine');previous=read_config(root,'config/server_config.txt',required=True);content=previous.decode('utf-8-sig')
        for key,value in{'serverName':'"'+name+'"','privateServer':private,'galaxySeed':seed}.items():
            pattern=re.compile(r'^(\s*)'+key+r'\s+[^\r\n]*',re.M)
            if len(pattern.findall(content))!=1:raise ValueError('Original Cubic publisher configuration must contain exactly one '+key)
            content=pattern.sub(lambda match:match[1]+key+' '+value,content)
        updated=content.encode();target='config/server_config.txt';child.update(WINEARCH='win64',WINEPREFIX=str(prefix))
        argv=[wine,str(native),'-Port='+str(main),'-Password='+password,'-Gamemode='+mode,'-MaxNumPlayers='+str(maximum)]
        ready=b'Lobbies (OnCreateLobbyFinished): lobby created.';stop='\x03'
    else:
        dotnet=shutil.which('dotnet')
        if not dotnet:raise ValueError('Original Romestead profile requires the .NET8 runtime image')
        try:installed=subprocess.run([dotnet,'--list-runtimes'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10,check=False)
        except (OSError,subprocess.TimeoutExpired):raise ValueError('Unable to inspect required .NET8 runtime')from None
        if installed.returncode or not re.search(rb'^Microsoft\.NETCore\.App 8\.',installed.stdout,re.M):raise ValueError('Required Microsoft.NETCore.App8 runtime is missing')
        previous=read_config(root,'config.json')
        # Original CHEATS and hidden seed were installer-only controls. Retain
        # operator changes after first creation, including reinstall/update.
        updated=romestead_document(env,previous);target='config.json'
        for path in('.local/share','.config','logs'):confined(root,path)
        with _publication_parent(root,'logs/latest.log')as(parent,leaf,volume):
            if parent is not None:_publication_leaf(parent,leaf)
        child.update(XDG_DATA_HOME=str(root/'.local/share'),XDG_CONFIG_HOME=str(root/'.config'))
        argv=[dotnet,str(native)];ready=b'Server ready';stop='stop'
    publish_config(root,target,previous,updated)
    if kind=='romestead':
        for path in('.local/share','.config','logs'):confined(root,path).mkdir(parents=True,exist_ok=True)
    return argv,child,secrets,ready,stop


class PublicTee:
    """Only receives already-redacted native_console public bytes."""
    def __init__(self,output,log):self.output,self.log=output,log;self.buffer=self
    def write(self,data):
        if isinstance(data,str):data=data.encode()
        data=data.replace(b'\r',b'\n');self.output.buffer.write(data);self.log.write(data);return len(data)
    def flush(self):self.output.flush();self.log.flush()


def main(root,env):
    root=Path(root).resolve();kind,*_=selection(env);automatic=env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','0'))
    if automatic not in('0','1'):raise ValueError('Automatic updates must be0or1')
    if automatic=='1':install(root,env,validate=False)
    argv,child,secrets,ready,stop=configure(root,env)
    if kind=='craftopia':
        from native_log import NativeLogRelay
        relay=NativeLogRelay(root,relative_directory='.config/unity3d/PocketPair/Craftopia/Logs_DS',prefix='PlayerLog_',suffix='.log',credentials=secrets)
        relay.start()
        try:return run(root,argv,child,stop,credentials=secrets,ready_marker=ready,terminal_input=True,stop_signal=signal.SIGINT)
        finally:relay.finish()
    if kind!='romestead':return run(root,argv,child,stop,credentials=secrets,ready_marker=ready,terminal_input=True,stop_signal=signal.SIGINT)
    output=sys.stdout
    # Anchor open to secure directory descriptors; never follow a log symlink.
    with _publication_parent(root,'logs/latest.log',create=True)as(parent,name,volume):
        _publication_leaf(parent,name);descriptor=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600,dir_fd=parent)
        with os.fdopen(descriptor,'wb')as log:
            try:
                sys.stdout=PublicTee(output,log)
                # Romestead emits carriage-return progress without newlines.
                # Opt into bounded raw reads before its original public CR
                # normalization; no private raw bytes are written to the log.
                return run(root,argv,child,stop,credentials=secrets,ready_marker=ready,terminal_input=False,output_observer=lambda data:None)
            finally:sys.stdout=output


if __name__=='__main__':raise SystemExit(main(Path.cwd(),dict(os.environ)))
