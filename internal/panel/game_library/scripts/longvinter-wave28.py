#!/usr/bin/env python3
"""Longvinter seed-once adapter. Shared acquisition, console and retention remain authoritative."""
import os, re, json, sys
from pathlib import Path
from unreal_building import metadata, confined, publish, install, native_run
from native_config import patch_ini
def configure(root,environment,dry_run=False):
    game="longvinter"
    root=Path(root).resolve();info=metadata()[game];env={**info['defaults'],**{k:v for k,v in environment.items() if k in info['defaults']}}
    for value in env.values():
        if not isinstance(value,str) or len(value.encode())>8192 or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid native setting')
    ports=[int(environment['SERVER_PORT'])]+[int(env[key]) for key in info['ports']]
    allocated={int(value) for value in environment.get('VOLTRA_ALLOCATED_PORTS','').split(',') if value}
    if len(ports)!=len(set(ports)) or any(not 1<=value<=65535 or value not in allocated for value in ports):raise ValueError('Choose distinct allocated native ports')
    if 'MAX_PLAYERS' in env and (not env['MAX_PLAYERS'].isdigit() or int(env['MAX_PLAYERS'])<1):raise ValueError('Player count must be a positive integer')
    sections={}
    if game=='longvinter':
        if env['ENABLE_PVP'] not in ('true','false') or env['ENABLE_TENTDECAY'] not in ('true','false'):raise ValueError('Invalid native gameplay boolean')
        if not env['MAX_TENTS'].isdigit() or int(env['MAX_TENTS'])<1:raise ValueError('Tent count must be a positive integer')
        if env['SERVER_PASSWORD'] and not env['SERVER_PASSWORD'].isalnum():raise ValueError('Longvinter password requires letters and numbers')
        if any(not re.fullmatch(r'[a-z0-9]{32}',value) for value in env['ADMIN_ID'].split()):raise ValueError('Each administrator must be one original EOS account ID')
        sections={section:{key:env[name] for key,name in entries.items()} for section,entries in info['ini'].items()}
        argv=['Longvinter','-Port='+str(ports[0]),'-QueryPort='+env['QUERY_PORT']]
    sections['/Game/Blueprints/Server/GI_AdvancedSessions.GI_AdvancedSessions_C'].update(CoopPlay='false',CheckVPN='true',CoopSpawn='0',ChestRespawnTime='600',DisableWanderingTraders='false')
    sections['/Game/Blueprints/Server/GM_Longvinter.GM_Longvinter_C'].update(SaveBackups='false')
    target=confined(root,info['config'])
    if target.exists() and target.stat().st_size>8*1024*1024:raise ValueError('Native INI exceeds8MiB')
    previous=target.read_text(encoding='utf-8-sig') if target.exists() else ''
    binary=confined(root,info['binary'])
    if not binary.is_file():raise ValueError('Reinstall to restore the dedicated executable')
    if not dry_run:
        if not target.exists():publish(root,info['config'],patch_ini(previous,sections).encode())
        binary.chmod(binary.stat().st_mode|0o100)
    child=dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH','LD_PRELOAD'):child.pop(key,None)
    child['HOME']=str(root);child['XDG_CONFIG_HOME']=str(confined(root,'.config'))
    child['LD_LIBRARY_PATH']=str(root/'.steam/sdk64')+':'+str(root/'longvinter-linux-server/.steam/sdk64')
    credentials=[env.get(key,environment.get(key,'')) for key in ('SERVER_PASSWORD','SERVER_HOSTING_TOKEN','RCON_PASSWORD','STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    if target.exists():
        for line in target.read_text(encoding='utf-8-sig').splitlines():
            key, sep, value = line.partition('=')
            if sep and key.strip().lower() == 'password' and value.strip():credentials.append(value.strip())
    return [str(binary),*argv,'-stdout','-FullStdOutLogOutput'],child,credentials,info['ready'].encode()


def main():
    if len(sys.argv)!=2 or sys.argv[1] not in ('run','install'):raise ValueError('Choose install or run')
    action=sys.argv[1];root=Path.cwd();env=dict(os.environ)
    if action=='install':install(root,'longvinter',env);return 0
    defaults=metadata()['longvinter']['defaults']
    auto=env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE',defaults.get('AUTO_UPDATE','0')))
    if auto not in ('0','1'):raise ValueError('Invalid auto update')
    configure(root,env,dry_run=True)
    if auto == '1':install(root,'longvinter',env)
    argv,child,credentials,ready=configure(root,env)
    return native_run(root,'longvinter',argv,child,credentials,ready)
if __name__=='__main__':sys.exit(main())
