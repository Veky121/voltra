#!/usr/bin/env python3
"""MIT. Literal Unreal argv and complete original INI controls."""
import json
import os
from pathlib import Path
import re
import sys
from unreal_survival_install import metadata, confined, install
from native_config import patch_ini
from steam_template import _publish
from native_console import run
from steam_template import Redactor
import stat
import configparser
import threading


def text(value):
    if not isinstance(value,str) or len(value.encode())>4096 or any(ord(c)<32 or ord(c)==127 for c in value):
        raise ValueError('Invalid native text setting')
    return value


def front_argument(key,value):
    # UE FParse must see an explicit empty value, not the following option.
    if key in ('ServerTags','ServerAdminAccounts','ServerPassword') and value=='':value='\"\"'
    return '-'+key+'='+value


def configure(root, game, environment):
    root=Path(root).resolve();info=metadata()[game]
    env={**info['defaults'], **environment}
    ports=[int(env['SERVER_PORT'])]+[int(env[name]) for name in info['ports']]
    allocated={int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS','').split(',') if p}
    if len(set(ports))!=len(ports) or any(not 1<=p<=65535 or p not in allocated for p in ports):
        raise ValueError('Choose distinct allocated native service ports')
    for key in info['defaults']:text(env[key])
    for key, value in info['types'].items():
        if value=='boolean' and env[key] not in ('0','1','true','false'):raise ValueError('Invalid native boolean '+key)
        if value=='number' and not re.fullmatch(r'-?\d+(?:\.\d+)?',env[key]):raise ValueError('Invalid native number '+key)
    if game=='front' and not re.fullmatch(r'[A-Za-z0-9_-]{1,20}',env['CFG_NAME']):
        raise ValueError('Config name must be a single save-directory name')
    windows=game=='abiotic' or game=='front' and env.get('WINDOWS_INSTALL')=='1'
    candidates=[name for name in info['binaries'] if name.endswith('.exe')==windows and confined(root,name).is_file()]
    if len(candidates)!=1:raise ValueError('Expected exactly one supported native server layout')
    binary=confined(root,candidates[0]);argv=[str(binary)]
    if game=='humanitz':
        modern=candidates[0].startswith('HumanitZServer/')
        target='HumanitZServer/GameServerSettings.ini' if modern else 'TSSGame/GameServerSettings.ini'
        sections={}
        for section, entries in info['ini'].items():
            sections[section]={key:env[name] for key,name in entries.items()}
        if modern:
            reference=confined(root,'HumanitZServer/REF_GameServerSettings.ini')
            if reference.exists():
                if not reference.is_file() or reference.stat().st_size>8*1024*1024:raise ValueError('Publisher reference INI exceeds its limit')
                current=configparser.ConfigParser(interpolation=None,strict=False);current.optionxform=str
                current.read_string(reference.read_text(encoding='utf-8-sig'))
                if current.has_option('Host Settings','NoDeathFeedback'):
                    # Current publisher moved this control; retain its legacy key too.
                    sections.setdefault('Host Settings',{})['NoDeathFeedback']=env['NO_DEATH_FEEDBACK']
        path=confined(root,target)
        if path.exists() and path.stat().st_size>8*1024*1024:raise ValueError('Native INI exceeds 8 MiB')
        previous=path.read_text(encoding='utf-8-sig') if path.exists() else ''
        updated=patch_ini(previous,sections).encode()
        _publish(root,target,lambda output:output.write(updated),0o600)
        path.chmod(0o600)
        argv+=['HumanitZServer' if modern else 'TSSGame','-log','-stdout','-FullStdOutLogOutput',
               '-port='+env['SERVER_PORT'],'-queryport='+env['QUERY_PORT'],'-steamservername='+env['SERVER_NAME']]
    elif game=='abiotic':
        from enshrouded_proton import location
        argv=[str(location(root)),'run',str(binary),'-log','-stdout','-FullStdOutLogOutput','-useperfthreads','-NoAsyncLoadingThread',
              '-MaxServerPlayers='+env['NUM_PLAYERS'],'-PORT='+env['SERVER_PORT'],'-QueryPort='+env['QUERY_PORT'],
              '-ServerPassword='+env['SERVER_PASSWORD'],'-SteamServerName='+env['SERVER_NAME']]
    else:
        argv+=['ProjectWar_Start?DedicatedServer','-server','-game','-log','-stdout','-FullStdOutLogOutput']
        argv += [front_argument(key,env[name]) for key,name in info['args'].items() if key!='ServerPassword']
        argv += ['-OutIPAddress='+env.get('SERVER_IP','0.0.0.0'),'-UserDir='+str(root/'TheFrontManager'/env['CFG_NAME'])+'/']
        argv += info['fixed_args']
        # The exact imported recipe requires its managed password to be last.
        argv += [front_argument('ServerPassword',env['SRV_PW'])]
        if sum(arg.startswith('-ServerPassword=') for arg in argv)!=1:
            raise ValueError('Expected exactly one managed Front password argument')
        if windows:
            from enshrouded_proton import location
            argv=[str(location(root)),'run',*argv]
    child=dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH'):child.pop(key,None)
    child['HOME']=str(root);child['LD_LIBRARY_PATH']=str(root/'.steam/sdk64')
    if windows:
        child['STEAM_COMPAT_CLIENT_INSTALL_PATH']=str(confined(root,'.steam/steam'))
        child['STEAM_COMPAT_DATA_PATH']=str(confined(root,'.steam/steam/steamapps/compatdata/'+str(info['app'])))
        for key in ('STEAM_COMPAT_CLIENT_INSTALL_PATH','STEAM_COMPAT_DATA_PATH'):Path(child[key]).mkdir(parents=True,exist_ok=True)
    credentials=[env.get(key,'') for key in ('SERVER_PASSWORD','PASSWORD','ADMIN_PASS','SRV_PW','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    return argv,child,credentials,info['ready'].encode()


class AbioticLog:
    """Forward only fresh publisher log bytes, with anchored no-symlink reads."""
    def __init__(self, root, path, credentials):
        self.root=Path(root).resolve();self.relative=Path(path).relative_to(self.root)
        if not self.relative.parts or any(p in ('.','..') for p in self.relative.parts):raise ValueError('Invalid Abiotic log path')
        self.credentials=credentials;self.done=threading.Event();self.error=None
        self.previous=self.identity();self.previous_prefix=self.prefix();self.thread=threading.Thread(target=self.follow,daemon=True)
    def opened(self):
        descriptor=os.open(self.root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            for part in self.relative.parts[:-1]:
                following=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=descriptor);os.close(descriptor);descriptor=following
            result=os.open(self.relative.parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=descriptor)
            if not stat.S_ISREG(os.fstat(result).st_mode):os.close(result);raise ValueError('Abiotic log must be a regular file')
            return result
        finally:os.close(descriptor)
    def identity(self):
        try:
            descriptor=self.opened()
            try:
                s=os.fstat(descriptor);return (s.st_dev,s.st_ino,s.st_mtime_ns,s.st_size)
            finally:os.close(descriptor)
        except FileNotFoundError:return None
    def prefix(self):
        try:
            descriptor=self.opened()
            try:return os.pread(descriptor,256,0)
            finally:os.close(descriptor)
        except FileNotFoundError:return b''
    def follow(self):
        redactor=Redactor(self.credentials)
        position=self.previous[3] if self.previous else 0;inode=self.previous[:2] if self.previous else None;fresh=False;prefix=self.previous_prefix
        try:
            while True:
                closing=self.done.is_set()
                try:
                    descriptor=self.opened()
                    try:
                        s=os.fstat(descriptor);identity=(s.st_dev,s.st_ino,s.st_mtime_ns,s.st_size)
                        if identity!=self.previous:fresh=True
                        if fresh:
                            if inode!=(s.st_dev,s.st_ino)or s.st_size<position or os.pread(descriptor,len(prefix),0)!=prefix:position=0
                            prefix=os.pread(descriptor,256,0)
                            inode=(s.st_dev,s.st_ino);os.lseek(descriptor,position,os.SEEK_SET)
                            remaining=262144
                            while remaining>0:
                                block=os.read(descriptor,min(65536,remaining))
                                if not block:break
                                position+=len(block);remaining-=len(block);sys.stdout.buffer.write(redactor.feed(block));sys.stdout.buffer.flush()
                    finally:os.close(descriptor)
                except FileNotFoundError:pass
                if closing:break
                self.done.wait(.05)
            sys.stdout.buffer.write(redactor.feed(b'',final=True));sys.stdout.buffer.flush()
        except (OSError,ValueError) as error:self.error=error
    def start(self):self.thread.start()
    def finish(self):
        self.done.set();self.thread.join(timeout=5)
        if self.thread.is_alive()or self.error:raise ValueError('Abiotic native log forwarding failed')


def main():
    game=sys.argv[1];root=Path.cwd();env=dict(os.environ)
    if env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','0'))=='1':install(root,game,env)
    argv,child,secrets,ready=configure(root,game,env)
    if game=='abiotic':
        # Preserve the original Win64 working directory and publisher file log.
        log=AbioticLog(root,root/'AbioticFactor/Saved/Logs/AbioticFactor.log',secrets)
        log.start()
        try:return run(Path(argv[2]).parent,argv,child,'\x03',credentials=secrets,ready_marker=ready,terminal_input=True)
        finally:log.finish()
    # A PTY retains ISIG. ETX raises actual SIGINT in the native foreground
    # session; the printable characters ^C would only be ignored stdin.
    return run(root,argv,child,'\x03',credentials=secrets,ready_marker=ready,terminal_input=True)


if __name__=='__main__':sys.exit(main())
