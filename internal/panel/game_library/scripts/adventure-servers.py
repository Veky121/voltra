#!/usr/bin/env python3
"""MIT. Typed original Risk2 and TerraTech Worlds dedicated adapters."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import tempfile
import threading
import time


def helper(name):
    path=Path(__file__).with_name(name+'.py')
    if not path.exists():path=path.with_name(name.replace('-','_')+'.py')
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules[name.replace('-','_')]=module;spec.loader.exec_module(module);return module


shared=helper('steam-native-next');engineering=helper('engineering-servers')
steam,native,release=shared.steam,shared.native,shared.release
PINS=json.loads(Path(__file__).with_name('adventure-servers-pins.json').read_text())


def commands(content):
    """Split native CVar commands, preserving quoted semicolons and comments."""
    start=0;quoted=False;escaped=False;comment=False
    for index,char in enumerate(content):
        if comment:
            if char=='\n':yield content[start:index+1];start=index+1;comment=False
            continue
        if escaped:escaped=False;continue
        if char=='\\'and quoted:escaped=True;continue
        if char=='"':quoted=not quoted;continue
        if not quoted and content[index:index+2]=='//':comment=True;continue
        if not quoted and char in ';\n':yield content[start:index+1];start=index+1
    if quoted:raise ValueError('Unterminated native command quote')
    if start<len(content):yield content[start:]


def patch_risk(content,values):
    result=[];seen=set()
    for segment in commands(content):
        stripped=segment.strip();match=re.match(r'^([A-Za-z_][A-Za-z0-9_]*)\b',stripped)
        if not match:result.append(segment);continue
        key=match[1]
        if key in values:
            if key not in seen:result.append(key+' '+values[key]+';\n');seen.add(key)
        elif key in('host','remove_all_local_users')and stripped.rstrip(';').strip()==key:continue
        elif key=='exec'and re.fullmatch(r'exec\s+"?server(?:\.cfg)?"?\s*;?',stripped):continue
        else:result.append(segment)
    if result and not result[-1].endswith('\n'):result[-1]+='\n'
    result.extend(key+' '+value+';\n'for key,value in values.items()if key not in seen)
    return''.join(result)


def configure(root,game,env):
    root=Path(root).resolve();pin=PINS[game]
    if game=='risk':
        port_mode=engineering.choice(env,'PORT_MODE','allocated',('allocated','original'))
        if port_mode=='allocated':
            allocated=shared.roles(env,[],offsets=(1,2));ports={'primary':allocated['primary'],'QUERY':allocated['1'],'STEAM':allocated['2']}
        else:
            ports=shared.roles(env,['QUERY','STEAM'])
            if ports['STEAM']!=ports['QUERY']+1:raise ValueError('Original Steam port must equal query+1')
        password=shared.text(env,'PASSWORD','',40);hostname=shared.text(env,'HOSTNAME','"Risk of Rain 2 Dedicated Server"',40)
        values={'sv_password':json.dumps(password,ensure_ascii=False),'steam_server_heartbeat_enabled':engineering.choice(env,'ADVERTISE','1',('0','1')),
                'sv_hostname':json.dumps(hostname,ensure_ascii=False),'sv_port':str(ports['primary']),'steam_server_query_port':str(ports['QUERY']),'steam_server_steam_port':str(ports['STEAM']),'sv_maxplayers':str(shared.integer(env,'PLAYERS',4,1,2147483647))}
        target=shared.confined(root,root/'Risk of Rain 2_Data/Config/server.cfg');startup=shared.confined(root,root/'Risk of Rain 2_Data/Config/server_startup.cfg')
        if not startup.is_file():raise ValueError('Original publisher startup config required; no fake host bootstrap invented')
        previous=target.read_text(encoding='utf-8-sig')if target.exists()else startup.read_text(encoding='utf-8-sig')
        updated=patch_risk(previous,values);shared.write_config(root,target,updated)
        pregame=shared.confined(root,root/'Risk of Rain 2_Data/Config/server_pregame.cfg')
        if not pregame.exists():shared.write_config(root,pregame,'')
        receipt=shared.confined(root,root/'.voltra/adventure/risk-ports.json')
        native.private_write(receipt,json.dumps({'port_mode':port_mode,'applied_ports':ports,'original_query_fields_applied':port_mode=='original'})+'\n')
        return ['xvfb-run','-a','wine',str(root/pin['binary'])],[password],None
    if game=='terra':
        ports=shared.roles(env,[]);password=shared.text(env,'SERVER_PASSWORD','',128)
        target=shared.confined(root,root/'dedicated_server_config.json');data=shared.json_unique(target.read_text(encoding='utf-8-sig'))if target.exists()else{}
        if not isinstance(data,dict):raise ValueError('Native TerraTech config must be an object')
        data.update(Port=ports['primary'],Password=password,SlotCount=shared.integer(env,'MAX_PLAYERS',6,1,6))
        shared.write_config(root,target,json.dumps(data,ensure_ascii=False,indent=2)+'\n')
        return[str(helper('enshrouded-proton').location(root)),'run',str(root/pin['binary']),'-log'],[password],shared.confined(root,root/'TT2/Saved/Logs/TT2.log')
    raise ValueError('Swords source blocked: actual publisher native schema required')


def sdk(root,game):
    state=shared.confined(root,root/'.voltra/adventure/sdk');state.mkdir(parents=True,exist_ok=True)
    receipt=shared.confined(root,state/'receipt.json');old=json.loads(receipt.read_text()).get('files',{})if receipt.exists()else{}
    prefix=''if game=='risk'else'TT2/Binaries/Win64/'
    with tempfile.TemporaryDirectory(prefix='sdk-',dir=state)as folder:
        stage=Path(folder);steam.update(stage,1007,{'WINDOWS_INSTALL':'1'},required=(),platform='windows');payloads={}
        for name in('steamclient64.dll','tier0_s64.dll','vstdlib_s64.dll'):
            found=[p for p in stage.rglob('*')if p.is_file()and p.name.lower()==name]
            if len(found)!=1:raise ValueError('Missing/ambiguous original Windows SDK library')
            source=shared.confined(stage,found[0]);engineering.binary(source,machine=0x8664);target=prefix+name;shared.confined(root,root/target);payloads[target]=source.read_bytes()
        backups={};applied=[];owned={}
        try:
            for name,data in payloads.items():
                target=root/name
                if target.exists()and release.sha256(target)!=old.get(name):continue
                backup=stage/'rollback'/name
                if target.exists():backup.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target,backup);backups[name]=backup
                else:backups[name]=None
                steam._publish(root,name,lambda out,value=data:out.write(value));applied.append(name);owned[name]=hashlib.sha256(data).hexdigest()
            native.private_write(receipt,json.dumps({'app':1007,'files':owned})+'\n')
        except BaseException:
            for name in reversed(applied):
                backup=backups[name]
                if backup is None:(root/name).unlink()
                else:
                    with backup.open('rb')as inp:steam._publish(root,name,lambda out:shutil.copyfileobj(inp,out))
            raise


def identity(game,env):
    if game not in('risk','terra'):raise ValueError('Swords source blocked pending actual publisher schema')
    if env.get('SRCDS_APPID',str(PINS[game]['appid']))!=str(PINS[game]['appid'])or env.get('WINDOWS_INSTALL','1')!='1':raise ValueError('Wrong original application/platform')
    if env.get('WINEARCH','win64')!='win64':raise ValueError('Actual original Win64 executable requires win64; win32 choice cannot run this binary')


def operator_files(root,game):
    pin=PINS[game];content=shared.confined(root,root/pin['content'])
    if not content.is_dir()or not any(content.iterdir()):raise ValueError('Missing original licensed game content')
    names=[pin['binary']]
    if game in('risk','terra'):
        prefix=''if game=='risk'else'TT2/Binaries/Win64/'
        names +=[prefix+name for name in('steamclient64.dll','tier0_s64.dll','vstdlib_s64.dll')]
    if game=='terra':names+=['.steam/sdk64/steamclient.so']
    hashes={}
    for name in names:
        path=shared.confined(root,root/name)
        if not path.is_file():raise ValueError('Missing supplied original executable/SDK')
        engineering.binary(path,linux=name.endswith('.so'),machine=None if name.endswith('.so')else 0x8664)
        hashes[name]={'sha256':release.sha256(path),'bytes':path.stat().st_size}
    native.private_write(shared.confined(root,root/'.voltra/adventure/operator-files.json'),json.dumps({'game':game,'files':hashes,'publisher_authenticity_verified':False,'runtime_verified':False})+'\n')


def install(root,game,env):
    root=Path(root).resolve();identity(game,env);mode=engineering.choice(env,'INSTALL_MODE','steam',('steam','operator_files'))
    if mode=='steam':steam.arguments(root,PINS[game]['appid'],env,platform='windows')
    else:operator_files(root,game)
    with shared.preserve(root):
        if mode=='steam':
            steam.update(root,PINS[game]['appid'],env,required=(PINS[game]['binary'],),platform='windows')
            if game in('risk','terra'):sdk(root,game)
        for arch in('32','64'):
            source=shared.confined(root,root/('.voltra/steamcmd/linux'+arch+'/steamclient.so'));target='.steam/sdk'+arch+'/steamclient.so';shared.confined(root,root/target)
            if source.is_file()and not(root/target).exists():
                with source.open('rb')as inp:steam._publish(root,target,lambda out:shutil.copyfileobj(inp,out))
        if game=='terra':
            target=shared.confined(root,root/'steam_appid.txt')
            if target.exists()and target.read_text().strip()!='2313330':raise ValueError('Conflicting operator Steam app identity retained for review')
            if not target.exists():shared.write_config(root,target,'2313330\n')
            helper('enshrouded-proton').provision(root)


def run(root,game,env):
    root=Path(root).resolve();identity(game,env);auto=engineering.choice(env,'VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','1'),('0','1'));mode=engineering.choice(env,'INSTALL_MODE','steam',('steam','operator_files'))
    if auto=='1':install(root,game,env)
    elif mode=='operator_files':operator_files(root,game)
    if game!='terra':environment=helper('private-wine-prerequisites').prepare(root,env,PINS[game]['tricks'],engineering.PINS,(PINS[game]['tricks'],))
    else:
        environment=dict(os.environ);environment.update(HOME=str(root),LD_LIBRARY_PATH=str(root/'.voltra/proton/lib')+':'+str(root/'.steam/sdk64'))
        for key,path in{'STEAM_COMPAT_CLIENT_INSTALL_PATH':root/'.steam/steam','STEAM_COMPAT_DATA_PATH':root/'.steam/steam/steamapps/compatdata/2533070'}.items():
            shared.confined(root,path);path.mkdir(parents=True,exist_ok=True);environment[key]=str(path)
    for key in('STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS','PYTHONHOME','PYTHONPATH','LD_PRELOAD'):environment.pop(key,None)
    if game!='terra':environment.pop('LD_LIBRARY_PATH',None)
    argv,credentials,log=configure(root,game,env);credentials +=[env.get(k,'')for k in('STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    finished=threading.Event();thread=None
    if log:
        if log.exists():
            history=shared.confined(root,root/'.voltra/adventure/log-history');history.mkdir(parents=True,exist_ok=True);log.rename(history/(str(time.time_ns())+'.log'))
        log.parent.mkdir(parents=True,exist_ok=True)
        thread=threading.Thread(target=helper('space-survival').follow_log,args=(log,finished,credentials),daemon=True);thread.start()
    try:
        code=helper('native-console').run(root,argv,environment,'',credentials,stop_signal=signal.SIGINT)
        return code if code>=0 else 128-code
    finally:
        finished.set()
        if thread:thread.join(timeout=2)


if __name__=='__main__':
    try:
        action,game=sys.argv[1:3]
        if game not in('risk','terra'):raise ValueError('Unknown recipe')
        if action=='install':install(Path.cwd(),game,dict(os.environ))
        elif action=='run':sys.exit(run(Path.cwd(),game,dict(os.environ)))
        else:raise ValueError('Unknown action')
    except Exception:
        print('Adventure server setup failed: review actual publisher config schema, original typed values/ports, licensed files and private runtime prerequisites. Unsupported private Steam credentials are never silently replaced.',file=sys.stderr);sys.exit(1)


