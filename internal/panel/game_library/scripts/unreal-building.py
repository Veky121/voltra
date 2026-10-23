#!/usr/bin/env python3
"""MIT. Dedicated Brickadia/Longvinter/Frozen Flame source setup."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import urllib.request
from steam_template import update, _publish
from native_config import patch_ini
from native_console import run


def metadata():
    return json.loads(Path(__file__).with_name('unreal_building_release.json' if '_' in Path(__file__).name else 'unreal-building-release.json').read_text())


def confined(root,name):
    target=root/name
    if target.is_symlink() or not target.resolve().is_relative_to(root):raise ValueError('Native path leaves the server volume')
    return target


def publish(root,name,content,mode=0o600):
    confined(root,name);_publish(root,name,lambda output:output.write(content),mode)


def default_config(release):
    with urllib.request.urlopen(release['url'],timeout=60) as response:
        if not response.geturl().startswith('https://'):raise ValueError('Publisher config redirected outside HTTPS')
        content=response.read(65537)
    if len(content)>65536 or hashlib.sha256(content).hexdigest()!=release['sha256']:raise ValueError('Publisher default configuration integrity failed')
    content.decode('utf-8');return content


def install(root,game,environment):
    root=Path(root).resolve();info=metadata()[game];env={**info['defaults'],**environment}
    # Frozen Flame originally lets a blank app ID disable automatic updates.
    # Explicit installation still knows the reviewed dedicated application.
    if env.get('SRCDS_APPID') not in ('',str(info['app'])):raise ValueError('Unexpected original application ID')
    protected={}
    with tempfile.TemporaryDirectory(prefix='.building-retain-',dir=root) as temporary:
        for pattern in info['preserve']:
            for directory in root.glob(pattern):
                confined(root,directory.relative_to(root))
                for target in directory.rglob('*') if directory.is_dir() else [directory]:
                    confined(root,target.relative_to(root))
                    if target.is_file():
                        name=str(target.relative_to(root))
                        if name not in protected:
                            backup=Path(temporary)/str(len(protected));shutil.copyfile(target,backup);protected[name]=(backup,target.stat())
        try:
            result=update(root,info['app'],env=env,platform='linux',force_platform=True,required=() if game=='longvinter' else (info['binary'],))
            if game=='longvinter':
                target=confined(root,'longvinter-linux-server');target.mkdir(exist_ok=True)
                result=update(target,info['server_app'],env=env,platform='linux',force_platform=True,required=('Longvinter/Binaries/Linux/LongvinterServer-Linux-Shipping',))
            binary=confined(root,info['binary'])
            if not binary.is_file():raise ValueError('Publisher install is missing its native executable')
            binary.chmod(binary.stat().st_mode|0o100)
            if game=='frozen':
                name='FrozenFlame/Saved/Config/LinuxServer/Game.ini'
                if not confined(root,name).exists():publish(root,name,default_config(info['default_config']))
            if game=='brickadia':confined(root,'.config').mkdir(exist_ok=True)
            return result
        finally:
            for name,(backup,old) in protected.items():
                def restore(output,backup=backup):
                    with backup.open('rb') as source:shutil.copyfileobj(source,output)
                confined(root,name);_publish(root,name,restore,old.st_mode&0o777)
                if os.geteuid()==0:os.chown(root/name,old.st_uid,old.st_gid)
                (root/name).chmod(old.st_mode&0o777)


def configure(root,game,environment):
    root=Path(root).resolve();info=metadata()[game];env={**info['defaults'],**{k:v for k,v in environment.items() if k in info['defaults']}}
    for value in env.values():
        if not isinstance(value,str) or len(value.encode())>8192 or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid native setting')
    ports=[int(environment['SERVER_PORT'])]+[int(env[key]) for key in info['ports']]
    allocated={int(value) for value in environment.get('VOLTRA_ALLOCATED_PORTS','').split(',') if value}
    if len(ports)!=len(set(ports)) or any(not 1<=value<=65535 or value not in allocated for value in ports):raise ValueError('Choose distinct allocated native ports')
    if 'MAX_PLAYERS' in env and (not env['MAX_PLAYERS'].isdigit() or int(env['MAX_PLAYERS'])<1):raise ValueError('Player count must be a positive integer')
    sections={}
    if game=='brickadia':
        if not env['SERVER_HOSTING_TOKEN']:raise ValueError('Brickadia requires an operator-owned hosting token')
        if any(c in env['WORLD_NAME'] for c in ('/','\\')) or env['WORLD_NAME'] in ('.','..'):raise ValueError('World must be a name inside the native Worlds folder')
        if env['SERVER_LIST_PUBLIC'] not in ('True','False'):raise ValueError('Invalid public-listing flag')
        sections={'Server__BP_ServerSettings_General_C BP_ServerSettings_General_C':{'ServerName':env['SERVER_NAME'],'ServerPassword':env['SERVER_PASSWORD'],'bPubliclyListed':env['SERVER_LIST_PUBLIC']}}
        argv=['-server','-log','-world='+env['WORLD_NAME'],'-port='+str(ports[0]),'-token='+env['SERVER_HOSTING_TOKEN']]
    elif game=='longvinter':
        if env['ENABLE_PVP'] not in ('true','false') or env['ENABLE_TENTDECAY'] not in ('true','false'):raise ValueError('Invalid native gameplay boolean')
        if not env['MAX_TENTS'].isdigit() or int(env['MAX_TENTS'])<1:raise ValueError('Tent count must be a positive integer')
        if env['SERVER_PASSWORD'] and not env['SERVER_PASSWORD'].isalnum():raise ValueError('Longvinter password requires letters and numbers')
        if any(not re.fullmatch(r'[a-z0-9]{32}',value) for value in env['ADMIN_ID'].split()):raise ValueError('Each administrator must be one original EOS account ID')
        sections={section:{key:env[name] for key,name in entries.items()} for section,entries in info['ini'].items()}
        argv=['Longvinter','-Port='+str(ports[0]),'-QueryPort='+env['QUERY_PORT']]
    else:
        sections={'/Script/Engine.GameSession':{'MaxPlayers':env['MAX_PLAYERS']},'/Script/FrozenFlame.FGameSession':{'ServerPassword':json.dumps(env['SERVER_PASSWORD'],ensure_ascii=False)}}
        argv=['-log','-MetaGameServerName='+env['SERVER_NAME'],'-port='+str(ports[0]),'-queryPort='+env['QUERY_PORT'],'-RconPort='+env['RCON_PORT'],'-RconPassword='+env['RCON_PASSWORD']]
    target=confined(root,info['config'])
    if target.exists() and target.stat().st_size>8*1024*1024:raise ValueError('Native INI exceeds8MiB')
    previous=target.read_text(encoding='utf-8-sig') if target.exists() else ''
    publish(root,info['config'],patch_ini(previous,sections).encode());target.chmod(0o600)
    binary=confined(root,info['binary'])
    if not binary.is_file():raise ValueError('Reinstall to restore the dedicated executable')
    binary.chmod(binary.stat().st_mode|0o100)
    child=dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH','LD_PRELOAD'):child.pop(key,None)
    child['HOME']=str(root);child['XDG_CONFIG_HOME']=str(confined(root,'.config'))
    child['LD_LIBRARY_PATH']=str(root/'.steam/sdk64')+':'+str(root/'longvinter-linux-server/.steam/sdk64')
    credentials=[env.get(key,environment.get(key,'')) for key in ('SERVER_PASSWORD','SERVER_HOSTING_TOKEN','RCON_PASSWORD','STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    return [str(binary),*argv,'-stdout','-FullStdOutLogOutput'],child,credentials,info['ready'].encode()


def main():
    action,game=sys.argv[1:3];root=Path.cwd();env=dict(os.environ)
    if action=='install':install(root,game,env);return 0
    defaults=metadata()[game]['defaults']
    automatic=env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE',defaults.get('AUTO_UPDATE','0')))
    if automatic=='1' and (game!='frozen' or env.get('SRCDS_APPID',defaults['SRCDS_APPID'])):install(root,game,env)
    argv,child,secrets,ready=configure(root,game,env)
    return run(root,argv,child,'exit' if game=='brickadia' else '\x03',credentials=secrets,ready_marker=ready,terminal_input=True)


if __name__=='__main__':sys.exit(main())
