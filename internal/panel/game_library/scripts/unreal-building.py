#!/usr/bin/env python3
"""MIT. Dedicated Brickadia/Longvinter/Frozen Flame source setup."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import secrets
import sys
import tempfile
import urllib.request
from steam_template import update, _publish, _publication_parent, _publication_leaf
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


def longvinter_config_snapshot(root,name):
    with _publication_parent(root,name) as (parent,leaf,volume):
        if parent is None:raise ValueError('Longvinter configuration parent is missing')
        metadata=_publication_leaf(parent,leaf)
        if metadata is None:raise ValueError('Longvinter configuration is missing')
        descriptor=os.open(leaf,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent)
        with os.fdopen(descriptor,'rb') as source:
            actual=os.fstat(source.fileno());data=source.read(8*1024*1024+1);after=os.fstat(source.fileno())
        if len(data)>8*1024*1024:raise ValueError('Longvinter configuration exceeds8MiB')
        signature=lambda value:(value.st_dev,value.st_ino,value.st_size,value.st_mtime_ns,value.st_ctime_ns,value.st_mode,value.st_uid,value.st_gid)
        if signature(actual)!=signature(metadata) or signature(after)!=signature(actual):raise ValueError('Longvinter configuration changed during capture')
        return {'name':name,'data':data,'metadata':actual}


def longvinter_restore_config(root,snapshot):
    name=snapshot['name'];before=snapshot['metadata'];backup_name=name+'.backup'
    with _publication_parent(root,name) as (parent,leaf,volume):
        if parent is None:return 'parent-missing'
        if _publication_leaf(parent,leaf) is not None:return 'current-file-retained'
        with _publication_parent(root,backup_name) as (backup_parent,backup_leaf,_):
            if backup_parent is None:return 'backup-missing'
            backup=_publication_leaf(backup_parent,backup_leaf)
            if backup is None:return 'backup-missing'
            if (backup.st_uid,backup.st_gid)!=(before.st_uid,before.st_gid):return 'backup-owner-conflict'
            descriptor=os.open(backup_leaf,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=backup_parent)
            with os.fdopen(descriptor,'rb') as source:
                actual=os.fstat(source.fileno());data=source.read(8*1024*1024+1)
            signature=lambda value:(value.st_dev,value.st_ino,value.st_size,value.st_mtime_ns,value.st_ctime_ns,value.st_uid,value.st_gid)
            if signature(actual)!=signature(backup) or data!=snapshot['data']:return 'backup-content-conflict'
            # Publish with an exclusive hard-link operation: a concurrently
            # created operator/native file wins, even after our absence check.
            temporary='.voltra-longvinter-'+secrets.token_hex(16)
            descriptor=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
            identity=os.fstat(descriptor)
            try:
                with os.fdopen(os.dup(descriptor),'wb') as output:output.write(snapshot['data']);output.flush()
                current=os.fstat(descriptor)
                if (current.st_uid,current.st_gid)!=(before.st_uid,before.st_gid):os.fchown(descriptor,before.st_uid,before.st_gid)
                os.fchmod(descriptor,before.st_mode&0o777);os.fsync(descriptor)
                latest=_publication_leaf(backup_parent,backup_leaf)
                if latest is None or signature(latest)!=signature(backup):return 'backup-content-conflict'
                with _publication_parent(root,name) as (current_parent,current_leaf,_):
                    if current_parent is None or (os.fstat(current_parent).st_dev,os.fstat(current_parent).st_ino)!=(os.fstat(parent).st_dev,os.fstat(parent).st_ino):raise ValueError('Longvinter configuration parent changed')
                    try:os.link(temporary,current_leaf,src_dir_fd=parent,dst_dir_fd=current_parent,follow_symlinks=False)
                    except FileExistsError:return 'current-file-retained'
                    os.fsync(current_parent)
                return 'restored-matching-native-backup'
            finally:
                os.close(descriptor)
                latest=os.stat(temporary,dir_fd=parent,follow_symlinks=False)
                if (latest.st_dev,latest.st_ino)==(identity.st_dev,identity.st_ino):os.unlink(temporary,dir_fd=parent)


def native_run(root,game,argv,child,credentials,ready):
    snapshot=longvinter_config_snapshot(root,metadata()[game]['config']) if game=='longvinter' else None
    result=None
    try:
        result=run(root,argv,child,'exit' if game=='brickadia' else '\x03',credentials=credentials,ready_marker=ready,terminal_input=True)
        return result
    finally:
        if snapshot is not None:
            try:status=longvinter_restore_config(root,snapshot)
            except (OSError,ValueError) as error:
                status='restore-error';print('Longvinter configuration retention failed: '+type(error).__name__,file=sys.stderr)
            # A retention failure must never turn the actual native exit into
            # success (or replace its original nonzero/exception semantics).
            try:publish(root,'.voltra/longvinter-config-retention.json',(json.dumps({'status':status,'native_exit':result})+'\n').encode())
            except (OSError,ValueError):print('Longvinter configuration retention receipt failed',file=sys.stderr)
            print('Longvinter configuration retention: '+status,file=sys.stderr)


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
    return native_run(root,game,argv,child,secrets,ready)


if __name__=='__main__':sys.exit(main())
