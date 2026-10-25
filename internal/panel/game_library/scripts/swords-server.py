#!/usr/bin/env python3
"""MIT. Swords dedicated native ENV adapter, grounded in publisher Steam docs."""
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import threading
import time


def helper(name):
    path=Path(__file__).with_name(name+'.py')
    if not path.exists():path=path.with_name(name.replace('-','_')+'.py')
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules[name.replace('-','_')]=module;spec.loader.exec_module(module);return module


shared=helper('steam-native-next');engineering=helper('engineering-servers')
steam,native,release=shared.steam,shared.native,shared.release
BINARY='SNM2020/Binaries/Win64/SNMASServer-Win64-Shipping.exe'
TEMPLATE='SNM2020/Content/Docs/Dedicated-Server-Game.ini'
CONFIG='SNM2020/Saved/Config/WindowsServer/Game.ini'
NATIVE_ENV=('SNM_NAME','SNM_OWNER_STEAM_ID','SNM_PASSWORD','SNM_MAX_PLAYERS','SNM_DAYS_UNTIL_RESET','SNM_RESET_TIME_OF_DAY')


def identity(env):
    if env.get('SRCDS_APPID','2058450')!='2058450'or env.get('WINDOWS_INSTALL','1')!='1':raise ValueError('Wrong original dedicated application/platform')
    if env.get('WINEARCH','win64')!='win64':raise ValueError('Original Win64 executable cannot run in a win32 prefix')


def typed_environment(env):
    values={key:shared.text(env,key,default,limit)for key,default,limit in[
        ('SNM_NAME','',64),('SNM_OWNER_STEAM_ID','',20),('SNM_PASSWORD','',32),
        ('SNM_MAX_PLAYERS','16',16),('SNM_DAYS_UNTIL_RESET','1',20),('SNM_RESET_TIME_OF_DAY','00:00',20)]}
    words=values['SNM_NAME'].split()
    if values['SNM_NAME']and(not 2<=len(words)<=5 or len({word.casefold()for word in words})!=len(words)):raise ValueError('Publisher name requires2-5 unique words; dynamic allowed-word membership is checked by the game')
    if not re.fullmatch('[0-9]{17}',values['SNM_OWNER_STEAM_ID']):raise ValueError('Original owner requires SteamID64')
    shared.integer(values,'SNM_MAX_PLAYERS',16,1,2147483647)
    shared.integer(values,'SNM_DAYS_UNTIL_RESET',1,0,2147483647)
    if not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]',values['SNM_RESET_TIME_OF_DAY']):raise ValueError('Reset time must be24hour HH:MM')
    return values


def ports(env):
    mode=engineering.choice(env,'PORT_MODE','allocated',('allocated','original'))
    roles=shared.roles({**env,**({'QUERY_PORT':''}if mode=='allocated'else{})},['QUERY_PORT'])
    return mode,roles


def operator_files(root):
    content=shared.confined(root,root/'SNM2020/Content/Paks')
    if not content.is_dir()or not any(p.is_file()for p in content.iterdir()):raise ValueError('Missing legitimate original game content')
    hashes={}
    for name in(BINARY,'SNM2020/Binaries/Win64/steam_api64.dll','SNM2020/Binaries/Win64/steamclient64.dll',TEMPLATE):
        path=shared.confined(root,root/name)
        if not path.is_file():raise ValueError('Missing original supplied server/SDK/template file')
        if name!=TEMPLATE:engineering.binary(path,machine=0x8664)
        hashes[name]={'sha256':release.sha256(path),'bytes':path.stat().st_size}
    native.private_write(shared.confined(root,root/'.voltra/swords/operator-files.json'),json.dumps({'files':hashes,'publisher_authenticity_verified':False,'runtime_verified':False})+'\n')


def install(root,env):
    root=Path(root).resolve();identity(env);mode=engineering.choice(env,'INSTALL_MODE','steam',('steam','operator_files'))
    if mode=='steam':steam.arguments(root,2058450,env,platform='windows')
    else:operator_files(root)
    with shared.preserve(root):
        if mode=='steam':steam.update(root,2058450,env,required=(BINARY,TEMPLATE),platform='windows')
        for arch in('32','64'):
            source=shared.confined(root,root/('.voltra/steamcmd/linux'+arch+'/steamclient.so'));target='.steam/sdk'+arch+'/steamclient.so';shared.confined(root,root/target)
            if source.is_file()and not(root/target).exists():
                with source.open('rb')as inp:steam._publish(root,target,lambda out:shutil.copyfileobj(inp,out))
        target=shared.confined(root,root/CONFIG);source=shared.confined(root,root/TEMPLATE)
        if not target.exists():
            if not source.is_file():raise ValueError('Actual installed publisher template required')
            # Copy, never move/delete/reset publisher template or existing Game.ini.
            with source.open('rb')as inp:steam._publish(root,CONFIG,lambda out:shutil.copyfileobj(inp,out),default_mode=0o600)


def launch(root,env):
    root=Path(root).resolve();identity(env);values=typed_environment(env);mode,roles=ports(env)
    binary=shared.confined(root,root/BINARY)
    if not binary.is_file():raise ValueError('Missing original server executable')
    engineering.binary(binary,machine=0x8664)
    argv=['wine',str(binary),'-port='+str(roles['primary']),'-QueryPort='+str(roles['QUERY_PORT']),'-log']
    return argv,values,{'port_mode':mode,'applied_ports':roles,'original_query_field_applied':mode=='original'},shared.confined(root,root/'SNM2020/Saved/Logs')


def publisher_logs(root,folder,finished,credentials,before,follow):
    readers=[];seen=set(before)
    try:
        while not finished.is_set():
            for path in sorted(folder.glob('SnMDedSrv-*.log')):
                if path.name in seen:continue
                shared.confined(root,path)
                if not path.is_file():continue
                seen.add(path.name)
                if len(readers)>=4:continue  # Publisher normally creates one per boot.
                thread=threading.Thread(target=follow,args=(path,finished,credentials),daemon=True);thread.start();readers.append(thread)
            finished.wait(.1)
    finally:
        for thread in readers:thread.join(timeout=1)


def run(root,env):
    root=Path(root).resolve();identity(env)
    # Validate all original controls/assigned roles before game/runtime updates.
    typed_environment(env);ports(env)
    auto=engineering.choice(env,'VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','1'),('0','1'));mode=engineering.choice(env,'INSTALL_MODE','steam',('steam','operator_files'))
    if auto=='1':install(root,env)
    elif mode=='operator_files':operator_files(root)
    argv,values,port_receipt,logs=launch(root,env)
    environment=helper('private-wine-prerequisites').prepare(root,env,'vcrun2019',engineering.PINS,('vcrun2019',))
    # Publisher README explicitly documents these native names and precedence.
    environment.update(values);environment['QUERY_PORT']=str(port_receipt['applied_ports']['QUERY_PORT'])
    for key in('STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS','PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH'):environment.pop(key,None)
    native.private_write(shared.confined(root,root/'.voltra/swords/runtime-source.json'),json.dumps({'native_environment_names':list(NATIVE_ENV),'native_environment_precedence':'Publisher ENV overrides Game.ini','game_ini_modified_at_launch':False,**port_receipt})+'\n')
    credentials=[values['SNM_PASSWORD']]+[env.get(k,'')for k in('STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    log=shared.confined(root,logs/'SNM2020.log');logs.mkdir(parents=True,exist_ok=True);before={p.name for p in logs.glob('SnMDedSrv-*.log')}
    if log.exists():
        history=shared.confined(root,root/'.voltra/swords/log-history');history.mkdir(parents=True,exist_ok=True);log.rename(history/(str(time.time_ns())+'.log'))
    follow=helper('space-survival').follow_log;finished=threading.Event()
    threads=[threading.Thread(target=follow,args=(log,finished,credentials),daemon=True),threading.Thread(target=publisher_logs,args=(root,logs,finished,credentials,before,follow),daemon=True)]
    for thread in threads:thread.start()
    try:
        code=helper('native-console').run(root,argv,environment,'',credentials,stop_signal=signal.SIGINT)
        return code if code>=0 else 128-code
    finally:
        finished.set()
        for thread in threads:thread.join(timeout=5)


if __name__=='__main__':
    try:
        if sys.argv[1]=='install':install(Path.cwd(),dict(os.environ))
        elif sys.argv[1]=='run':sys.exit(run(Path.cwd(),dict(os.environ)))
        else:raise ValueError('Unknown action')
    except Exception:
        print('Swords setup failed: review original typed native settings, distinct assigned ports, legitimate original files and private Wine/runtime-license prerequisites.',file=sys.stderr);sys.exit(1)
