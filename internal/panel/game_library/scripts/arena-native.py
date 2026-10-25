#!/usr/bin/env python3
"""MIT. Lawful operator-file IW4x and R5Reloaded dedicated adapters."""
import hashlib
import contextlib
import importlib.util
import os
from pathlib import Path
import re
import shlex
import signal
import struct
import subprocess
import sys
import time
import shutil
import tempfile

def helper(name):
    path=Path(__file__).with_name(name+'.py')
    if not path.exists():path=path.with_name(name.replace('-','_')+'.py')
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules.setdefault(name.replace('-','_'),module);spec.loader.exec_module(module);return module

steam=helper('steam-template');retention=helper('melee-native')
confined=retention.confined;text=retention.text;integer=retention.integer

def regular(root,name,minimum=1,maximum=None):
    path=confined(root,root/name)
    if not path.is_file() or path.stat().st_size<minimum or maximum and path.stat().st_size>maximum:raise ValueError('Upload the legitimate required server file: '+name)
    return path

def pe(root,name,machine):
    path=regular(root,name,minimum=128)
    with path.open('rb') as stream:
        header=stream.read(64)
        if header[:2]!=b'MZ':raise ValueError('Server executable lacks a Windows PE header')
        offset=struct.unpack_from('<I',header,60)[0]
        if not 64<=offset<=path.stat().st_size-24:raise ValueError('Invalid Windows PE header offset')
        stream.seek(offset);header=stream.read(24)
        if header[:4]!=b'PE\0\0' or struct.unpack_from('<H',header,4)[0]!=machine:raise ValueError('Wrong native server executable architecture')
    return path

def file_tree(root,name,suffix):
    directory=confined(root,root/name)
    if not directory.is_dir():raise ValueError('Upload your legitimate complete server asset directory: '+name)
    files=[]
    for path in directory.rglob('*'):
        confined(root,path)
        if path.is_symlink() or not path.is_dir() and not path.is_file():raise ValueError('Operator assets contain links or special files')
        if path.is_file() and path.suffix.lower()==suffix and path.stat().st_size:files.append(path)
    if not files:raise ValueError('Required native server assets are missing from '+name)
    return files

def sha256(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

@contextlib.contextmanager
def preserve(root):
    # Player state is always protected, even if its bytes happened to match the
    # last publisher baseline. The common helper handles configs/mods/unknowns.
    directory=confined(root,root/'players');records=[];base=confined(root,root/'.voltra/arena-retention');base.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.arena-retention-',dir=base) as temporary:
        if directory.exists():
            for path in directory.rglob('*'):
                confined(root,path)
                if path.is_symlink() or not path.is_dir() and not path.is_file():raise ValueError('Player state contains links or special files')
                if not path.is_file():continue
                value=path.stat();backup=Path(temporary)/str(len(records));shutil.copyfile(path,backup);backup.chmod(0o600);name=path.relative_to(root).as_posix()
                records.append({'path':name,'target':name,'backup':str(backup),'uid':value.st_uid,'gid':value.st_gid,'mode':value.st_mode&0o7777,'atime_ns':value.st_atime_ns,'mtime_ns':value.st_mtime_ns,'link':None})
        try:
            with retention.preserve(root):yield
        finally:
            restore=helper('source-install').restore_file
            for record in records:confined(root,root/record['path']);restore(root,record)

def validate(root,game,env):
    mode=env.get('INSTALL_MODE','existing')
    if mode!='existing':
        if game=='iw4x':raise ValueError('Private Steam10190 acquisition is unsupported. Upload a legitimate owned MW2 Multiplayer server prepared with maintainer tooling; no account credentials were sent.')
        raise ValueError('Automatic R5 archive acquisition is unavailable until package licensing/integrity are independently verified. Obtain the supported dedicated package through legitimate maintainer channels; DL_URL is not silently followed.')
    port=integer(env,'SERVER_PORT',28960 if game=='iw4x' else 37015)
    allocated=env.get('VOLTRA_ALLOCATED_PORTS','')
    if not re.fullmatch('[0-9]+(?:,[0-9]+)*',allocated) or port not in {int(p) for p in allocated.split(',')}:raise ValueError('The native game port must be assigned')
    if game=='iw4x':
        if env.get('SRCDS_APPID','10190')!='10190' or env.get('WINDOWS_INSTALL','1')!='1':raise ValueError('Original IW4x MW2 Multiplayer/Windows selection is required')
        pe(root,'iw4x.exe',0x14c);pe(root,'iw4x.dll',0x14c)
        file_tree(root,'main','.iwd');file_tree(root,'zone','.ff');file_tree(root,'iw4x','.ff')
        regular(root,'userraw/server.cfg',maximum=8*1024**2)
        if env.get('WINETRICKS_RUN','vcrun2022')!='vcrun2022':raise ValueError('Original reviewed vcrun2022 runtime is required')
        automatic=env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','1'))
        if automatic not in ('0','1'):raise ValueError('Auto Update must be0 or1')
        if automatic=='1':
            launcher=regular(root,'iw4x-launcher',minimum=6);pin=env.get('IW4X_LAUNCHER_SHA256','')
            with launcher.open('rb') as stream:header=stream.read(6)
            if header!=b'\x7fELF\x02\x01' or not re.fullmatch('[a-fA-F0-9]{64}',pin) or sha256(launcher)!=pin.lower():raise ValueError('Automatic updates require your independently reviewed Linux64 maintainer launcher and matching IW4X_LAUNCHER_SHA256; otherwise set Auto Update0')
    elif game=='r5':
        pe(root,'r5apex_ds.exe',0x8664);file_tree(root,'paks/Win64_Server','.rpak')
        directory=confined(root,root/'platform/cfg')
        if not directory.is_dir():raise ValueError('Upload the supported R5 native platform/cfg configuration set')
    else:raise ValueError('Unknown original arena recipe')
    return port

def iw4_text(value):
    if any(c in value for c in '"\\\r\n\0'):raise ValueError('IW4 config values cannot contain quotes, backslashes or controls')
    return '"'+value+'"'

def patch_iw4(content,name,password):
    values={'sv_hostname':iw4_text(name),'g_password':iw4_text(password)};seen=set();lines=[]
    newline='\r\n' if '\r\n' in content else '\n'
    for line in content.splitlines(keepends=True):
        match=re.match(r'^(\s*)(?:(seta?)\s+)?(sv_hostname|g_password)\s+',line)
        if match:
            key=match[3]
            if key in seen:raise ValueError('Duplicate managed IW4 config command')
            quoted=False;comment=''
            for index,char in enumerate(line):
                if char=='"' and (index==0 or line[index-1]!='\\'):quoted=not quoted
                if not quoted and line.startswith('//',index):comment=' '+line[index:].rstrip('\r\n');break
            seen.add(key);line=match[1]+(('set ' if key=='g_password' else '')+key+' '+values[key])+comment+newline
        lines.append(line)
    if lines and not lines[-1].endswith(('\r','\n')):lines[-1]+=newline
    for key,value in values.items():
        if key not in seen:lines.append(('set ' if key=='g_password' else '')+key+' '+value+newline)
    return ''.join(lines)

def extra_args(value):
    try:tokens=shlex.split(value)
    except ValueError:raise ValueError('Unbalanced R5 arguments') from None
    if len(tokens)>64:raise ValueError('Too many R5 arguments')
    forbidden=('-port','+hostname','+launchplaylist','-insecure','-disableanticheat','-noauth')
    # Preserve arbitrary literal options/values, never shell or native command
    # chaining. Authentication/security bypass options are not introduced.
    for token in tokens:
        if any(c in token for c in ';\r\n\0`') or token in ('&','&&','|','||') or token.split('=',1)[0].lower() in forbidden:raise ValueError('Use typed managed arguments; command chains and unsupported auth/security overrides are refused')
    for index,token in enumerate(tokens):
        if token.lower() in ('+exec','-exec'):
            if index+1>=len(tokens):raise ValueError('Native exec requires a config filename')
            path=tokens[index+1]
            if not re.fullmatch('[A-Za-z0-9_./-]+',path) or path.startswith('/') or any(part in ('','..','.') for part in path.split('/')):raise ValueError('Native exec must use an operator config relative to the server')
    return tokens

def configure(root,game,env):
    root=Path(root).resolve();port=validate(root,game,env);secrets=[]
    if game=='iw4x':
        mod=text(env,'MOD_DIR','',255)
        if mod:
            if not re.fullmatch('[A-Za-z0-9_./-]+',mod) or mod.startswith('/') or any(p in ('','..','.') for p in mod.split('/')):raise ValueError('Mod Dir must be a literal volume-relative directory')
            if not confined(root,root/mod).is_dir():raise ValueError('Upload the legitimate server-compatible mod directory')
        path=regular(root,'userraw/server.cfg',maximum=8*1024**2)
        with path.open(encoding='utf-8-sig',newline='') as stream:before=stream.read()
        password=text(env,'SERVER_PASSWORD','',100);updated=patch_iw4(before,text(env,'SERVER_NAME','Pterodactyl IW4X',100),password)
        secrets.append(password)
        for match in re.finditer(r'^\s*(?:seta?\s+)?rcon_password\s+"?([^"\r\n]+)',before,re.MULTILINE):secrets.append(match[1].strip())
        steam._publish(root,'userraw/server.cfg',lambda output:output.write(updated.encode()),0o600)
        argv=['wine',str(root/'iw4x.exe'),'-dedicated','-stdout','+set','fs_game',mod,'+set','sv_lanonly','0','+set','net_port',str(port),'+exec','server.cfg','+set','party_enable','0','+map_rotate']
    else:
        playlist=text(env,'PLAYLIST','fs_dm',20)
        if not re.fullmatch('[A-Za-z0-9_.-]+',playlist):raise ValueError('Playlist must be a literal native playlist ID')
        name=text(env,'SERVER_NAME','A Pterodactyl Server',50)
        if any(c in name for c in '";\\'):raise ValueError('Native R5 hostname cannot contain command delimiters')
        args=extra_args(text(env,'ARGS','',200));argv=['wine',str(root/'r5apex_ds.exe'),'-noconsole','-port',str(port),'+launchplaylist',playlist,'+hostname',name,*args]
        for name in ('platform/cfg/tools/rcon_server.cfg','platform/cfg/tools/rcon_server','platform/cfg/tools/rcon_server_dev.cfg'):
            path=confined(root,root/name)
            if path.is_file():
                if path.stat().st_size>1024**2:raise ValueError('R5 RCON config exceeds supported size')
                for match in re.finditer(r'^\s*(?:sv_rcon_password|rcon_password|rcon_key)\s+"?([^"\r\n]+)',path.read_text(),re.MULTILINE):secrets.append(match[1].strip())
    return argv,tuple(secrets)

def install(root,game,env):
    root=Path(root).resolve();validate(root,game,env)
    # Validate all arguments/config first, then publish managed settings. No
    # operator-supplied binary is executed by a root-owned installer.
    configure(root,game,env)
    if game=='iw4x' and env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','1'))=='1':
        launcher=regular(root,'iw4x-launcher');launcher.chmod(launcher.stat().st_mode|0o100)
    with preserve(root):pass
    return {'mode':'legitimate-operator-files','native_verified':False}

def run(root,game,env):
    root=Path(root).resolve()
    if game=='iw4x' and env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','1'))=='1' and os.geteuid()==0:raise ValueError('Refusing to run an operator launcher as root; use the unprivileged game runtime')
    argv,secrets=configure(root,game,env);child=dict(env)
    for key in ('PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH','LD_PRELOAD','STEAM_USER','STEAM_PASS','STEAM_AUTH','SERVER_PASSWORD','IW4X_LAUNCHER_SHA256','DL_URL'):child.pop(key,None)
    child['HOME']=str(root);child['DISPLAY']=':99';child['WINEPREFIX']=str(root/'.wine')
    console=helper('native-console')
    display=subprocess.Popen(['Xvfb',':99','-screen','0','1024x768x24','-nolisten','tcp','-noreset'],env=child,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    try:
        for _ in range(100):
            if display.poll() is not None:raise ValueError('Private Wine display failed')
            if Path('/tmp/.X11-unix/X99').exists():break
            time.sleep(.05)
        else:raise ValueError('Private Wine display did not become ready')
        if game=='iw4x' and env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','1'))=='1':
            with preserve(root):
                code=console.run(root,[str(root/'iw4x-launcher'),'--update'],child,'\x03',secrets,terminal_input=True,stop_signal=signal.SIGINT)
            if code!=0:return code
            argv,secrets=configure(root,game,env)
        return console.run(root,argv,child,'\x03',secrets,terminal_input=True,terminal_query_reply=True,terminal_enter_carriage_return=True,stop_signal=signal.SIGINT)
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
        message=str(error)
        for key in ('STEAM_USER','STEAM_PASS','STEAM_AUTH','SERVER_PASSWORD'):
            if os.environ.get(key):message=message.replace(os.environ[key],'[redacted]')
        print('Arena server failed: '+message,file=sys.stderr);sys.exit(1)
