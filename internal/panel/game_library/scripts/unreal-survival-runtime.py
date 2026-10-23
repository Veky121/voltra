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


def text(value):
    if not isinstance(value,str) or len(value.encode())>4096 or any(ord(c)<32 or ord(c)==127 for c in value):
        raise ValueError('Invalid native text setting')
    return value


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
        argv += ['-'+key+'='+env[name] for key,name in info['args'].items()]
        argv += ['-OutIPAddress='+env.get('SERVER_IP','0.0.0.0'),'-UserDir='+str(root/'TheFrontManager'/env['CFG_NAME'])+'/']
        argv += info['fixed_args']
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


def main():
    game=sys.argv[1];root=Path.cwd();env=dict(os.environ)
    if env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','0'))=='1':install(root,game,env)
    argv,child,secrets,ready=configure(root,game,env)
    # A PTY retains ISIG. ETX raises actual SIGINT in the native foreground
    # session; the printable characters ^C would only be ignored stdin.
    return run(root,argv,child,'\x03',credentials=secrets,ready_marker=ready,terminal_input=True)


if __name__=='__main__':sys.exit(main())
