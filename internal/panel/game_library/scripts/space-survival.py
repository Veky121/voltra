#!/usr/bin/env python3
"""MIT. Typed original Astroneer, Icarus and Empyrion setup."""
import codecs
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import threading
import time


def helper(name):
    path=Path(__file__).with_name(name+'.py')
    if not path.exists():path=path.with_name(name.replace('-','_')+'.py')
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec)
    sys.modules[name.replace('-','_')]=module;spec.loader.exec_module(module);return module


shared=helper('steam-native-next');engineering=helper('engineering-servers')
steam,native,release=shared.steam,shared.native,shared.release
PINS=json.loads(Path(__file__).with_name('space-survival-pins.json').read_text())


def yaml_module(root):
    location=shared.confined(root,root/'.voltra/python-packages')
    sys.path.insert(0,str(location))
    import yaml
    return yaml


def install_yaml(root):
    state=shared.confined(root,root/'.voltra/space-survival/yaml');state.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='stage-',dir=state)as folder:
        stage=Path(folder);release.download(PINS['pyyaml'],stage/'source.tar.gz')
        ready=stage/'ready';ready.mkdir();release.extract(stage/'source.tar.gz',ready,PINS['pyyaml']['prefix'])
        files=list((ready/'lib/yaml').rglob('*.py'))
        if not files:raise ValueError('Missing pinned pure-Python YAML package')
        payload={'.voltra/python-packages/yaml/'+p.relative_to(ready/'lib/yaml').as_posix():p.read_bytes()for p in files}
        payload['.voltra/python-packages/PyYAML-LICENSE']=(ready/'LICENSE').read_bytes()
        for name,data in payload.items():
            target=shared.confined(root,root/name)
            if target.exists()and target.read_bytes()!=data:raise ValueError('Conflicting operator YAML code retained for review')
        for name,data in payload.items():
            if not(root/name).exists():steam._publish(root,name,lambda out,value=data:out.write(value))


def patch_yaml(root,content,values):
    yaml=yaml_module(root)
    if len(content.encode())>8*1024**2:raise ValueError('Oversized native YAML')
    tree=yaml.compose(content,Loader=yaml.SafeLoader)
    if tree is None:tree=yaml.compose('{}',Loader=yaml.SafeLoader)
    if not isinstance(tree,yaml.MappingNode):raise ValueError('Native YAML root must be a mapping')
    seen_nodes=set()
    def validate(node):
        if id(node)in seen_nodes:raise ValueError('Native YAML aliases/cycles require explicit operator review')
        seen_nodes.add(id(node))
        if isinstance(node,yaml.MappingNode):
            keys=set()
            for key,value in node.value:
                if not isinstance(key,yaml.ScalarNode)or key.value in keys:raise ValueError('Duplicate/non-scalar YAML key')
                keys.add(key.value);validate(value)
        elif isinstance(node,yaml.SequenceNode):
            for item in node.value:validate(item)
    validate(tree)
    data=yaml.safe_load(content)or{};edits=[];sections={key.value:value for key,value in tree.value}
    for section,fields in values.items():
        node=sections.get(section)
        if node is None:
            edits.append((len(content),len(content),'\n'+yaml.safe_dump({section:fields},sort_keys=False,allow_unicode=True)))
            continue
        if not isinstance(node,yaml.MappingNode):raise ValueError('Native config section must be a mapping')
        if node.flow_style:
            merged={**data[section],**fields}
            rendered=yaml.safe_dump(merged,sort_keys=False,allow_unicode=True)
            edits.append((node.start_mark.index,node.end_mark.index,'\n'+''.join('  '+line+'\n'for line in rendered.splitlines())))
            continue
        existing={key.value:value for key,value in node.value}
        missing={}
        for key,value in fields.items():
            old=existing.get(key)
            if old is None:missing[key]=value;continue
            if not isinstance(old,yaml.ScalarNode):raise ValueError('Managed YAML field must be scalar')
            serialized=json.dumps(value,ensure_ascii=False)if isinstance(value,str)else str(value).lower()if isinstance(value,bool)else str(value)
            edits.append((old.start_mark.index,old.end_mark.index,serialized))
        if missing:
            addition=''.join('  '+line+'\n'for line in yaml.safe_dump(missing,sort_keys=False,allow_unicode=True).splitlines())
            edits.append((node.end_mark.index,node.end_mark.index,addition))
    for start,end,value in sorted(edits,key=lambda e:e[0],reverse=True):content=content[:start]+value+content[end:]
    checked=yaml.safe_load(content)
    for section,fields in values.items():
        if any(checked[section][key]!=value for key,value in fields.items()):raise ValueError('Native YAML update did not roundtrip')
    return content


def owner_players(content,owner,guid,old_guid):
    section='';lines=[];matches=0
    for line in content.splitlines(keepends=True):
        match=re.match(r'^\s*\[([^]]+)\]',line)
        if match:section=match[1]
        if section=='/Script/Astro.AstroServerSettings'and re.match(r'^\s*PlayerProperties\s*=',line):
            found=re.search(r'PlayerGuid="([^"\\]*)"',line)
            if found and found[1]in(guid,old_guid)and found[1]:
                if found[1]==guid:matches+=1
                continue
        lines.append(line)
    if matches>1:raise ValueError('Duplicate managed Astroneer player identity')
    escaped=owner.replace('\\','\\\\').replace('"','\\"')
    entry='PlayerProperties=(PlayerFirstJoinName="'+escaped+'",PlayerCategory=Admin,PlayerGuid="'+guid+'",PlayerRecentJoinName="")\n'
    result=''.join(lines);lines=result.splitlines(keepends=True);section='';position=None
    for index,line in enumerate(lines):
        match=re.match(r'^\s*\[([^]]+)\]',line)
        if match:
            if section=='/Script/Astro.AstroServerSettings':position=index;break
            section=match[1]
    if position is None:position=len(lines)
    if position and not lines[position-1].endswith('\n'):lines[position-1]+='\n'
    lines.insert(position,entry);return''.join(lines)


def configure(root,game,env):
    root=Path(root).resolve();pin=PINS[game]
    if game=='astroneer':
        ports=shared.roles(env,[]);public=shared.text(env,'PUBLIC_IP','',64);ipaddress.ip_address(public)
        owner=shared.text(env,'OWNER_NAME','',100);guid=shared.text(env,'OWNER_GUID','',20)
        if not owner or not re.fullmatch(r'[0-9]{1,20}',guid):raise ValueError('Original owner name/GUID required')
        password=shared.text(env,'SERVER_PWD','',100);name=shared.text(env,'SERVER_NAME','Pterodactyl hosted Server',60)
        settings=shared.confined(root,root/'Astro/Saved/Config/WindowsServer/AstroServerSettings.ini')
        previous=settings.read_text(encoding='utf-8-sig')if settings.exists()else''
        receipt=shared.confined(root,root/'.voltra/space-survival/astro-owner.json')
        old=json.loads(receipt.read_text()).get('guid','')if receipt.exists()else''
        # Validate repeated admin records before any native config publication.
        content=native.patch_ini(previous,{'/Script/Astro.AstroServerSettings':{'PublicIP':public,'OwnerName':owner,'OwnerGuid':guid,'ServerPassword':password,'ServerName':name}})
        content=owner_players(content,owner,guid,old)
        engine=shared.confined(root,root/'Astro/Saved/Config/WindowsServer/Engine.ini')
        native.configure_ini(root,engine,{'URL':{'Port':str(ports['primary'])},'SystemSettings':{'net.AllowEncryption':'false'}},root/'.voltra/space-survival/config-history')
        shared.write_config(root,settings,content);native.private_write(receipt,json.dumps({'guid':guid})+'\n')
        return [str(helper('enshrouded-proton').location(root)),'run',str(root/pin['binary'])],[password],root,None
    if game=='icarus':
        ports=shared.roles(env,['QUERY_PORT']);name=shared.text(env,'SERVER_NAME','IcarusServer',64)
        target=shared.confined(root,root/'Icarus/Saved/Config/WindowsServer/ServerSettings.ini')
        legacy=shared.confined(root,root/'Icarus/Saved/Config/ServerSettings.ini')
        if not target.exists():
            content=legacy.read_text(encoding='utf-8-sig')if legacy.exists()else Path(__file__).with_name('space-survival-icarus.ini').read_text()
            shared.write_config(root,target,content)
        # Publisher says SessionName is ignored; preserve all native prospect/admin
        # settings and use the original SteamServerName launch control.
        passwords=re.findall(r'(?mi)^\s*(?:JoinPassword|AdminPassword)\s*=\s*(.*)$',target.read_text())
        argv=['wine',str(root/pin['binary']),'-Log','-SteamServerName='+name,'-PORT='+str(ports['primary']),'-QueryPort='+str(ports['QUERY_PORT']),'-UserDir='+engineering.windows(root/'Icarus')]
        return argv,passwords,root,shared.confined(root,root/'Icarus/Saved/Logs/Icarus.log')
    ports=shared.roles(env,[],offsets=(1,2,3,4));tel=shared.integer(env,'TELNET_PORT',1030,1024,65535)
    if tel in set(int(v)for v in env['VOLTRA_ALLOCATED_PORTS'].split(',')):raise ValueError('Internal Telnet port must never be publicly allocated')
    password=shared.text(env,'SERVER_PASSWORD','',20)
    server={'Srv_Port':ports['primary'],'Srv_Name':shared.text(env,'SERVER_NAME','A Pterodactyl Server',20),'Srv_Description':shared.text(env,'SERVER_DESCRIPTION','An Empyrion Galactic Survival server hosted on Pterodactyl.',127),
            'Srv_MaxPlayers':shared.integer(env,'MAX_PLAYERS',8,1,2147483647),'Srv_Public':engineering.boolean(env,'SERVER_PUBLIC','true')=='true','Srv_Password':password,'Tel_Enabled':True,'Tel_Port':tel,
            'EACActive':engineering.boolean(env,'EAC_ACTIVE','true')=='true','MaxAllowedSizeClass':shared.integer(env,'MAX_ALLOWED_SIZE_CLASS',10,0,2147483647),
            'AllowedBlueprints':engineering.choice(env,'ALLOWED_BLUEPRINTS','All',('All','StockOnly','None')),'HeartbeatServer':shared.integer(env,'SERVER_HEARTBEAT',15,0,180),'TimeoutBootingPfServer':shared.integer(env,'TIMEOUT_BOOTING_PF_SERVER',90,0,600)}
    gameconfig={'Seed':shared.integer(env,'GAME_SEED',1011345,1,9999999),'GameName':shared.world_name({'WORLD_NAME':env.get('GAME_NAME','DediGame')},'DediGame',20),'Mode':engineering.choice(env,'GAME_MODE','Survival',('Survival','Creative')),'CustomScenario':shared.world_name({'WORLD_NAME':env.get('CUSTOM_SCENARIO','Default Multiplayer')},'Default Multiplayer',50)}
    target=shared.confined(root,root/'dedicated.yaml');content=target.read_text(encoding='utf-8-sig')if target.exists()else'ServerConfig:\n  Srv_Port: 30000\nGameConfig:\n  GameName: DediGame\n'
    yaml=yaml_module(root);existing=yaml.safe_load(content)or{}
    telpwd=existing.get('ServerConfig',{}).get('Tel_Pwd','')
    if not isinstance(telpwd,str):raise ValueError('Invalid native Telnet password')
    shared.text({'Tel_Pwd':telpwd},'Tel_Pwd','',4096)
    # Preserve configured password; generate a private secret for original blank.
    if not telpwd:
        import secrets
        telpwd=secrets.token_urlsafe(24)
    server['Tel_Pwd']=telpwd
    updated=patch_yaml(root,content,{'ServerConfig':server,'GameConfig':gameconfig});shared.write_config(root,target,updated)
    argv=['wine',str(root/pin['binary']),'-batchmode','-nographics','-logFile',engineering.windows(root/'Logs/server/server.log'),'-dedicated',engineering.windows(target)]
    return argv,[password,telpwd],root/'DedicatedServer',shared.confined(root,root/'Logs/server/server.log')


def identity(game,env):
    if env.get('SRCDS_APPID',str(PINS[game]['appid']))!=str(PINS[game]['appid'])or env.get('WINDOWS_INSTALL','1')!='1':raise ValueError('Wrong original application/platform')


def operator_files(root,game):
    pin=PINS[game];names=[pin['binary']]
    if game=='astroneer':names+=['.steam/sdk64/steamclient.so']
    content='Astro/Content'if game=='astroneer'else'Icarus/Content'if game=='icarus'else'Content'
    path=shared.confined(root,root/content)
    if not path.is_dir()or not any(path.iterdir()):raise ValueError('Missing legitimate original game content')
    if game=='empyrion':names+=['DedicatedServer/EmpyrionDedicated_Data/Managed/Assembly-CSharp.dll']
    hashes={}
    for name in names:
        path=shared.confined(root,root/name)
        if not path.is_file():raise ValueError('Missing original Windows server binary')
        engineering.binary(path,linux=name.endswith('.so'),machine=0x8664 if name.endswith('.exe')else None)
        hashes[name]={'sha256':release.sha256(path),'bytes':path.stat().st_size}
    native.private_write(shared.confined(root,root/'.voltra/space-survival/operator-files.json'),json.dumps({'game':game,'files':hashes,'runtime_verified':False,'publisher_authenticity_verified':False})+'\n')


def install(root,game,env):
    root=Path(root).resolve();identity(game,env)
    mode=engineering.choice(env,'INSTALL_MODE','steam',('steam','operator_files'))
    # Parse private credentials before any game/framework acquisition.
    if mode=='steam':steam.arguments(root,PINS[game]['appid'],env,platform='windows')
    else:operator_files(root,game)
    if mode=='steam':
        with shared.preserve(root):steam.update(root,PINS[game]['appid'],env,required=(PINS[game]['binary'],),platform='windows')
    for arch in ('32','64'):
        source=shared.confined(root,root/('.voltra/steamcmd/linux'+arch+'/steamclient.so'));target='.steam/sdk'+arch+'/steamclient.so'
        shared.confined(root,root/target)
        if source.is_file()and not(root/target).exists():
            with source.open('rb')as inp:steam._publish(root,target,lambda out:shutil.copyfileobj(inp,out))
    if game=='astroneer':helper('enshrouded-proton').provision(root)
    if game=='empyrion':install_yaml(root)


def follow_log(path,finished,credentials):
    redactor=steam.Redactor(credentials);decoder=codecs.getincrementaldecoder('utf-8')('replace');source=None;inode=None
    try:
        while True:
            if path.exists():
                if path.is_symlink():raise ValueError('Native log must not be a link')
                current=path.stat()
                if source is None or inode!=(current.st_dev,current.st_ino)or current.st_size<source.tell():
                    if source:source.close()
                    source=path.open('rb');inode=(current.st_dev,current.st_ino)
                data=source.read(65536)
                if data:sys.stdout.write(decoder.decode(redactor.feed(data)));sys.stdout.flush();continue
            if finished.wait(.1):break
    finally:
        sys.stdout.write(decoder.decode(redactor.feed(b'',final=True),final=True));sys.stdout.flush()
        if source:source.close()


def run(root,game,env):
    root=Path(root).resolve();identity(game,env)
    auto=engineering.choice(env,'VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','1'),('0','1'))
    mode=engineering.choice(env,'INSTALL_MODE','steam',('steam','operator_files'))
    if auto=='1':install(root,game,env)
    elif mode=='operator_files':operator_files(root,game)
    if game=='icarus':environment=helper('private-wine-prerequisites').prepare(root,env,'vcrun2022 corefonts',engineering.PINS,('vcrun2022','corefonts'))
    else:
        environment=dict(os.environ);environment.update(HOME=str(root),WINEDEBUG=shared.text(env,'WINEDEBUG','-all',32),WINEPREFIX=str(shared.confined(root,root/'.wine')))
    if game=='astroneer':
        for key,path in {'STEAM_COMPAT_CLIENT_INSTALL_PATH':root/'.steam/steam','STEAM_COMPAT_DATA_PATH':root/'.steam/steam/steamapps/compatdata/728470'}.items():
            shared.confined(root,path);path.mkdir(parents=True,exist_ok=True);environment[key]=str(path)
        environment.update(PROTON_LOG=engineering.choice(env,'PROTON_LOG','1',('0','1')),PROTON_LOG_DIR=str(root),LD_LIBRARY_PATH=str(root/'.voltra/proton/lib')+':'+str(root/'.steam/sdk64'))
    for key in ('STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS','PYTHONHOME','PYTHONPATH','LD_PRELOAD'):
        environment.pop(key,None)
    if game!='astroneer':environment.pop('LD_LIBRARY_PATH',None)
    argv,credentials,cwd,log=configure(root,game,env)
    credentials +=[env.get(k,'')for k in('STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    finished=threading.Event();thread=None
    if log is not None:
        if log.exists():
            history=shared.confined(root,root/'.voltra/space-survival/log-history');history.mkdir(parents=True,exist_ok=True);log.rename(history/(str(time.time_ns())+'.log'))
        log.parent.mkdir(parents=True,exist_ok=True)
        thread=threading.Thread(target=follow_log,args=(log,finished,credentials),daemon=True);thread.start()
    if game=='empyrion':
        environment['VOLTRA_EMPYRION_PASSWORD']=credentials[1]
        argv=[sys.executable,str(Path(__file__).with_name('space-survival-console.py')),str(shared.integer(env,'TELNET_PORT',1030,1024,65535)),*argv]
    try:
        code=helper('native-console').run(cwd,argv,environment,'saveandexit 0'if game=='empyrion'else'\x03',credentials,terminal_input=game!='empyrion')
        return code if code>=0 else 128-code
    finally:
        finished.set()
        if thread:thread.join(timeout=2)


if __name__=='__main__':
    try:
        action,game=sys.argv[1:3]
        if game not in('astroneer','icarus','empyrion'):raise ValueError('Unknown game')
        if action=='install':install(Path.cwd(),game,dict(os.environ))
        elif action=='run':sys.exit(run(Path.cwd(),game,dict(os.environ)))
        else:raise ValueError('Unknown action')
    except Exception:
        print('Space survival setup failed: review typed settings, original platform/ports and lawful game/runtime prerequisites; unsupported private Steam credentials are never replaced with anonymous.',file=sys.stderr);sys.exit(1)


