#!/usr/bin/env python3
"""MIT. Typed original Mordhau/Linux/Wine and Bannerlord dedicated recipes."""
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

def helper(name):
    path=Path(__file__).with_name(name+'.py')
    if not path.exists():path=path.with_name(name.replace('-','_')+'.py')
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules.setdefault(name.replace('-','_'),module);spec.loader.exec_module(module);return module

steam=helper('steam-template');native=helper('native-config')
GAMES={'mordhau':(629800,'linux','Mordhau/Binaries/Linux/MordhauServer-Linux-Shipping'),'mordhau-wine':(629800,'windows','MordhauServer.exe'),'bannerlord':(1863440,'windows','bin/Win64_Shipping_Server/DedicatedCustomServer.Starter.exe')}

def confined(root,path):
    path=Path(path)
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):raise ValueError('Melee path leaves server storage')
    for parent in path.parents:
        if parent==root:break
        if parent.is_symlink():raise ValueError('Melee path contains symbolic links')
    return path

def text(env,key,default='',limit=4096):
    value=env.get(key,default)
    if not isinstance(value,str) or len(value)>limit or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid '+key)
    return value

def integer(env,key,default,minimum=1,maximum=65535):
    value=str(env.get(key,default))
    if not re.fullmatch('[0-9]+',value) or not minimum<=int(value)<=maximum:raise ValueError('Invalid '+key)
    return int(value)

def selection(game,env):
    if game not in GAMES:raise ValueError('Unknown melee recipe')
    app,platform,binary=GAMES[game]
    if env.get('SRCDS_APPID',str(app))!=str(app):raise ValueError('Wrong dedicated application')
    # Validate unsupported account/password/branch/flags before any mutation.
    steam.arguments(Path('/server'),app,env,platform=platform,force_platform=True)
    if game!='mordhau':
        expected='vcrun2022' if game=='mordhau-wine' else 'vcrun2019 dotnet472'
        if env.get('WINETRICKS_RUN',expected)!=expected:raise ValueError('This Wine recipe requires its reviewed original runtime verbs')
        if env.get('WINEARCH','win64')!='win64':raise ValueError('This native server requires a win64 Wine prefix')
    return app,platform,binary

def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

@contextlib.contextmanager
def preserve(root):
    state=confined(root,root/'.voltra/melee-preserve');state.mkdir(parents=True,exist_ok=True)
    receipt=confined(root,state/'publisher.json');previous=json.loads(receipt.read_text()) if receipt.exists() else {}
    excluded={'.voltra','.steam','.cache','.wine','steamapps','steamcmd','logs'}
    def files():
        return [p for p in root.rglob('*') if not any(part in excluded for part in p.relative_to(root).parts) and p.is_file()]
    records=[]
    with tempfile.TemporaryDirectory(dir=state) as temporary:
        for path in files():
            confined(root,path);name=path.relative_to(root).as_posix()
            protected=any(part.lower() in ('saved','config','configs','plugins','mods','tokens') for part in path.relative_to(root).parts[:-1]) or path.suffix.lower() in ('.ini','.cfg','.txt','.xml','.json','.db','.sqlite','.sav')
            # Preserve unknown/new/modified operator files, including modules,
            # even on a failed validate; unmodified publisher binaries may update.
            if not protected and previous.get(name)==digest(path):continue
            info=path.stat();backup=Path(temporary)/str(len(records));shutil.copyfile(path,backup);backup.chmod(0o600)
            records.append({'path':name,'target':name,'backup':str(backup),'uid':info.st_uid,'gid':info.st_gid,'mode':info.st_mode&0o7777,'atime_ns':info.st_atime_ns,'mtime_ns':info.st_mtime_ns,'link':None})
        try:
            yield
            steam._publish(root,'.voltra/melee-preserve/publisher.json',lambda output:output.write(json.dumps({p.relative_to(root).as_posix():digest(p) for p in files()}).encode()),0o600)
        finally:
            restore=helper('source-install').restore_file
            for record in records:
                confined(root,root/record['target']);restore(root,record)

def install(root,game,env,validate=True):
    root=Path(root).resolve();app,platform,binary=selection(game,env)
    with preserve(root):
        result=steam.update(root,app,env,validate=validate,required=(binary,),platform=platform,force_platform=True)
        if platform=='linux':confined(root,root/binary).chmod(0o755)
        else:
            # Preserve the original Wine document-path initialization; no
            # token or account is invented inside the prefix.
            confined(root,root/'.wine/drive_c/users/container/My Documents').mkdir(parents=True,exist_ok=True)
        return result

def service_ports(env):
    raw=env.get('VOLTRA_ALLOCATED_PORTS','')
    if not re.fullmatch('[0-9]+(?:,[0-9]+)*',raw):raise ValueError('Missing native allocations')
    available={int(port) for port in raw.split(',')};primary=integer(env,'SERVER_PORT',7777)
    if primary not in available or any(not 1<=p<=65535 for p in available):raise ValueError('Invalid native allocation set')
    used={primary};ports={'primary':primary};pending=[]
    for key in ('QUERY_PORT','BEACON_PORT'):
        if env.get(key,'')=='':pending.append(key);continue
        port=integer(env,key,0)
        if port not in available or port in used:raise ValueError('Query/beacon need distinct allocated ports')
        used.add(port);ports[key]=port
    for key in pending:
        remaining=sorted(available-used)
        if not remaining:raise ValueError('Missing allocated '+key)
        ports[key]=remaining[0];used.add(remaining[0])
    return ports

def configure(root,game,env):
    root=Path(root).resolve();selection(game,env);binary=confined(root,root/GAMES[game][2])
    if game=='bannerlord':
        token=text(env,'AUTH_TOKEN','',16384)
        if not token:raise ValueError('Bannerlord requires a real in-game generated server auth token; anonymous hosting is unsupported')
        config=text(env,'SERVER_CONFIG','tdm_config.txt',128)
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*\.txt',config):raise ValueError('Bannerlord config must be a Native-module text filename')
        path=confined(root,root/'Modules/Native'/config)
        if not path.is_file():raise ValueError('Upload the original tdm_config.txt or your legitimate publisher-compatible Native module config; old upstream paste is unavailable')
        modules=text(env,'SERVER_MODULES','Native,Multiplayer',512).split(',')
        if not modules or len(modules)>32 or len(set(modules))!=len(modules) or any(not re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]{0,100}',name) for name in modules):raise ValueError('Invalid native module list')
        # Documented native argument transport; never shell-expanded or printed.
        # Privileged host process inspection can see the original native token.
        return binary.parent,['wine',str(binary),'/port',str(integer(env,'SERVER_PORT',7210)),'/dedicatedcustomserverauthtoken',token,'/dedicatedcustomserverconfigfile',config,'_MODULES_*'+'*'.join(modules)+'*_MODULES_'],(token,)
    ports=service_ports(env);windows=game=='mordhau-wine'
    mapname=text(env,'DEFAULT_MAP','/Game/Mordhau/Maps/Contraband/FFA_Contraband' if windows else 'Grad/FL_Grad',256)
    if mapname and (not re.fullmatch('[A-Za-z0-9_/-]+',mapname) or '..' in mapname.split('/')):raise ValueError('Default map must be a literal native package path')
    if not windows and not mapname:raise ValueError('Linux recipe requires its original default map')
    if not windows and not mapname.startswith('/Game/'):mapname='/Game/Mordhau/Maps/'+mapname
    mapping={'ServerName':text(env,'SERVER_NAME','Pterodactyl Server',4096),'ServerPassword':text(env,'GAME_PASSWORD'),'AdminPassword':text(env,'ADMIN_PASSWORD'),'MaxSlots':str(integer(env,'MAX_PLAYERS',48 if not windows else 24,1,60))}
    relative='Mordhau/Saved/Config/'+('WindowsServer' if windows else 'LinuxServer')+'/Game.ini';path=confined(root,root/relative)
    previous=path.read_text(encoding='utf-8-sig') if path.exists() else ''
    updated=native.patch_ini(previous,{'/Script/Mordhau.MordhauGameSession':mapping})
    if previous!=updated:
        if previous:steam._publish(root,'.voltra/melee-config-backups/'+str(time.time_ns())+'-Game.ini',lambda output:output.write(previous.encode()),0o600)
        mode=path.stat().st_mode&0o777 if path.exists() else 0o600
        steam._publish(root,relative,lambda output:output.write(updated.encode()),mode)
    argv=(['wine',str(binary)] if windows else [str(binary)])+([mapname] if mapname else [])
    argv+=(['-log','MaxSlots='+mapping['MaxSlots']] if windows else ['-MaxSlots='+mapping['MaxSlots']])
    argv+=['-USEALLAVAILABLECORES','-Port='+str(ports['primary']),'-QueryPort='+str(ports['QUERY_PORT']),'-Beaconport='+str(ports['BEACON_PORT'])]
    native_secrets=[]
    for line in updated.splitlines():
        match=re.match(r'^\s*(?:RconPassword|ServerModAuthToken)\s*=\s*(.*?)\s*$',line,re.IGNORECASE)
        if match and match[1]:native_secrets.append(match[1].strip('"'))
    return root,argv,tuple([mapping['ServerPassword'],mapping['AdminPassword'],*native_secrets])

def run(root,game,env):
    if env.get('VOLTRA_STEAM_AUTO_UPDATE','0')=='1':install(root,game,env,validate=env.get('VALIDATE','0')=='1')
    cwd,argv,secrets=configure(root,game,env);environment=dict(env)
    for key in ('PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH','LD_PRELOAD','AUTH_TOKEN','ADMIN_PASSWORD','GAME_PASSWORD','STEAM_PASS','STEAM_AUTH'):environment.pop(key,None)
    environment['HOME']=str(root)
    previous_ld=text(env,'VOLTRA_NATIVE_LD_LIBRARY_PATH','',4096)
    environment.pop('VOLTRA_NATIVE_LD_LIBRARY_PATH',None)
    if previous_ld:environment['LD_LIBRARY_PATH']=previous_ld
    if game=='mordhau':environment['LD_LIBRARY_PATH']=str(root/'.steam/sdk64')+(':'+previous_ld if previous_ld else '')
    console=helper('native-console')
    if game=='mordhau':return console.run(cwd,argv,environment,'\x03',secrets,terminal_input=True)
    # Stock image initializes original fixed winetricks requirements. Own a
    # separate display until the native child exits, independent of image tini.
    environment['DISPLAY']=':99';environment['WINEPREFIX']=str(root/'.wine')
    display=subprocess.Popen(['Xvfb',':99','-screen','0','1024x768x24','-nolisten','tcp','-noreset'],env=environment,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    try:
        for _ in range(100):
            if display.poll() is not None:raise ValueError('Private Wine display failed')
            if Path('/tmp/.X11-unix/X99').exists():break
            time.sleep(.05)
        else:raise ValueError('Private Wine display did not become ready')
        return console.run(cwd,argv,environment,'\x03',secrets,terminal_input=True,terminal_query_reply=True,terminal_enter_carriage_return=True)
    finally:
        if display.poll() is None:
            display.terminate()
            try:display.wait(timeout=5)
            except subprocess.TimeoutExpired:display.kill();display.wait()

if __name__=='__main__':
    try:
        mode,game=sys.argv[1:3];root=Path.cwd();env=dict(os.environ)
        if mode=='install':install(root,game,env)
        elif mode=='run':sys.exit(run(root,game,env))
        else:raise ValueError('Expected install or run')
    except Exception as error:
        # Messages are authored above or shared helpers; redact native secrets.
        message=str(error)
        for key in ('AUTH_TOKEN','ADMIN_PASSWORD','GAME_PASSWORD','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS'):
            if os.environ.get(key):message=message.replace(os.environ[key],'[REDACTED]')
        print('Melee server failed: '+message,file=sys.stderr);sys.exit(1)
