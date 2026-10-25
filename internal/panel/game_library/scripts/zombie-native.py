#!/usr/bin/env python3
"""MIT. Original DayZ, SCUM and Dead Matter controls without shell interpolation."""
import importlib.util
import os
from pathlib import Path
import re
import shlex
import signal
import stat
import subprocess
import sys
import threading
import time

def helper(name):
    path=Path(__file__).with_name(name+'.py')
    if not path.exists():path=path.with_name(name.replace('-','_')+'.py')
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules.setdefault(name.replace('-','_'),module);spec.loader.exec_module(module);return module

steam=helper('steam-template');native=helper('native-config');retention=helper('melee-native');arma=helper('arma-native')
confined=retention.confined;text=retention.text;integer=retention.integer
GAMES={'dayz':(223350,'linux','DayZServer'),'scum':(3792580,'windows','SCUM/Binaries/Win64/SCUMServer.exe'),'dead-matter':(2584780,'windows','DeadMatter/Binaries/Win64/DeadMatterServer-Win64-Test.exe')}
PRIVATE='DayZ private Steam/Workshop transport is not enabled. Upload your legitimate complete Linux server, matching missions and mods, set SKIP_INSTALL=1, UPDATE_SERVER=0 and DISABLE_MOD_UPDATES=1. No account credentials were sent.'

def boolean(env,key,default='0'):
    value=env.get(key,default)
    if value not in ('0','1','true','false'):raise ValueError('Invalid boolean '+key)
    return value in ('1','true')

def ports(env,keys):
    raw=env.get('VOLTRA_ALLOCATED_PORTS','')
    if not re.fullmatch('[0-9]+(?:,[0-9]+)*',raw):raise ValueError('Missing native allocations')
    available={int(p) for p in raw.split(',')};result={'primary':integer(env,'SERVER_PORT',2302)}
    for key,default in keys:result[key]=integer(env,key,default)
    if len(set(result.values()))!=len(result) or any(p not in available for p in result.values()):raise ValueError('Native service ports must be distinct assigned allocations')
    return result

def publish(root,name,data):
    confined(root,root/name);steam._publish(root,name,lambda output:output.write(data),0o600)

def dayz_gate(env):
    if not boolean(env,'SKIP_INSTALL') or boolean(env,'UPDATE_SERVER','1') or not boolean(env,'DISABLE_MOD_UPDATES'):raise ValueError(PRIVATE)
    if env.get('STEAMCMD_APPID','223350') not in ('223350','1042420'):raise ValueError('Unsupported original DayZ application')
    integer(env,'STEAMCMD_ATTEMPTS',3,1,100)

def existing_dayz(root,env):
    dayz_gate(env);binary=confined(root,root/'DayZServer')
    if env.get('SERVER_BINARY','DayZServer')!='DayZServer':raise ValueError('Original DayZ Linux executable is required')
    if not binary.is_file():raise ValueError('Upload your legitimate Linux DayZServer executable')
    with binary.open('rb') as stream:header=stream.read(6)
    if header!=b'\x7fELF\x02\x01':raise ValueError('Uploaded DayZServer must be a little-endian Linux64 ELF, not a Windows client/server')
    config=confined(root,root/'serverDZ.cfg')
    if not config.is_file() or config.stat().st_size>8*1024**2:raise ValueError('Upload your complete native serverDZ.cfg with a matching mission')
    content=config.read_text(encoding='utf-8-sig')
    # Validate native grammar without modifying any operator settings.
    arma.patch_cfg(content,{})
    templates=re.findall(r'\btemplate\s*=\s*"([^"\r\n]+)"\s*;',content)
    if not templates:raise ValueError('DayZ config must select an uploaded mission template')
    for name in templates:
        if not re.fullmatch('[A-Za-z0-9_.-]+',name) or name in ('.','..'):raise ValueError('Invalid mission template name')
        mission=confined(root,root/'mpmissions'/name)
        if not mission.is_dir() or not confined(root,mission/'init.c').is_file():raise ValueError('Missing uploaded mission init.c for '+name)
    return content

def install(root,game,env,validate=True):
    root=Path(root).resolve()
    if game=='dayz':
        existing_dayz(root,env)
        binary=confined(root,root/'DayZServer');binary.chmod(binary.stat().st_mode|0o100)
        # Original account/workshop bootstrap is intentionally gated, not
        # replaced by anonymous installation or unlicensed mission acquisition.
        return {'mode':'operator-files','private_transport':'unavailable'}
    app,platform,binary=GAMES[game]
    if env.get('SRCDS_APPID',str(app))!=str(app):raise ValueError('Wrong original dedicated application')
    steam.arguments(root,app,env,platform=platform,force_platform=True)
    with retention.preserve(root):
        result=steam.update(root,app,env,validate=validate,required=(binary,),platform=platform,force_platform=True)
        if game=='dead-matter':
            sdk=confined(root,root/'.voltra/dead-matter-sdk');sdk.mkdir(parents=True,exist_ok=True)
            steam.update(sdk,1007,env,validate=validate,required=('steamclient64.dll',),platform='windows',force_platform=True)
            for file in sdk.glob('*.dll'):
                confined(root,file);relative=Path(binary).parent/file.name
                publish(root,relative.as_posix(),file.read_bytes())
            # Original SDK1007 and client AppID2184150 behavior retained.
            publish(root,'steam_appid.txt',b'2184150\n')
            helper('enshrouded-proton').provision(root)
        return result

def dayz_mods(root,env):
    clients=arma.mod_list(text(env,'MODIFICATIONS'));servers=arma.mod_list(text(env,'SERVERMODS'))
    filename=text(env,'MOD_FILE','modlist.html',255)
    if filename:
        if '/' in filename or '\\' in filename or filename in ('.','..'):raise ValueError('Launcher modlist must be a root filename')
        path=confined(root,root/filename)
        if path.exists():
            if not path.is_file() or path.stat().st_size>2*1024**2:raise ValueError('Launcher modlist must be a regular file below2MiB')
            parser=arma.Launcher();parser.feed(path.read_text(encoding='utf-8-sig'));clients=list(dict.fromkeys(clients+parser.ids))
    allmods=list(dict.fromkeys(clients+servers));repair=boolean(env,'MODS_LOWERCASE')
    # Validate every path/case collision before changing any tree.
    for name in allmods:
        path=confined(root,root/name)
        if not path.is_dir():raise ValueError('Upload missing legitimate DayZ mod '+name+'; private Workshop acquisition is unavailable')
        for directory,children,files in os.walk(path,followlinks=False):
            entries=children+files
            if any((Path(directory)/entry).is_symlink() for entry in entries):raise ValueError('DayZ mod links are unsupported')
            for entry in files:
                file=Path(directory)/entry
                if not file.is_file() or file.suffix.lower()=='.bikey' and file.stat().st_size>8*1024**2:raise ValueError('DayZ mod contains an unsupported special file or oversized signature key')
            if repair and len({entry.lower() for entry in entries})!=len(entries):raise ValueError('DayZ lowercase repair would overwrite a case collision')
        if repair and path.name!=path.name.lower() and path.with_name(path.name.lower()).exists():raise ValueError('DayZ lowercase root collision')
    if repair:
        renamed={}
        for name in allmods:
            path=root/name;arma.lowercase_tree(path)
            if path.name!=path.name.lower():path.rename(path.with_name(path.name.lower()))
            renamed[name]=str(Path(name).with_name(Path(name).name.lower()))
        clients=[renamed[name] for name in clients];servers=[renamed[name] for name in servers]
    # Shared key publisher retains conflicting operator keys rather than
    # overwriting them and removes only its own unmodified stale copies.
    arma.publish_keys(root,(clients,servers,[]))
    return clients,servers

def dayz_arguments(env):
    value=text(env,'STARTUP_PARAMS','-dologs -adminlog -netlog -freezecheck',8192)
    try:args=shlex.split(value)
    except ValueError:raise ValueError('Unbalanced DayZ startup parameters') from None
    if len(args)>128:raise ValueError('Too many DayZ startup parameters')
    for arg in args:
        if not re.fullmatch(r'-[A-Za-z][A-Za-z0-9]*(?:=[^\r\n\x00]*)?',arg):raise ValueError('Use literal native -Flag or -Flag=value parameters')
        if arg.split('=',1)[0].lower() in ('-port','-profiles','-bepath','-config','-mod','-servermod','-servermods','-storage','-mission'):raise ValueError('Use original managed fields; upload config/mission paths instead of overriding confinement')
    return args

def configure(root,game,env):
    root=Path(root).resolve();binary=confined(root,root/GAMES[game][2]);secrets=tuple(env.get(key,'') for key in ('SERVER_PASSWORD','ADMIN_PASSWORD','RCON_PASSWORD','STEAM_PASS','STEAM_AUTH','STEAMCMD_BETAPASS','SRCDS_BETAPASS'))
    if game=='dayz':
        previous=existing_dayz(root,env);p=ports(env,[('QUERY_PORT',27016),('RCON_PORT',2305)]);extra=dayz_arguments(env)
        values={key:arma.cfg_string(text(env,name,default)) for key,name,default in [('hostname','SERVER_HOSTNAME','DayZ Server'),('password','SERVER_PASSWORD',''),('passwordAdmin','ADMIN_PASSWORD','')]}
        numeric=[('maxPlayers','MAX_PLAYERS',64,1,10000),('verifySignatures','VERIFY_SIGNATURES',2,0,2),('vonCodecQuality','VON_QUALITY',20,0,30),('serverTimeAcceleration','TIME_MULT',12,0,24)]
        for key,name,default,low,high in numeric:values[key]=str(integer(env,name,default,low,high))
        if env.get('VERIFY_SIGNATURES','2') not in ('0','2'):raise ValueError('Original verify signatures accepts0 or2')
        for key,name,default in [('forceSameBuild','ENFORCE_BUILD','1'),('disableVoN','DISABLE_VON','0'),('disable3rdPerson','DISABLE_THIRD','0'),('disableCrosshair','DISABLE_CROSSHAIR','0'),('disablePersonalLight','DISABLE_PERSONAL_LIGHT','1'),('lightingConfig','LIGHTING_CONFIG','0'),('serverTimePersistent','PERSISTENT_TIME','0')]:values[key]='1' if boolean(env,name,default) else '0'
        night=text(env,'NIGHT_MULT','1',32)
        if not re.fullmatch(r'\d+(?:\.\d+)?',night) or not .1<=float(night)<=64:raise ValueError('Night multiplier must be0.1..64')
        values['serverNightTimeAcceleration']=night;values['steamQueryPort']=str(p['QUERY_PORT'])
        updated=arma.patch_cfg(previous,values);password=text(env,'RCON_PASSWORD','',20)
        if not password or any(c.isspace() for c in password):raise ValueError('BattlEye RCON password must be a nonempty single token')
        battleye=confined(root,root/'battleye/beserver_x64.cfg')
        if battleye.exists() and (not battleye.is_file() or battleye.stat().st_size>1024**2):raise ValueError('BattlEye config must be a bounded regular file')
        old=battleye.read_text() if battleye.exists() else 'RestrictRCon 0\n'
        lines=[];seen=set()
        for line in old.splitlines():
            key=line.split(maxsplit=1)[0] if line.strip() else ''
            if key in ('RConPort','RConPassword'):
                if key in seen:raise ValueError('Duplicate managed BattlEye setting')
                seen.add(key);line=key+' '+(str(p['RCON_PORT']) if key=='RConPort' else password)
            lines.append(line)
        for key in ('RConPort','RConPassword'):
            if key not in seen:lines.append(key+' '+(str(p['RCON_PORT']) if key=='RConPort' else password))
        clients,servers=dayz_mods(root,env)
        publish(root,'serverDZ.cfg',updated.encode())
        publish(root,'battleye/beserver_x64.cfg',('\n'.join(lines)+'\n').encode())
        return [str(binary),'-port='+str(p['primary']),'-profiles=profiles','-bepath=./battleye','-config=serverDZ.cfg','-mod='+';'.join(clients),'-serverMod='+';'.join(servers),*extra],secrets,None
    if not binary.is_file():raise ValueError('Publisher distribution lacks the exact original native executable')
    p=ports(env,[('QUERY_PORT',27015 if game=='scum' else 7002)])
    if game=='scum':
        playstyle=text(env,'SERVER_PLAYSTYLE','PVP',3)
        if playstyle not in ('PVE','PVP'):raise ValueError('Invalid original SCUM playstyle')
        players=integer(env,'MAX_PLAYERS',64,1,10000)
        relative='SCUM/Saved/Config/WindowsServer/ServerSettings.ini';path=confined(root,root/relative)
        if path.exists() and (not path.is_file() or path.stat().st_size>8*1024**2):raise ValueError('SCUM settings must be a bounded regular file')
        previous=path.read_text(encoding='utf-8-sig') if path.exists() else ''
        settings={'scum.ServerName':text(env,'SERVER_NAME','A Pterodactyl Hosted Server',50),'scum.ServerDescription':text(env,'SERVER_DESCRIPTION','A Pterodactyl Hosted Server'),'scum.ServerPassword':text(env,'SERVER_PASSWORD','',30),'scum.ServerPlaystyle':playstyle}
        publish(root,relative,native.patch_ini(previous,{'General':settings}).encode())
        return ['wine',str(binary),'-Port='+str(p['primary']),'-QueryPort='+str(p['QUERY_PORT']),'-MaxPlayers='+str(players)],secrets,'SCUM/Saved/Logs/SCUM.log'
    return [str(helper('enshrouded-proton').location(root)),'run',str(binary),'-SteamServerName='+text(env,'SERVER_NAME','A Pterodactyl hosted server',128),'-port='+str(p['primary']),'-queryport='+str(p['QUERY_PORT'])],secrets,'DeadMatter/Saved/Logs/DeadMatter.log'

class NativeLog:
    """Follow only new confined native log bytes; never erase old logs."""
    def __init__(self,root,name,secrets):
        self.root,self.name=root,name;self.redactor=steam.Redactor(secrets);self.identity=None;self.offset=0;self.initial=True
        self.scan(lambda _:None)
    def scan(self,emit):
        with steam._publication_parent(self.root,self.name) as (parent,name,_):
            if parent is None:self.initial=False;return
            try:fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
            except FileNotFoundError:self.initial=False;return
            with os.fdopen(fd,'rb') as stream:
                info=os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode):raise ValueError('Native log must be a regular file')
                identity=(info.st_dev,info.st_ino)
                if self.initial:self.identity=identity;self.offset=info.st_size;self.initial=False;return
                if identity!=self.identity or info.st_size<self.offset:self.identity=identity;self.offset=0
                stream.seek(self.offset)
                for _ in range(32):
                    data=stream.read(65536)
                    if not data:break
                    self.offset+=len(data);emit(self.redactor.feed(data,final=data.endswith(b'\n')))

def run(root,game,env):
    if game=='dayz':dayz_gate(env)
    elif env.get('VOLTRA_STEAM_AUTO_UPDATE','0')=='1':install(root,game,env,validate=boolean(env,'VALIDATE'))
    argv,secrets,log=configure(root,game,env);child=dict(env)
    for key in ('PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH','LD_PRELOAD','STEAM_PASS','STEAM_AUTH','ADMIN_PASSWORD','RCON_PASSWORD','SERVER_PASSWORD'):child.pop(key,None)
    child['HOME']=str(root);child['LD_LIBRARY_PATH']=str(root/'.steam/sdk64')
    if game=='dead-matter':
        child['STEAM_COMPAT_CLIENT_INSTALL_PATH']=str(confined(root,root/'.steam/steam'));child['STEAM_COMPAT_DATA_PATH']=str(confined(root,root/'.steam/steam/steamapps/compatdata/2584780'))
        for key in ('STEAM_COMPAT_CLIENT_INSTALL_PATH','STEAM_COMPAT_DATA_PATH'):Path(child[key]).mkdir(parents=True,exist_ok=True)
    follower=NativeLog(root,log,secrets) if log else None
    display=None
    if game=='scum' and boolean(env,'XVFB'):
        child['DISPLAY']=':99';display=subprocess.Popen(['Xvfb',':99','-screen','0','1024x768x24','-nolisten','tcp','-noreset'],env=child,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    finished=threading.Event();failure=[]
    def emit(data):sys.stdout.buffer.write(data);sys.stdout.buffer.flush()
    def tail():
        try:
            while not finished.wait(.1):follower.scan(emit)
            follower.scan(emit);emit(follower.redactor.feed(b'',final=True))
        except Exception:failure.append(True);print('Native log relay failed confinement or file validation.',file=sys.stderr)
    worker=threading.Thread(target=tail,daemon=True) if follower else None
    if worker:worker.start()
    try:
        if display:
            for _ in range(100):
                if display.poll() is not None:raise ValueError('Private SCUM display failed')
                if Path('/tmp/.X11-unix/X99').exists():break
                time.sleep(.05)
            else:raise ValueError('Private SCUM display did not become ready')
        code=helper('native-console').run(root,argv,child,'\x03',secrets,terminal_input=True,terminal_query_reply=game!='dayz',terminal_enter_carriage_return=game!='dayz',stop_signal=signal.SIGINT)
        return 1 if failure and code==0 else code
    finally:
        finished.set()
        if worker:worker.join(timeout=3)
        if display and display.poll() is None:
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
        message=str(error)
        for key in ('STEAM_USER','STEAM_PASS','STEAM_AUTH','RCON_PASSWORD','ADMIN_PASSWORD','SERVER_PASSWORD'):
            if os.environ.get(key):message=message.replace(os.environ[key],'[REDACTED]')
        print('Survival server failed: '+message,file=sys.stderr);sys.exit(1)
