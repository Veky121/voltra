#!/usr/bin/env python3
"""MIT. Typed licensed publisher launchers; no invented credentials or payloads."""
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import uuid
from native_console import run
from native_config import patch_ini
from steam_template import _publish
from tactical_runtime import text,integer
from publisher_install import selection,confined,install_query,extract,apply_payload,retain_operators,payload_namespace


def boolean(env,key,default='0'):
    value=env.get(key,default)
    if value not in('0','1'):raise ValueError('Native toggle must be0or1: '+key)
    return value=='1'


def preflight(env):
    kind,mode=selection(env)
    if kind=='hytale':
        if env.get('HYTALE_PATCHLINE','release')not in('release','pre-release')or env.get('HYTALE_AUTH_MODE','authenticated')not in('authenticated','offline','insecure'):raise ValueError('Choose an original Hytale patchline and auth mode')
        for key,default in[('HYTALE_ACCEPT_EARLY_PLUGINS','0'),('DISABLE_SENTRY','0'),('USE_AOT_CACHE','1'),('HYTALE_ALLOW_OP','0'),('INSTALL_SOURCEQUERY_PLUGIN','1')]:boolean(env,key,default)
    elif kind=='titans':
        token=text(env.get('AG_AUTH_TOKEN',''),1500)
        if not token or not re.fullmatch(r'[A-Za-z0-9._~+/=-]+',token)or token.startswith('-'):raise ValueError('A real entitled Alderon hosting token is required; configure it privately')
        if env.get('BETA_BRANCH','production')not in('production','demo-public-test'):raise ValueError('Choose an original publisher production or entitled public-test branch')
        try:uuid.UUID(env.get('SERVER_GUID',''))
        except(ValueError,AttributeError):raise ValueError('Provide your own valid unique server GUID')from None
        if env.get('SERVER_DB','Local')not in('Local','Remote'):raise ValueError('Choose the original Local or Remote database mode')
    else:
        key=text(env.get('API_KEY','CHANGEME'))
        if not key or key.casefold()in('changeme','change-me'):raise ValueError('A real HogWarp API key is required; configure it privately')
        if env.get('WINEARCH','win64')!='win64'or env.get('WINETRICKS_RUN','dotnet7')!='dotnet7':raise ValueError('Original HogWarp requires win64 and its dotnet7 Wine prerequisite')
    return kind,mode


def child_environment(root,env):
    child=dict(os.environ)
    for key in('PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH'):child.pop(key,None)
    child['HOME']=str(root);child['LD_LIBRARY_PATH']=str(root)+':'+str(root/'linux64')
    if env.get('AG_AUTH_TOKEN'):child['AG_AUTH_TOKEN']=env['AG_AUTH_TOKEN']
    return child


def acquire(root,env):
    kind,mode=preflight(env)
    if mode=='operator':return
    child=child_environment(root,env)
    if kind=='titans':
        cli=confined(root,'AlderonGamesCmd-Linux')
        if not cli.is_file():raise ValueError('Install the original Alderon publisher downloader first or select lawful operator files')
        argv=[str(cli),'--game','path-of-titans','--server','true','--beta-branch',env.get('BETA_BRANCH','production'),'--auth-token',env['AG_AUTH_TOKEN'],'--install-dir',str(root/'server')]
        with retain_operators(root,['server/PathOfTitans/Saved','server/PathOfTitans/Mods','server.properties']):
            status=run(root,argv,child,'\x03',credentials=[env['AG_AUTH_TOKEN']],terminal_input=True,stop_signal=signal.SIGINT)
        if status:raise RuntimeError('Entitled Alderon publisher acquisition failed; inspect private redacted console')
    elif kind=='hytale':
        cli=confined(root,'hytale-downloader/hytale-downloader-linux')
        if not cli.is_file():raise ValueError('Install the original Hytale downloader first or supply lawful launcher files')
        state=confined(root,'.voltra/publisher');state.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='hytale-game-',dir=state)as temporary:
            stage=Path(temporary);archive=stage/'game.zip';argv=[str(cli),'-patchline',env.get('HYTALE_PATCHLINE','release'),'-download-path',str(archive)]
            status=run(root,argv,child,'\x03',terminal_input=True,stop_signal=signal.SIGINT)
            if status or not archive.is_file():raise RuntimeError('Hytale licensed acquisition did not produce the server archive')
            if archive.stat().st_size>10*1024**3:raise ValueError('Hytale archive exceeds download size limit')
            ready=stage/'ready';ready.mkdir();extract(archive,ready)
            payload_namespace(ready)
            if not(ready/'Server/HytaleServer.jar').is_file()or not(ready/'Assets.zip').is_file():raise ValueError('Original Hytale publisher archive lacks Server and Assets.zip')
            receipt=confined(root,'.voltra/publisher/hytale-files.json');previous=json.loads(receipt.read_text())if receipt.exists()else{}
            with retain_operators(root,['Server/config.json','Server/permissions.json','Server/auth.enc','Server/auth.key','Server/universe','Server/mods','config.json','permissions.json','auth.enc','auth.key','universe','mods']):files,preserved=apply_payload(root,'',ready,previous)
            _publish(root,'.voltra/publisher/hytale-files.json',lambda output:output.write(json.dumps({'files':files,'preserved_operator_files':preserved,'patchline':env.get('HYTALE_PATCHLINE','release')}).encode()),0o600)


def write_config(root,name,data):
    target=confined(root,name);payload=data if isinstance(data,bytes)else(json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode()
    previous=target.read_bytes()if target.exists()else b''
    if payload!=previous:
        if previous:_publish(root,'.voltra/publisher/config-backups/'+uuid.uuid4().hex,lambda output:output.write(previous),0o600)
        _publish(root,name,lambda output:output.write(payload),0o600)


def read_json(root,name):
    path=confined(root,name)
    if not path.exists():return{}
    if path.stat().st_size>8*1024**2:raise ValueError('Publisher JSON exceeds limit')
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise ValueError('Duplicate native JSON key')
            result[key]=value
        return result
    data=json.loads(path.read_text(encoding='utf-8-sig'),object_pairs_hook=unique)
    if not isinstance(data,dict):raise ValueError('Expected native publisher JSON object')
    return data


def configure(root,env):
    root=Path(root).resolve();kind,mode=preflight(env);main=integer(env,'SERVER_PORT',5520,1025,65535)
    allocated={int(p)for p in env.get('VOLTRA_ALLOCATED_PORTS','').split(',')if p}
    if main not in allocated:raise ValueError('Game port must be allocated')
    child=child_environment(root,env);secrets=[env.get(key,'')for key in('API_KEY','AG_AUTH_TOKEN','HYTALE_SERVER_SESSION_TOKEN','HYTALE_SERVER_IDENTITY_TOKEN')]
    if kind=='hytale':
        java=shutil.which('java')
        if not java:raise ValueError('Hytale requires the pinned Java25 runtime image')
        try:version=subprocess.run([java,'-version'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=10,check=False)
        except(OSError,subprocess.TimeoutExpired):raise ValueError('Unable to inspect required Java25')from None
        if version.returncode or not re.search(rb'version\s+"25(?:[.\"])',version.stdout):raise ValueError('Hytale requires Java25')
        jar=confined(root,'Server/HytaleServer.jar');assets=confined(root,'Assets.zip');cache=confined(root,'Server/HytaleServer.aot')
        if not jar.is_file()or not assets.is_file():raise ValueError('Provide lawful licensed Server/HytaleServer.jar and Assets.zip or authenticate the original downloader')
        argv=[java,'-Xms128M'];memory=integer(env,'SERVER_MEMORY',0,0,2147483647)
        if boolean(env,'USE_AOT_CACHE','1'):
            if not cache.is_file():raise ValueError('Enabled original AOT cache is missing')
            argv+=['-XX:AOTCache='+str(cache)]
        if memory:argv+=['-Xmx'+str(memory)+'M']
        argv+=['-jar',str(jar)]
        for key,flag in[('HYTALE_ALLOW_OP','--allow-op'),('HYTALE_ACCEPT_EARLY_PLUGINS','--accept-early-plugins'),('DISABLE_SENTRY','--disable-sentry')]:
            if boolean(env,key):argv.append(flag)
        if boolean(env,'INSTALL_SOURCEQUERY_PLUGIN','1'):
            query=integer(env,'QUERY_PORT',main+1,1025,65535)if env.get('QUERY_PORT','')else main+1
            if query==main or query not in allocated:raise ValueError('SourceQuery requires its own additional allocated UDP port')
            install_query(root,mode);child['QUERY_PORT']=str(query)
        else:install_query(root,mode,enabled=False)
        argv+=['--auth-mode',env.get('HYTALE_AUTH_MODE','authenticated'),'--assets',str(assets),'--bind','0.0.0.0:'+str(main)]
        ready=b'Hytale Server Booted';stop='/stop';signal_option=None
    elif kind=='titans':
        native=confined(root,'server/PathOfTitansServer.sh')
        if not native.is_file():raise ValueError('Provide your lawful Path of Titans server files or authenticate the original Alderon downloader')
        query=integer(env,'QUERY_PORT',7778,1025,65535);rcon=integer(env,'RCON_PORT',7779,1025,65535);roles=[main,main+1,main+3,query,rcon]
        if len(set(roles))!=5 or any(port not in allocated for port in roles):raise ValueError('Allocate game, reserved game+1, stats game+3, and distinct original query/RCON roles')
        game_map=env.get('SERVER_MAP','Island')
        if not re.fullmatch(r'[A-Za-z0-9_/-]{1,128}',game_map)or '..'in game_map.split('/'):raise ValueError('Choose a native map name')
        maximum=integer(env,'SERVER_MAX_PLAYERS',100,1,200);name=text(env.get('SERVER_NAME','YoutServerName'),25)
        argv=[str(native),game_map+'?listen?MaxPlayers='+str(maximum),'-Port='+str(main),'-QueryPort='+str(query),'-RconPort='+str(rcon),'-nullRHI','-ServerName='+name,'-ServerGUID='+env['SERVER_GUID'],'-BranchKey='+env.get('BETA_BRANCH','production'),'-Database='+env.get('SERVER_DB','Local'),'-log','-stdout','-FullStdOutLogOutput']
        name_ini='server/PathOfTitans/Saved/Config/LinuxServer/Game.ini';target=confined(root,name_ini)
        if target.exists()and target.stat().st_size>8*1024**2:raise ValueError('Path of Titans Game.ini exceeds limit')
        previous=target.read_text(encoding='utf-8-sig')if target.exists()else''
        native_ini=patch_ini(previous,{'SourceQuery':{'bEnabled':'true','Port':str(query),'IP':'"0.0.0.0"'}}).encode()
        # Retain the original properties API output, while also configuring the
        # documented native engine path instead of claiming properties works.
        properties=confined(root,'server.properties')
        if properties.exists()and properties.stat().st_size>8*1024**2:raise ValueError('Original compatibility properties exceeds limit')
        original=properties.read_text()if properties.exists()else'';values={'server-ip':'0.0.0.0','enable-query':'true','server-port':str(main),'query.port':str(query)};lines=[];seen=set()
        for line in original.splitlines():
            key=line.split('=',1)[0].strip()
            if key in values:line=key+'='+values[key];seen.add(key)
            lines.append(line)
        lines +=[key+'='+value for key,value in values.items()if key not in seen]
        write_config(root,name_ini,native_ini);write_config(root,'server.properties',('\n'.join(lines)+'\n').encode())
        ready=b'Server ready';stop='\x03';signal_option=signal.SIGINT
    else:
        candidates=[confined(root,name)for name in('HogWarpServer.exe','Server.Loader.exe')if confined(root,name).is_file()]
        if len(candidates)!=1:raise ValueError('Provide exactly one lawful original HogWarpServer.exe or current Server.Loader.exe layout')
        wine=shutil.which('wine')
        if not wine or not os.environ.get('DISPLAY'):raise ValueError('HogWarp requires its original Wine runtime and headless display with dotnet7 prerequisites')
        debug=text(env.get('WINEDEBUG','-all'),256)
        if not re.fullmatch(r'[A-Za-z0-9_+,-]*',debug):raise ValueError('Invalid Wine debug channels')
        data=read_json(root,'config.json');data.update(ApiKey=env['API_KEY'],Name=text(env.get('SERV_NAME','Ptero Hogwarp Server')),Port=main,Description=text(env.get('SERV_DESC','')),MaxPlayer=integer(env,'MAX_PLAYERS',4,1,2147483647),IconUrl=text(env.get('SERV_ICON','')))
        for name in('plugins','.wine'):confined(root,name)
        write_config(root,'config.json',data);confined(root,'plugins').mkdir(exist_ok=True)
        child.update(WINEARCH='win64',WINEDEBUG=debug,WINEDLLOVERRIDES='mscoree=n,b;mshtml=n,b',WINEPREFIX=str(root/'.wine'))
        argv=[wine,str(candidates[0])];ready=b'Server started on port ';stop='\x03';signal_option=signal.SIGINT
    return argv,child,secrets,ready,stop,signal_option


def main(root,env):
    root=Path(root).resolve();acquire(root,env);argv,child,secrets,ready,stop,signal_option=configure(root,env)
    options={'credentials':secrets,'ready_marker':ready,'terminal_input':True}
    if signal_option is not None:options['stop_signal']=signal_option
    return run(root,argv,child,stop,**options)


if __name__=='__main__':raise SystemExit(main(Path.cwd(),dict(os.environ)))
