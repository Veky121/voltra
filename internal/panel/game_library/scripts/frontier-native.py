#!/usr/bin/env python3
"""MIT. Typed original VEIN, Evrima and Soulmask dedicated recipes."""
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import sys

def helper(name):
    path=Path(__file__).with_name(name+'.py')
    if not path.exists():path=path.with_name(name.replace('-','_')+'.py')
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules.setdefault(name.replace('-','_'),module);spec.loader.exec_module(module);return module

steam=helper('steam-template');native=helper('native-config');retention=helper('melee-native')
confined=retention.confined;text=retention.text;integer=retention.integer
GAMES={'vein':(2131400,'Vein/Binaries/Linux/VeinServer-Linux-Test'),'evrima':(412680,'TheIsle/Binaries/Linux/TheIsleServer-Linux-Shipping'),'soulmask':(3017300,'WS/Binaries/Linux/WSServer-Linux-Shipping')}

def boolean(env,key,default):
    raw=env.get(key,default)
    if raw not in ('0','1','true','false','True','False'):raise ValueError('Invalid boolean '+key)
    return raw.lower() in ('1','true')

def read(root,name):
    path=confined(root,root/name)
    if not path.exists():return ''
    if not path.is_file() or path.stat().st_size>8*1024**2:raise ValueError('Native configuration must be a bounded regular file')
    return path.read_text(encoding='utf-8-sig')

def ports(env,keys):
    raw=env.get('VOLTRA_ALLOCATED_PORTS','')
    if not re.fullmatch('[0-9]+(?:,[0-9]+)*',raw):raise ValueError('Missing assigned native ports')
    available={int(p) for p in raw.split(',')};result={'primary':integer(env,'SERVER_PORT',7777)}
    for key,default in keys:result[key]=integer(env,key,default)
    if len(set(result.values()))!=len(result) or any(p not in available for p in result.values()):raise ValueError('Active native service roles require distinct assigned ports')
    return result

def seeds(root):
    return json.loads(read(root,'.voltra/frontier-seeds.json') or '{}')

def unique_object(pairs):
    value={}
    for key,item in pairs:
        if key in value:raise ValueError('Duplicate native JSON setting')
        value[key]=item
    return value

def plan(root,game,env):
    """Validate every managed setting and config before producing any writes."""
    if game == 'soulmask':
        env = dict(env)
        # Preserve the original API name and accept Wings' uppercase runtime key.
        if 'region' in env and 'REGION' in env and env['region'] != env['REGION']:
            raise ValueError('Conflicting original and Wings variable region')
        if 'REGION' in env:env['region'] = env['REGION']
    root=Path(root).resolve();app,binary=GAMES[game]
    if env.get('SRCDS_APPID',str(app))!=str(app):raise ValueError('Wrong original dedicated application')
    if game=='evrima' and env.get('SRCDS_BETAID','evrima')!='evrima':raise ValueError('This exact recipe requires the original Evrima branch')
    binary=confined(root,root/binary);writes={};secrets=[]
    if game=='vein':
        p=ports(env,[('QUERY_PORT',27015)]);public='True' if boolean(env,'PUBLIC_SERVER','True') else 'False'
        values={'/Script/Engine.GameSession':{'MaxPlayers':str(integer(env,'MAX_PLAYERS',16,1,10000))},'/Script/Vein.VeinGameSession':{'bShouldAdvertise':public,'bPublic':public,'ServerName':text(env,'SERVER_NAME','Vein Server',64),'BindAddr':'0.0.0.0','Password':text(env,'SERVER_PASSWORD','',32)},'OnlineSubsystemSteam':{'GameServerQueryPort':str(p['QUERY_PORT'])}}
        path='Vein/Saved/Config/LinuxServer/Game.ini';writes[path]=native.patch_ini(read(root,path),values).encode()
        argv=[str(binary),'-Port='+str(p['primary']),'-QueryPort='+str(p['QUERY_PORT']),'-log'];secrets=[env.get('SERVER_PASSWORD','')]
    elif game=='evrima':
        rcon=boolean(env,'RCON','false');queue=boolean(env,'ENABLE_QUEUE','true');roles=[]
        if rcon:roles.append(('RCON_PORT',44000))
        if queue:roles.append(('QUEUE_PORT',44000))
        p=ports(env,roles);count=integer(env,'PLAYER_COUNT',100,1,10000)
        session={'ServerName':text(env,'SERVER_NAME','A Pterodactyl server',70),'MaxPlayerCount':str(count),'MaxPlayers':str(count),'RconPort':str(integer(env,'RCON_PORT',44000)),'QueuePort':str(integer(env,'QUEUE_PORT',44000)),'RconPassword':text(env,'RCON_PASSWORD'),'ServerPassword':text(env,'SERVER_PASSWORD','No password',20),'discord':text(env,'DISCORD','norden',20)}
        for key,name,default in [('bRconEnabled','RCON','false'),('bQueueEnabled','ENABLE_QUEUE','true'),('bEnableHumans','HUMANS','false'),('bServerPassword','SERVER_PASSWORD_ENABLED','false'),('bAllowReplay','ALLOW_REPLAY','false'),('bServerDynamicWeather','DYNAMIC_WEATHER','true')]:session[key]='true' if boolean(env,name,default) else 'false'
        path='TheIsle/Saved/Config/LinuxServer/Game.ini';previous=read(root,path)
        # Preserve operator map/admin/species lists; seed only a new file.
        if not previous:
            admin=text(env,'ADMINSTEAMID','',32)
            if admin and not re.fullmatch('[0-9]{17}',admin):raise ValueError('Original host admin must be a real SteamID64')
            previous='[/Script/TheIsle.TIGameSession]\nMapName=Gateway\n\n[/Script/TheIsle.TIGameStateBase]\n'+('AdminsSteamIDs='+admin+'\n' if admin else '')
        writes[path]=native.patch_ini(previous,{'/Script/TheIsle.TIGameSession':session,'/Script/Engine.GameSession':{'MaxPlayers':str(count)}}).encode()
        engine='TheIsle/Saved/Config/LinuxServer/Engine.ini';content=read(root,engine)
        if not content:content=seeds(root).get('evrima_engine','')
        credentials={}
        section=''
        for line in content.splitlines():
            if line.strip().startswith('['):section=line.strip().strip('[]')
            elif section.lower()=='epiconlineservices' and '=' in line:
                key,value=line.split('=',1)
                if key.strip() in ('DedicatedServerClientId','DedicatedServerClientSecret'):credentials[key.strip()]=value.strip()
        if not all(credentials.get(key) for key in ('DedicatedServerClientId','DedicatedServerClientSecret')):raise ValueError('Evrima requires legitimate publisher/operator EOS configuration; no identity is fabricated')
        if content!=read(root,engine):writes[engine]=content.encode()
        secrets=[session['RconPassword'],session['ServerPassword'],credentials['DedicatedServerClientSecret']]
        # Original source's shared EOS config is retained on disk only. Existing
        # operator identity takes precedence; no hardcoded credential argv.
        argv=[str(binary),'-Port='+str(p['primary'])]
    else:
        mode=env.get('CLUSTER_MODE','legacy')
        if mode not in ('legacy','standalone','main','client'):raise ValueError('Invalid explicit Soulmask cluster mode')
        keys=[('QUERY_PORT',27015),('ECHO_PORT',18888)]
        if mode in ('legacy','main'):keys.append(('CLUSTER_MAIN_PORT',2000))
        p=ports(env,keys);cluster=integer(env,'CLUSTER_MAIN_PORT',2000);host=text(env,'CLUSTER_MAIN_IP','127.0.0.1',255)
        if mode in ('legacy','client'):
            try:ipaddress.IPv4Address(host)
            except ValueError:raise ValueError('Cluster address must be an explicit IPv4 address') from None
        mapname=env.get('MAP','Level01_Main')
        if mapname not in ('Level01_Main','DLC_Level01_Main'):raise ValueError('Choose an original supported Soulmask map')
        mods=text(env,'MOD_ID','',4096)
        if mods and not re.fullmatch('[0-9]+(?:,[0-9]+)*',mods):raise ValueError('Mods must be comma-separated numeric IDs')
        argv=[str(binary),'WS',mapname,'-log','-server','-UTF8Output','-serverid='+str(integer(env,'SERVER_ID',1,0,2**31-1))]
        if mode in ('legacy','main'):argv+=['-mainserverport='+str(cluster)]
        if mode in ('legacy','client'):argv+=['-clientserverconnect='+host+':'+str(cluster)]
        name=text(env,'SERVER_NAME','Soulmask Server',85);admin=text(env,'ADMIN_PASSWORD','',32);password=text(env,'SERVER_PASSWORD','',32)
        argv+=['-SteamServerName='+name,'-saving='+str(integer(env,'SAVE_TIME',600,0,2**31-1)),'-Port='+str(p['primary']),'-QueryPort='+str(p['QUERY_PORT']),'-EchoPort='+str(p['ECHO_PORT']),'-forcepassthrough','-adminpsw='+admin,'-PSW='+password,'-MaxPlayers='+str(integer(env,'MAX_PLAYERS',60,1,70)),'-gamedistindex='+str(integer(env,'region',0,0,9)),'-backup='+str(integer(env,'BACKUP_TIME',960,0,2**31-1)),'-MULTIHOME=0.0.0.0','-mod='+mods]
        path='WS/Saved/GameplaySettings/GameXishu.json';previous=read(root,path);value=json.loads(previous,object_pairs_hook=unique_object) if previous else {}
        if not isinstance(value,dict):raise ValueError('Soulmask gameplay settings must be an object')
        enabled=1 if boolean(env,'ENABLE_CROSS_SERVER','0') else 0
        for key in ('0','1','2'):
            if key not in value:value[key]={}
            if not isinstance(value[key],dict):raise ValueError('Soulmask native gameplay mode must be an object')
            value[key]['KaiQiKuaFu']=enabled
        writes[path]=(json.dumps(value,indent=2)+'\n').encode();secrets=[password,admin]
    return argv,tuple(secrets),writes

def configure(root,game,env):
    root=Path(root).resolve();argv,secrets,writes=plan(root,game,env)
    for path,data in writes.items():
        confined(root,root/path);steam._publish(root,path,lambda output,data=data:output.write(data),0o600)
    return argv,secrets

def install(root,game,env,validate=True):
    root=Path(root).resolve();app,binary=GAMES[game];options=dict(env)
    if game=='evrima':options.setdefault('SRCDS_BETAID','evrima')
    # Private Steam, branch, port, settings and every config are preflighted
    # before acquisition or publication; public EOS seed comes from exact egg.
    steam.arguments(root,app,options,platform='linux',force_platform=True)
    plan(root,game,options)
    with retention.preserve(root):
        result=steam.update(root,app,options,validate=validate,required=(binary,),platform='linux',force_platform=True)
        if game=='vein':
            sdk=confined(root,root/'.steam/sdk64/steamclient.so')
            if not sdk.is_file():raise ValueError('Publisher requires the Steam64 SDK beside the VEIN native binary')
            steam._publish(root,'Vein/Binaries/Linux/steamclient.so',lambda output:output.write(sdk.read_bytes()),0o644)
        if game=='soulmask':
            # Keep both original acquisitions auditable; SDK1007 must not
            # replace the canonical game receipt used by later inspections.
            main=read(root,'.voltra/steam-template-release.json').encode()
            if not main:raise ValueError('Steam helper omitted the native game receipt')
            try:
                steam.update(root,1007,options,validate=validate,platform='linux',force_platform=True)
                sdk=read(root,'.voltra/steam-template-release.json').encode()
                if not sdk:raise ValueError('Steam helper omitted the SDK receipt')
                for name,data in [('game',main),('sdk',sdk)]:steam._publish(root,'.voltra/frontier-receipts/'+name+'.json',lambda output,data=data:output.write(data),0o600)
            finally:
                steam._publish(root,'.voltra/steam-template-release.json',lambda output:output.write(main),0o600)
    configure(root,game,options)
    path=confined(root,root/binary)
    if path.is_file():path.chmod(path.stat().st_mode|0o100)
    return result

def run(root,game,env):
    if env.get('VOLTRA_STEAM_AUTO_UPDATE','0')=='1':install(root,game,env,validate=env.get('VALIDATE','0')=='1')
    argv,secrets=configure(root,game,env);child=dict(env)
    for key in ('PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH','LD_PRELOAD','SERVER_PASSWORD','ADMIN_PASSWORD','RCON_PASSWORD','STEAM_PASS','STEAM_AUTH'):child.pop(key,None)
    child['HOME']=str(root);child['LD_LIBRARY_PATH']=str(root/'.steam/sdk64')
    return helper('native-console').run(root,argv,child,'\x03',secrets,terminal_input=True,stop_signal=signal.SIGINT)

if __name__=='__main__':
    try:
        mode,game=sys.argv[1:3];root=Path.cwd();env=dict(os.environ)
        if mode=='install':install(root,game,env)
        elif mode=='run':sys.exit(run(root,game,env))
        else:raise ValueError('Expected install or run')
    except Exception as error:
        message=str(error)
        for key in ('SERVER_PASSWORD','ADMIN_PASSWORD','RCON_PASSWORD','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS'):
            if os.environ.get(key):message=message.replace(os.environ[key],'[redacted]')
        print('Frontier server failed: '+message,file=sys.stderr);sys.exit(1)
