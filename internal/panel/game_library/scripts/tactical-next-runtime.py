#!/usr/bin/env python3
"""MIT. Literal original tactical launch controls and explicit prerequisites."""
import os
from pathlib import Path
import re
import shutil
import signal
import secrets
from native_console import run
from native_config import patch_ini
from steam_template import _publish, _publication_parent, _publication_leaf
from tactical_runtime import flat_config, text, integer
from tactical_next_install import GAMES, selection, native_binary, confined, install


GROUND_MAPLIST = b'[/script/rbzookeeper.zkmaplist]\nMapList=/Game/GroundBranch/Maps/SmallTown/SmallTown?Mission=/Game/GroundBranch/Mission/SmallTown/SmallTown_IntelRetrieval\n'


def default_ground_maplist(root):
    """Publish the verified initial mission only when no operator file exists."""
    relative='GroundBranch/ServerConfig/MapList.ini'
    with _publication_parent(root,relative,create=True)as(parent,name,volume):
        if _publication_leaf(parent,name)is not None:return False
        temporary='.voltra-maplist-'+secrets.token_hex(16)
        descriptor=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
        identity=os.fstat(descriptor)
        try:
            with os.fdopen(os.dup(descriptor),'wb')as output:
                output.write(GROUND_MAPLIST);output.flush()
            if os.geteuid()==0:os.fchown(descriptor,volume.st_uid,volume.st_gid)
            os.fchmod(descriptor,0o640);os.fsync(descriptor)
            with _publication_parent(root,relative)as(current,leaf,_):
                if current is None or (os.fstat(current).st_dev,os.fstat(current).st_ino)!=(os.fstat(parent).st_dev,os.fstat(parent).st_ino):
                    raise ValueError('Ground Branch map list parent changed')
                candidate=os.stat(temporary,dir_fd=parent,follow_symlinks=False)
                if(candidate.st_dev,candidate.st_ino)!=(identity.st_dev,identity.st_ino):
                    raise ValueError('Ground Branch map list temporary changed')
                try:
                    # A hard-link publication is atomic and cannot replace a
                    # custom map list created concurrently by the operator.
                    os.link(temporary,leaf,src_dir_fd=parent,dst_dir_fd=current,follow_symlinks=False)
                except FileExistsError:
                    if _publication_leaf(current,leaf)is None:raise ValueError('Ground Branch map list changed during creation')
                    return False
                os.fsync(current)
            return True
        finally:
            try:
                candidate=os.stat(temporary,dir_fd=parent,follow_symlinks=False)
                if(candidate.st_dev,candidate.st_ino)==(identity.st_dev,identity.st_ino):os.unlink(temporary,dir_fd=parent)
            except FileNotFoundError:pass
            finally:os.close(descriptor)


def ports(env, keys):
    allocated={int(p)for p in env.get('VOLTRA_ALLOCATED_PORTS','').split(',')if p}
    main=integer(env,'SERVER_PORT',7777,1025,65535);used={main};result={'SERVER_PORT':main};pending=[]
    if main not in allocated:raise ValueError('Game port requires an allocation')
    for key in keys:
        raw=env.get(key,'')
        if raw=='':pending.append(key);continue
        if not re.fullmatch(r'[1-9][0-9]{0,4}',raw)or not 1025<=int(raw)<=65535 or int(raw)not in allocated or int(raw)in used:raise ValueError('Native service requires a distinct allocated nonzero port: '+key)
        result[key]=int(raw);used.add(int(raw))
    for key in pending:
        port=next((p for p in sorted(allocated)if p not in used and 1025<=p<=65535),None)
        if port is None:raise ValueError('Allocate every native service role')
        result[key]=port;used.add(port)
    return result


def configure(root,env):
    root=Path(root).resolve();kind,info=selection(env);binary=native_binary(root,info)
    selected=ports(env,['QUERY_PORT','AUTH_PORT']if kind=='aapg'else['QUERY_PORT'])
    name=text(env.get('SERVER_NAME','Dedicated server'),100 if kind=='aapg' else 60 if kind=='battalion' else 255)
    argv=[str(binary)];secrets=[env.get(key,'')for key in('ADMIN_PW','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    child=dict(os.environ)
    for key in('PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH'):child.pop(key,None)
    child['HOME']=str(root);child['LD_LIBRARY_PATH']=str(root/'.steam/sdk64')
    if kind=='aapg':
        # AAPG reparses argv as an Unreal command line. Preserve the original
        # egg's literal value quotes so its parser retains spaces in the name.
        # These are engine syntax inside one operand, never shell escaping.
        argv+=['-port='+str(selected['SERVER_PORT']),'-SAP='+str(selected['AUTH_PORT']),'-SQP='+str(selected['QUERY_PORT']),'-servername="'+name+'"']
        ready=b'Finished loading level'
    elif kind=='battalion':
        password=text(env.get('ADMIN_PW','changeme'),20)
        argv+=['Battalion','-Port='+str(selected['SERVER_PORT']),'-QueryPort='+str(selected['QUERY_PORT']),'-SteamServerName='+name,'-Queue=Wartide','-AdminPassword='+password,'-Log']
        ready=b' OnCreateSessionComplete '
    else:
        # Preserve stock Wine semantics and original variables; never assume a
        # Linux payload, install Proton or fabricate a functioning Wine prefix.
        if env.get('WINEARCH','win64')!='win64':raise ValueError('Original Ground Branch requires a win64 Wine prefix')
        debug=text(env.get('WINEDEBUG','-all'),256)
        if not re.fullmatch(r'[A-Za-z0-9_+,-]*',debug):raise ValueError('Invalid Wine debug channels')
        wine=shutil.which('wine')
        if not wine:raise ValueError('Ground Branch requires the selected Wine runtime image; wine is missing')
        if not os.environ.get('DISPLAY'):raise ValueError('Ground Branch Wine image must provide its headless display before launch')
        prefix=confined(root,'.wine');library=env.get('WINEPATH',str(root))
        if library!=str(root):raise ValueError('Original Ground Branch WINEPATH must match the server volume')
        maximum=integer(env,'MAX_PLAYERS',16,1,2147483647)
        default_ground_maplist(root)
        target=confined(root,'GroundBranch/ServerConfig/Server.ini');previous=target.read_bytes()if target.exists()else b''
        if len(previous)>8*1024**2:raise ValueError('Ground Branch Server.ini exceeds limit')
        updated=patch_ini(previous.decode('utf-8-sig'),{'/Script/RBZooKeeper.ZKServer':{'ServerName':name,'MaxPlayers':str(maximum)}}).encode()
        if updated!=previous:
            if previous:_publish(root,'.voltra/tactical-next/server-ini-backup-'+str(__import__('time').time_ns()),lambda output:output.write(previous),0o600)
            metadata=target.stat()if target.exists()else None
            _publish(root,'GroundBranch/ServerConfig/Server.ini',lambda output:output.write(updated),metadata.st_mode&0o777 if metadata else 0o600)
            if metadata and os.geteuid()==0:os.chown(target,metadata.st_uid,metadata.st_gid)
        flat_config(root,'GroundBranch/Config/DefaultModding.ini',{'ModPath':'../steamapps/workshop/content/16900/'})
        child.update(WINEARCH='win64',WINEDEBUG=debug,WINEPATH=library,WINEPREFIX=str(prefix))
        argv=[wine,str(binary),'MultiHome=0.0.0.0','Port='+str(selected['SERVER_PORT']),'QueryPort='+str(selected['QUERY_PORT']),'-log']
        ready=b'Bringing up level for play took'
    return argv,child,secrets,ready


def main(root,env):
    kind,info=selection(env);automatic=env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','0'))
    if automatic not in('0','1'):raise ValueError('Auto update must be0or1')
    validate=env.get('VALIDATE','')
    if validate not in('','true','1'):raise ValueError('Repair validation must be empty,trueor1')
    if automatic=='1':install(root,env,validate=validate in('true','1'))
    argv,child,secrets,ready=configure(root,env)
    if kind=='groundbranch':
        # Wine's -log writes the publisher log instead of the inherited PTY.
        # Observe only this generation's active log, not rotated backups.
        from native_log import NativeLogRelay
        relay=NativeLogRelay(root,relative_directory='GroundBranch/Saved/Logs',prefix='GroundBranch.log',suffix='.log',credentials=secrets)
        relay.start()
        try:return run(root,argv,child,'\x03',credentials=secrets,ready_marker=ready,terminal_input=True,stop_signal=signal.SIGINT)
        finally:relay.finish()
    return run(root,argv,child,'\x03',credentials=secrets,ready_marker=ready,terminal_input=True,stop_signal=signal.SIGINT)


if __name__=='__main__':raise SystemExit(main(Path.cwd(),dict(os.environ)))
