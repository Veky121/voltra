#!/usr/bin/env python3
"""MIT. Aloft/ASKA Windows and Astro Colony Linux source adapters."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from steam_template import update, _publish
from native_config import patch_ini
from native_console import run


def metadata():
    name='unreal_survival_next_release.json' if '_' in Path(__file__).name else 'unreal-survival-next-release.json'
    return json.loads(Path(__file__).with_name(name).read_text())


def path(root,name):
    value=root/name
    if value.is_symlink() or not value.resolve().is_relative_to(root):raise ValueError('Game path leaves this server volume')
    return value


def checked(env):
    for value in env.values():
        if not isinstance(value,str) or len(value.encode())>8192 or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid native setting')


def publish(root,name,content):
    path(root,name)
    _publish(root,name,lambda output:output.write(content.encode()),0o600)
    (root/name).chmod(0o600)


def wine_environment(root,env):
    child=dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH'):child.pop(key,None)
    child.update({'HOME':str(root),'LD_LIBRARY_PATH':str(root/'.steam/sdk64')})
    child['WINEPREFIX']=str(path(root,'.wine'))
    child['WINEDEBUG']=env.get('WINEDEBUG','-all')
    if 'WINEDLLOVERRIDES' in env:child['WINEDLLOVERRIDES']=env['WINEDLLOVERRIDES']
    if 'SteamAppId' in env:child['SteamAppId']=env['SteamAppId']
    return child


def install(root,game,environment):
    root=Path(root).resolve();info=metadata()[game];env={**info['defaults'],**environment}
    if env['SRCDS_APPID']!=str(info['app']):raise ValueError('Unexpected dedicated application')
    if info['platform']=='windows' and env.get('WINDOWS_INSTALL','1')!='1':raise ValueError('This recipe requires its original Windows payload')
    # Preserve publisher-owned settings without loading whole saves into RAM.
    with tempfile.TemporaryDirectory(prefix='.next-retain-',dir=root) as folder:
        saved={}
        for pattern in info['preserve']:
            for item in root.glob(pattern):
                path(root,item.relative_to(root))
                for candidate in item.rglob('*') if item.is_dir() else [item]:
                    path(root,candidate.relative_to(root))
                    if candidate.is_file():
                        name=str(candidate.relative_to(root))
                        if name in saved:continue
                        backup=Path(folder)/str(len(saved));shutil.copyfile(candidate,backup);saved[name]=(backup,candidate.stat())
        try:
            return update(root,info['app'],env=env,platform=info['platform'],force_platform=True,required=(info['binary'],))
        finally:
            for name,(backup,old) in saved.items():
                def restore(output,backup=backup):
                    with backup.open('rb') as source:shutil.copyfileobj(source,output)
                path(root,name);_publish(root,name,restore,old.st_mode&0o777)
                if os.geteuid()==0:os.chown(root/name,old.st_uid,old.st_gid)
                (root/name).chmod(old.st_mode&0o777)


def patch_properties(previous,values):
    lines=[];seen=set()
    for line in previous.splitlines(keepends=True):
        if '=' in line and not line.lstrip().startswith(('#',';')):
            key=line.split('=',1)[0].strip()
            if key in values:
                if key in seen:raise ValueError('Duplicate managed server property')
                seen.add(key);line=key+' = '+values[key]+'\n'
        lines.append(line)
    if lines and not lines[-1].endswith('\n'):lines[-1]+='\n'
    lines += [key+' = '+value+'\n' for key,value in values.items() if key not in seen]
    return ''.join(lines)


def configure(root,game,environment):
    root=Path(root).resolve();info=metadata()[game];env={**info['defaults'],**{k:v for k,v in environment.items() if k in info['defaults']}}
    checked(env);binary=path(root,info['binary'])
    for key,kind in info['types'].items():
        if kind=='boolean' and env[key] not in ('0','1'):raise ValueError('Invalid original boolean '+key)
        if kind=='number' and not re.fullmatch(r'-?\d+(?:\.\d+)?',env[key]):raise ValueError('Invalid original numeric control '+key)
    if not binary.is_file():raise ValueError('Reinstall to restore the native server executable')
    ports={int(p) for p in environment.get('VOLTRA_ALLOCATED_PORTS','').split(',') if p}
    primary=int(environment['SERVER_PORT'])
    if not 1<=primary<=65535 or primary not in ports:raise ValueError('Choose an allocated primary port')
    child=wine_environment(root,env)
    secret=[env.get(key,environment.get(key,'')) for key in ('SERVER_PASSWORD','STEAM_GSLT','STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    create=None
    if game=='astro':
        query=int(env['SERVER_QUERY_PORT'])
        if query not in ports or query==primary:raise ValueError('Choose a distinct allocated query port')
        sections={section:{key:env[name] for key,name in values.items()} for section,values in info['ini'].items()}
        name='AstroColony/Saved/Config/LinuxServer/ServerSettings.ini';target=path(root,name)
        if target.exists() and target.stat().st_size>8*1024*1024:raise ValueError('Native settings exceeds8MiB')
        previous=target.read_text(encoding='utf-8-sig') if target.exists() else ''
        publish(root,name,patch_ini(previous,sections))
        binary.chmod(binary.stat().st_mode|0o100)
        argv=[str(binary),'-log','-stdout','-FullStdOutLogOutput','-Port='+str(primary),'-QueryPort='+str(query),'-SteamServerName='+env['SERVER_NAME']]
    elif game=='aska':
        if not env['STEAM_GSLT']:raise ValueError('ASKA needs an operator-owned Steam GSLT for game1898300')
        if env['KEEP_SERVER_WORLD_ALIVE'] not in ('true','false'):raise ValueError('Invalid keep-world-alive flag')
        target=path(root,'server properties.txt')
        if target.exists() and target.stat().st_size>8*1024*1024:raise ValueError('Native properties exceeds8MiB')
        previous=target.read_text(encoding='utf-8-sig') if target.exists() else ''
        values={key:env[name] for key,name in info['properties'].items()}
        publish(root,'server properties.txt',patch_properties(previous,values))
        argv=['wine',str(binary),'-propertiesPath','server properties.txt']
    else:
        if not re.fullmatch(r'[A-Za-z0-9]{1,20}',env['SAVE_NAME']) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',env['SERVER_NAME']):raise ValueError('Aloft hash grammar requires original simple map/server names')
        if not 1<=int(env['MAX_PLAYERS'])<=8:raise ValueError('Aloft supports1..8 players')
        if any(env[key] not in ('true','false') for key in ('IS_VISIBLE','PRIVATE_ISLANDS')):raise ValueError('Invalid Aloft boolean')
        if env['CREATIVE_MODE'] not in ('0','1'):raise ValueError('Invalid creative mode')
        administrators=env['ADMIN_IDS'].split()
        if any(not re.fullmatch(r'\d{17}',item) for item in administrators):raise ValueError('Each administrator must be one SteamID64')
        save=path(root,env['SAVE_PATH']);world=path(root,str(save.relative_to(root)/('w_'+env['SAVE_NAME'])))
        prefix=['wine',str(binary),'-batchmode','-nographics','-server']
        argv=[*prefix,'-logFile','-','load#'+env['SAVE_NAME']+'#','servername#'+env['SERVER_NAME']+'#','log#ERROR#','isvisible#'+env['IS_VISIBLE']+'#','privateislands#'+env['PRIVATE_ISLANDS']+'#','playercount#'+env['MAX_PLAYERS']+'#','serverport#'+str(primary)+'#',*['admin#'+value+'#' for value in administrators]]
        if not world.is_dir():
            if env['WORLD_GENERATION_SYNTAX']=='legacy':
                if not re.fullmatch(r'\d+',env['NUM_ISLANDS']):raise ValueError('Invalid legacy island count')
                tokens=['create#'+env['SAVE_NAME']+'#'+env['NUM_ISLANDS']+'#'+env['CREATIVE_MODE']+'#']
            elif env['WORLD_GENERATION_SYNTAX']=='current':
                if env['ISLAND_PRESET'] not in ('0','1','2','normal','big','huge') or env['CORRUPTION_PRESET'] not in ('0','1','2','normal','lots','shrooms'):raise ValueError('Invalid current publisher world preset')
                tokens=['create#'+env['SAVE_NAME']+'#','islandcount#'+env['ISLAND_PRESET']+'#','corruptioncount#'+env['CORRUPTION_PRESET']+'#','creative#'+env['CREATIVE_MODE']+'#']
            else:raise ValueError('Unknown Aloft creation grammar')
            create=[*prefix,'-logFile','-',*tokens,'log#ERROR#']
    return argv,child,secret,create,info['ready'].encode()


def prerequisites(root,game,environment):
    if game!='aloft':return
    env={**metadata()[game]['defaults'],**environment};verbs=env['WINETRICKS_RUN'].split()
    if any(not re.fullmatch(r'[A-Za-z0-9_]+(?:=[A-Za-z0-9_]+)?',verb) for verb in verbs):raise ValueError('Winetricks supports literal verb names, not shell commands')
    stamp=path(root,'.voltra/aloft-winetricks.json');wanted=hashlib.sha256(env['WINETRICKS_RUN'].encode()).hexdigest()
    if stamp.is_file() and json.loads(stamp.read_text()).get('verbs_sha256')==wanted:return
    if verbs:
        result=subprocess.run(['winetricks','-q',*verbs],env=wine_environment(root,env),timeout=1800)
        if result.returncode:raise ValueError('Original Winetricks prerequisites failed; no game was started')
    publish(root,'.voltra/aloft-winetricks.json',json.dumps({'verbs_sha256':wanted})+'\n')


def main():
    root=Path.cwd();action,game=sys.argv[1:3];env=dict(os.environ)
    if action=='install':install(root,game,env);return 0
    if env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','0'))=='1':install(root,game,env)
    prerequisites(root,game,env)
    argv,child,secrets,create,ready=configure(root,game,env)
    if create:
        status=run(root,create,child,'\x03',credentials=secrets,terminal_input=True)
        if status:return status
        configured={**metadata()[game]['defaults'],**env}
        if not path(root,configured['SAVE_PATH']+'/w_'+configured['SAVE_NAME']).is_dir():raise ValueError('World creation exited without the expected save directory; loading was withheld')
    return run(root,argv,child,'\x03',credentials=secrets,ready_marker=ready,terminal_input=True)


if __name__=='__main__':sys.exit(main())
