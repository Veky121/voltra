#!/usr/bin/env python3
"""MIT. Typed Colony, Hurtworld, Holdfast and Rising World native setup."""
import contextlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import sys
import tempfile
import threading
import stat
import time
import urllib.request
import zipfile

def helper(name):
    path=Path(__file__).with_name(name+'.py')
    if not path.exists():path=path.with_name(name.replace('-','_')+'.py')
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules[name.replace('-','_')]=module;spec.loader.exec_module(module);return module

native=helper('native-config');steam=helper('steam-template');release=helper('native-release')
GAMES={'colony':(748090,'colonyserver.x86_64'),'hurtworld':(405100,'Hurtworld.x86_64'),'holdfast':(1424230,'Holdfast NaW'),'rising':(339010,'RisingWorldServer.x64')}
COLONY_CONFIG={'url':'https://raw.githubusercontent.com/pipliz/ColonySurvival/23c8dad2fa7debaf38e802bc6472914bf75f68c0/gamedata/help/hosting_docker/server.config.json','sha256':'dc7f20d5a53d91e88e75f7fe4b4c9557cde32c527c3cdacb21066895f33901ef','bytes':2349}
OXIDE={'version':'2.0.4112','url':'https://github.com/OxideMod/Oxide.Hurtworld/releases/download/2.0.4112/Oxide.Hurtworld-linux.zip','sha256':'b9aaed605f6e94f94c44fd3a5f60537fd0e3ea6f35af4ab9b4d206422d3377bc','bytes':10595232}

def confined(root,path):
    path=Path(path)
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):raise ValueError('Native path leaves server volume')
    for parent in path.parents:
        if parent==root:break
        if parent.is_symlink():raise ValueError('Native path uses symbolic links')
    return path

def text(env,key,default='',limit=255):
    value=env.get(key,default)
    if not isinstance(value,str) or len(value)>limit or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid '+key)
    return value

def integer(env,key,default,low=1,high=65535):
    value=str(env.get(key,default))
    if not re.fullmatch('[0-9]+',value) or not low<=int(value)<=high:raise ValueError('Invalid '+key)
    return int(value)

def relative(env,key,default):
    value=text(env,key,default,200).replace('\\','/')
    if not value or value.startswith('/') or ':' in value or any(p in ('..','.') for p in value.split('/')):raise ValueError('Invalid relative native path')
    return value

def world_name(env,default,limit):
    value=text(env,'WORLD_NAME',default,limit)
    if not value or value in ('.','..') or any(c in value for c in '/\\:'):raise ValueError('World name must remain a native world name, not a path')
    return value

def roles(env,keys,offsets=()):
    primary=integer(env,'SERVER_PORT',27015);raw=env.get('VOLTRA_ALLOCATED_PORTS','')
    if not re.fullmatch('[0-9]+(?:,[0-9]+)*',raw):raise ValueError('Missing allocations')
    available={int(p) for p in raw.split(',')};used={primary};result={'primary':primary}
    if primary not in available or any(not 1<=p<=65535 for p in available):raise ValueError('Invalid allocations')
    for offset in offsets:
        port=primary+offset
        if port not in available or port in used:raise ValueError('Missing native offset port')
        used.add(port);result[str(offset)]=port
    for key in keys:
        if env.get(key):
            port=integer(env,key,0)
            if port not in available or port in used:raise ValueError('Native roles require distinct allocated ports')
            used.add(port);result[key]=port
    for key in keys:
        if key not in result:
            free=sorted(available-used)
            if not free:raise ValueError('Missing allocated '+key)
            result[key]=free[0];used.add(free[0])
    return result

def patch_properties(content,values):
    seen=set();lines=[];newline='\r\n' if '\r\n' in content else '\n'
    for line in content.splitlines(keepends=True):
        match=re.match(r'^(\s*)([^#!\s][^=]*?)(\s*=)([^\r\n]*)(\r?\n)?$',line)
        if match and match[2].strip() in values:
            key=match[2].strip()
            if key in seen:raise ValueError('Duplicate managed property')
            seen.add(key);line=match[1]+key+match[3]+str(values[key])+(match[5] or '')
        lines.append(line)
    if lines and not lines[-1].endswith(('\n','\r')):lines[-1]+=newline
    lines.extend(key+'='+str(value)+newline for key,value in values.items() if key not in seen)
    return ''.join(lines)

def patch_holdfast(content,values):
    global_lines=[];rotation=[];seen=set();in_rotation=False;active_rotation=False
    for line in content.splitlines(keepends=True):
        marker=line.strip()
        if marker=='!map_rotation start':in_rotation=True;active_rotation=True
        if in_rotation:
            if active_rotation and re.match(r'^\s*maximum_players\s+',line) and 'maximum_players' in values:
                ending='\r\n' if line.endswith('\r\n') else '\n'
                rotation.append('maximum_players '+str(values['maximum_players'])+ending)
            else:rotation.append(line)
            if marker=='!map_rotation end':active_rotation=False
            continue
        if line.strip()=='# Voltra managed server fields':continue
        match=re.match(r'^\s*([a-z_]+)\s+(.*?)(?:\r?\n)?$',line)
        if match and match[1] in values:
            if match[1] in seen:raise ValueError('Duplicate managed Holdfast global')
            seen.add(match[1]);continue
        global_lines.append(line)
    prefix=''.join(global_lines)
    if prefix and not prefix.endswith('\n'):prefix+='\n'
    return prefix+'# Voltra managed server fields\n'+''.join(k+' '+str(v)+'\n' for k,v in values.items())+''.join(rotation)

def json_unique(content):
    def pairs(items):
        result={}
        for key,value in items:
            if key in result:raise ValueError('Duplicate native JSON key')
            result[key]=value
        return result
    return json.loads(content,object_pairs_hook=pairs)

def write_config(root,target,updated):
    target=confined(root,target);old=target.read_text(encoding='utf-8-sig') if target.exists() else None
    if old!=updated:
        if old is not None:native.private_write(confined(root,root/'.voltra/steam-native-next-config'/str(time.time_ns())),old)
        native.private_write(target,updated)
    else:target.chmod(0o600)

@contextlib.contextmanager
def preserve(root):
    state=confined(root,root/'.voltra/steam-native-next-preserve');state.mkdir(parents=True,exist_ok=True);manifest=confined(root,state/'publisher.json');old=json.loads(manifest.read_text()) if manifest.exists() else {}
    excluded={'.voltra','.steam','steamapps','steamcmd','.cache'}
    files=lambda:[p for p in root.rglob('*') if not any(x in excluded for x in p.relative_to(root).parts) and p.is_file()]
    records=[]
    with tempfile.TemporaryDirectory(dir=state) as tmp:
        for path in files():
            confined(root,path);name=path.relative_to(root).as_posix()
            protected=any(p.lower() in ('savegames','worlds','saves','oxide','plugins','configs','permissions','workshop') for p in path.relative_to(root).parts[:-1]) or path.suffix.lower() in ('.properties','.json','.cfg','.txt','.xml','.ini','.cs','.db','.sqlite','.bak')
            if not protected and (path.name in {v[1] for v in GAMES.values()} or old.get(name)==release.sha256(path)):continue
            info=path.stat();backup=Path(tmp)/str(len(records));shutil.copyfile(path,backup)
            records.append({'path':name,'target':name,'backup':str(backup),'uid':info.st_uid,'gid':info.st_gid,'mode':info.st_mode&0o7777,'atime_ns':info.st_atime_ns,'mtime_ns':info.st_mtime_ns,'link':None})
        try:
            yield
            native.private_write(manifest,json.dumps({p.relative_to(root).as_posix():release.sha256(p) for p in files()}))
        finally:
            restore=helper('source-install').restore_file
            for record in records:restore(root,record)

def unzip(root,archive):
    with zipfile.ZipFile(archive) as source:
        seen=set();total=0
        for entry in source.infolist():
            parts=PurePosixPath(entry.filename).parts;mode=entry.external_attr>>16
            if not parts or entry.filename.startswith('/') or '\\' in entry.filename or any(p in ('..','.') or ':' in p for p in parts) or entry.filename in seen or mode&0o170000==0o120000:raise ValueError('Unsafe native ZIP member')
            seen.add(entry.filename);total+=entry.file_size
            if total>1024**3:raise ValueError('Oversized native ZIP')
            confined(root,root/entry.filename)
        for entry in source.infolist():
            target=confined(root,root/entry.filename)
            if entry.is_dir():target.mkdir(parents=True,exist_ok=True);continue
            target.parent.mkdir(parents=True,exist_ok=True)
            with source.open(entry) as inp,target.open('wb') as out:shutil.copyfileobj(inp,out)
            target.chmod(0o755 if entry.external_attr>>16&0o111 else 0o644)

def plugins(root,selection):
    names=[p.strip().replace(' ','') for p in selection.split(',') if p.strip()]
    if any(not re.fullmatch('[A-Za-z0-9][A-Za-z0-9_-]{0,100}',p) for p in names) or len(names)!=len(set(names)) or len(names)>100:raise ValueError('Invalid plugin selection')
    folder=confined(root,root/'oxide/plugins');folder.mkdir(parents=True,exist_ok=True);receipt=confined(root,root/'.voltra/hurtworld-plugins.json');records=json.loads(receipt.read_text()) if receipt.exists() else {}
    for name in names:
        target=confined(root,folder/(name+'.cs'))
        if target.exists():continue  # Keep operator-edited source and its license.
        url='https://umod.org/plugins/'+name+'.cs'
        with urllib.request.urlopen(url,timeout=60) as response:
            final=response.geturl()
            if not final.startswith('https://umod.org/'):raise ValueError('Plugin redirected outside publisher')
            data=response.read(8*1024**2+1)
        if len(data)>8*1024**2 or b'<html' in data[:1024].lower() or b'<!doctype' in data[:1024].lower() or b'[Info(' not in data or b'namespace Oxide.Plugins' not in data:raise ValueError('Invalid C# plugin response')
        native.private_write(target,data.decode('utf-8-sig'));records[name]={'url':url,'sha256':release.sha256(target),'bytes':target.stat().st_size,'license':'Per-plugin author license retained in selected source; no assumption all uMod plugins share the framework MIT license'}
    native.private_write(receipt,json.dumps(records))

def install(root,game,env):
    root=Path(root).resolve();app,binary=GAMES[game]
    if env.get('SRCDS_APPID',str(app))!=str(app):raise ValueError('Wrong native Steam application')
    target=confined(root,root/'holdfastnaw-dedicated') if game=='holdfast' else root;target.mkdir(parents=True,exist_ok=True);options=dict(env)
    if game=='holdfast':
        flags=shlex.split(text(env,'EXTRA_FLAGS','',100))
        if flags:
            if len(flags) not in (2,4) or flags[0]!='-beta' or len(flags)==4 and flags[2]!='-betapassword':raise ValueError('Use -beta branch and optional -betapassword value')
            options['SRCDS_BETAID']=flags[1]
            if len(flags)==4:options['SRCDS_BETAPASS']=flags[3] # Shared helper explicitly gates unverified private Steam transport.
    with preserve(root):
        steam.update(target,app,options,required=(binary,))
        if game=='holdfast':
            config=confined(root,target/'configs'/relative(env,'SERVER_CONFIG_PATH','serverconfig_default.txt'))
            if not config.exists():config.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(confined(root,target/'serverconfig_default.txt'),config);config.chmod(0o600)
            for bits in ('32','64'):
                source=confined(root,target/'.steam'/('sdk'+bits)/'steamclient.so');destination=confined(root,root/'.steam'/('sdk'+bits)/'steamclient.so')
                if source.exists():destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,destination)
        elif game=='colony':
            config=confined(root,root/'server.config.json')
            if not config.exists():
                with tempfile.TemporaryDirectory(dir=root/'.voltra') as temp:
                    downloaded=Path(temp)/'config.json';release.download(COLONY_CONFIG,downloaded);shutil.copyfile(downloaded,config);config.chmod(0o600)
        elif game=='rising':
            config=confined(root,root/'server.properties')
            if not config.exists():shutil.copyfile(confined(root,root/'server.example.properties'),config);config.chmod(0o600)
        elif game=='hurtworld':
            for bits,arch in (('32','x86'),('64','x86_64')):
                source=confined(root,root/'.steam'/('sdk'+bits)/'steamclient.so');destination=confined(root,root/'Hurtworld_Data/Plugins'/arch/'steamclient.so')
                if source.exists():destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,destination)
            if integer(env,'INSTALL_OXIDE',0,0,1):
                with tempfile.TemporaryDirectory(dir=root/'.voltra') as temp:
                    archive=Path(temp)/'oxide.zip';release.download(OXIDE,archive);unzip(root,archive)
                plugins(root,text(env,'INSTALL_PLUGINS','',12000))

def configure(root,game,env):
    root=Path(root).resolve();secret=[]
    if game=='colony':
        ports=roles(env,['SERVER_STEAMPORT']);target=confined(root,root/'server.config.json');config=json_unique(target.read_text(encoding='utf-8-sig'))
        sections=[k for k in ('NewOptions','LoadOptions') if k in config]
        if len(sections)!=1 or not isinstance(config[sections[0]],dict) or not isinstance(config.get('ServerSettings'),dict):raise ValueError('Expected one native Colony world mode and ServerSettings')
        config[sections[0]]['WorldName']=world_name(env,'Pterodactyl',32)
        config['ServerSettings'].update({'ServerName':text(env,'SERVER_NAME','Pterodactyl',32),'MaxPlayerCount':integer(env,'MAX_PLAYERS',10,1,64),'ServerGamePort':ports['primary'],'ServerIP':'0.0.0.0'})
        write_config(root,target,json.dumps(config,ensure_ascii=False,indent=2)+'\n');secret.extend(str(config['ServerSettings'].get(key,'')) for key in ('ServerPassword','RCONPassword'))
        return [str(root/'colonyserver.x86_64'),'-batchmode','-nographics','+server.config',str(target),'+server.steamport',str(ports['SERVER_STEAMPORT'])],secret
    if game=='hurtworld':
        ports=roles(env,['QUERY_PORT']);name=text(env,'HOSTNAME','A Hurtworld Server',50)
        if any(c in name for c in ';"\\'):raise ValueError('Hurtworld command language cannot represent this server name faithfully')
        admins=text(env,'ADMINS','',17)
        if admins and not re.fullmatch('[0-9]{17}',admins):raise ValueError('Expected one SteamID64 administrator')
        commands=['host '+str(ports['primary']),'queryport '+str(ports['QUERY_PORT']),'maxplayers '+str(integer(env,'MAX_PLAYERS',60,1,2147483647)),'servername '+name,'creativemode '+str(integer(env,'CREATIVE_MODE',0,0,1))]+(['addadmin '+admins] if admins else [])
        return [str(root/'Hurtworld.x86_64'),'-batchmode','-nographics','-exec',';'.join(commands),'-logfile','-'],secret
    if game=='holdfast':
        ports=roles(env,['SERVER_COMM_PORT','SERVER_QUERY_PORT']);config_path=relative(env,'SERVER_CONFIG_PATH','serverconfig_default.txt');archive=relative(env,'SERVER_LOG_ARCHIVE_PATH','logs_archive');folder=confined(root,root/'holdfastnaw-dedicated');target=confined(root,folder/'configs'/config_path)
        values={'server_port':ports['primary'],'steam_communications_port':ports['SERVER_COMM_PORT'],'steam_query_port':ports['SERVER_QUERY_PORT'],'server_name':text(env,'SERVER_NAME','Holdfast',200),'server_welcome_message':text(env,'MOTD','Welcome!',500),'server_region':text(env,'REGION','europe',50),'server_admin_password':text(env,'ADMIN_PASS','',50),'server_password':text(env,'SERVER_PASS','',50),'maximum_players':integer(env,'PLAYERS',32,1,250)}
        if not values['server_admin_password']:raise ValueError('Original Holdfast administrator password is required')
        write_config(root,target,patch_holdfast(target.read_text(encoding='utf-8-sig'),values));secret.extend((values['server_admin_password'],values['server_password']))
        argv=[str(folder/'Holdfast NaW'),'-startserver','-batchmode','-nographics','-screen-width','320','-screen-height','240','-screen-quality','Fastest','-framerate',str(integer(env,'FPSMAX',60,1,1000)),'--serverheadless','-serverConfigFilePath',str(target),'-logFile',str(confined(root,folder/'logs_output'/('output_'+config_path))),'-logArchivesDirectory',str(confined(root,folder/archive)),'-p',str(ports['primary'])]
        for flag,sub,prefix in [('adminCommandsLogFilePath','logs_adminactions','admin_'),('playersLogFilePath','logs_playerlogin','players_'),('scoreboardLogFilePath','logs_score','scorelog_'),('chatLogFilePath','logs_chat','chatlog_')]:
            path=confined(root,folder/sub/(prefix+config_path));path.parent.mkdir(parents=True,exist_ok=True);argv.extend(('-'+flag,str(path)))
        for flag,name in [('workshopDataPath','workshop'),('micSpammersPlayersFilePath','micspammers.txt'),('mutedVoipPlayersFilePath','mutedplayersvoip.txt'),('mutedChatPlayersFilePath','mutedplayerschat.txt'),('bannedPlayersFilePath','bannedplayers.txt')]:argv.extend(('-'+flag,str(confined(root,folder/name))))
        (folder/'logs_output'/('output_'+config_path)).parent.mkdir(parents=True,exist_ok=True);(folder/archive).mkdir(parents=True,exist_ok=True)
        return argv,secret
    if game=='rising':
        rcon=text(env,'RCON','false',5)
        if rcon not in ('true','false'):raise ValueError('Invalid RCON switch')
        ports=roles(env,['RCON_PORT'] if rcon=='true' else [],offsets=(-1,));password=text(env,'SRV_PW','',255);admin=text(env,'RCON_PASS','',255)
        if rcon=='true' and len(admin)<6:raise ValueError('RCON password requires six characters')
        mode=text(env,'GAME_MODE','Survival',20)
        if mode not in ('','Survival','Creative'):raise ValueError('Invalid world mode')
        rcon_port=ports['RCON_PORT'] if rcon=='true' else integer({**env,'RCON_PORT':env.get('RCON_PORT') or '4253'},'RCON_PORT',4253)
        values={'Server_Name':text(env,'SRV_NAME','Rising World',40),'Server_Password':password,'World_GameMode':mode,'World_Name':world_name(env,'myworld',20),'RCON_Enabled':rcon,'RCON_Password':admin,'RCON_Port':rcon_port,'Server_Port':ports['primary']}
        target=confined(root,root/'server.properties');old=target.read_text(encoding='utf-8-sig')
        if re.search(r'(?m)^Password=',old):values['Password']=password
        write_config(root,target,patch_properties(old,values));secret.extend((password,admin));return [str(root/'RisingWorldServer.x64'),'+Server_Port='+str(ports['primary'])],secret
    raise ValueError('Unknown Steam/native recipe')

def holdfast_redaction_values(values):
    """Mask full credentials and publisher-clipped character/UTF-8 prefixes."""
    result=[]
    for value in values:
        if not value:continue
        # Redactor accepts strings. Drop an incomplete final UTF-8 code point;
        # masking its complete prefix also prevents a raw 32-byte secret match.
        for candidate in (value,value[:32],value.encode('utf-8')[:32].decode('utf-8',errors='ignore')):
            if candidate and candidate not in result:result.append(candidate)
    return result


class HoldfastLog:
    """Forward only fresh publisher log bytes, with anchored no-symlink reads."""
    def __init__(self, root, path, console, credentials):
        self.root=Path(root).resolve();self.relative=Path(path).relative_to(self.root)
        if not self.relative.parts or any(p in ('.','..') for p in self.relative.parts):raise ValueError('Invalid Holdfast log path')
        self.console=console;self.credentials=credentials;self.done=threading.Event();self.error=None
        self.previous=self.identity();self.previous_prefix=self.prefix();self.thread=threading.Thread(target=self.follow,daemon=True)
    def opened(self):
        descriptor=os.open(self.root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            for part in self.relative.parts[:-1]:
                following=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=descriptor);os.close(descriptor);descriptor=following
            result=os.open(self.relative.parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=descriptor)
            if not stat.S_ISREG(os.fstat(result).st_mode):os.close(result);raise ValueError('Holdfast log must be a regular file')
            return result
        finally:os.close(descriptor)
    def identity(self):
        try:
            descriptor=self.opened()
            try:
                s=os.fstat(descriptor);return (s.st_dev,s.st_ino,s.st_mtime_ns,s.st_size)
            finally:os.close(descriptor)
        except FileNotFoundError:return None
    def prefix(self):
        try:
            descriptor=self.opened()
            try:return os.pread(descriptor,256,0)
            finally:os.close(descriptor)
        except FileNotFoundError:return b''
    def follow(self):
        redactor=self.console.Redactor(self.credentials)
        position=self.previous[3] if self.previous else 0;inode=self.previous[:2] if self.previous else None;fresh=False;prefix=self.previous_prefix
        try:
            while True:
                closing=self.done.is_set()
                try:
                    descriptor=self.opened()
                    try:
                        s=os.fstat(descriptor);identity=(s.st_dev,s.st_ino,s.st_mtime_ns,s.st_size)
                        if identity!=self.previous:fresh=True
                        if fresh:
                            if inode!=(s.st_dev,s.st_ino)or s.st_size<position or os.pread(descriptor,len(prefix),0)!=prefix:position=0
                            prefix=os.pread(descriptor,256,0)
                            inode=(s.st_dev,s.st_ino);os.lseek(descriptor,position,os.SEEK_SET)
                            remaining=262144
                            while remaining>0:
                                block=os.read(descriptor,min(65536,remaining))
                                if not block:break
                                position+=len(block);remaining-=len(block);sys.stdout.buffer.write(redactor.feed(block));sys.stdout.buffer.flush()
                    finally:os.close(descriptor)
                except FileNotFoundError:pass
                if closing:break
                self.done.wait(.05)
            sys.stdout.buffer.write(redactor.feed(b'',final=True));sys.stdout.buffer.flush()
        except (OSError,ValueError) as error:self.error=error
    def start(self):self.thread.start()
    def finish(self):
        self.done.set();self.thread.join(timeout=5)
        if self.thread.is_alive()or self.error:raise ValueError('Holdfast native log forwarding failed')


def run(root,game,env):
    if env.get('VOLTRA_STEAM_AUTO_UPDATE','0')=='1':install(root,game,env)
    argv,secrets=configure(root,game,env);environment=dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH'):environment.pop(key,None)
    environment['HOME']=str(root)
    if game=='rising':environment['LD_LIBRARY_PATH']=str(root/'linux64')+':'+text(env,'VOLTRA_NATIVE_LD_LIBRARY_PATH','/linux64',4096)
    console=helper('native-console')
    if game=='holdfast':
        secrets=holdfast_redaction_values(secrets)
        log=HoldfastLog(root,argv[argv.index('-logFile')+1],console,secrets);log.start()
        try:code=console.run(root,argv,environment,'\x03',secrets,terminal_input=True)
        finally:log.finish()
    else:code=console.run(root,argv,environment,'\x03',secrets,terminal_input=True)
    return code if code>=0 else 128-code

if __name__=='__main__':
    try:
        action,game=sys.argv[1:3];root=Path.cwd();env=dict(os.environ)
        if action=='install':install(root,game,env);sys.exit(0)
        if action=='run':sys.exit(run(root,game,env))
        raise ValueError('Unknown action')
    except (ValueError,OSError,KeyError):print('Native setup failed. Review configuration, typed ports, mod compatibility and public Steam/branch requirements; private Steam credentials remain unsupported.',file=sys.stderr);sys.exit(1)
