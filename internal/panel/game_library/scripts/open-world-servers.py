#!/usr/bin/env python3
"""MIT. Typed dedicated Onset/JC3MP/LAC setup; native acceptance is separate."""
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
from steam_template import arguments, update
from additional_survival_install import private_bytes


def load(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


release=load('open_world_release','native-release.py')
publisher=load('open_world_publisher','small-native-install.py')
PINS=json.loads(Path(__file__).with_name('open-world-releases.json').read_text())


def confined(root,name):
    path=root/name
    if path.is_symlink() or not path.resolve().is_relative_to(root):raise ValueError('Open-world managed path escapes server volume')
    return path


def integer(value,low=1,high=65535):
    if not re.fullmatch(r'[0-9]{1,10}',str(value)) or not low<=int(value)<=high:raise ValueError('Invalid native numeric control')
    return int(value)


def text(value,limit=4096,line=False):
    if not isinstance(value,str) or len(value)>limit or '\x00' in value or (line and any(c in value for c in '\r\n')):raise ValueError('Invalid native text control')
    return value


def boolean(value):
    if value not in ('0','1','true','false'):raise ValueError('Invalid boolean control')
    return value in ('1','true')


def allocated(env):
    primary=integer(env.get('SERVER_PORT','7777'))
    ports=[integer(p.strip()) for p in env.get('VOLTRA_ALLOCATED_PORTS',str(primary)).split(',')]
    if primary not in ports or len(set(ports))!=len(ports):raise ValueError('Invalid primary/allocation selection')
    return primary,ports


def json_object(body):
    def pairs(items):
        result={}
        for key,value in items:
            if key in result:raise ValueError('Duplicate native JSON key')
            result[key]=value
        return result
    def constant(_):raise ValueError('Non-finite native JSON value')
    value=json.loads(body,object_pairs_hook=pairs,parse_constant=constant)
    if not isinstance(value,dict):raise ValueError('Native configuration must be a JSON object')
    return value


def patch_json(path,values):
    if path.exists() and path.stat().st_size>8*1024**2:raise ValueError('Native config exceeds 8MiB')
    original=path.read_bytes() if path.exists() else None;data=json_object(original.decode('utf-8-sig')) if original is not None else {}
    updated={**data,**values}
    if updated!=data or original is None:private_bytes(path,(json.dumps(updated,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode(),path.stat() if path.exists() else None)


def lac_version(env):
    value=env.get('VER',PINS['lac']['version'])
    if not re.fullmatch(r'[0-9]+(?:\.[0-9]+){1,3}',value):raise ValueError('LAC version must contain numeric components only')
    return value


def lac_identity(env):
    version=lac_version(env)
    if version==PINS['lac']['version']:return dict(PINS['lac'])
    digest=env.get('LAC_ARCHIVE_SHA256','')
    if not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError('Other LAC versions require a reviewed SHA256; no fallback payload will be substituted')
    return {'version':version,'url':'https://www.lacrimesonline.com/builds/LAC_Linux_v'+version+'.zip','sha256':digest}


def configure(root,game,env):
    primary,ports=allocated(env)
    if game=='onset':
        if primary<3 or not {primary-2,primary-1,primary}.issubset(ports):raise ValueError('Onset requires allocated game port and game-1 query/game-2 file ports')
        patch_json(confined(root,'server_config.json'),{'ipaddress':'0.0.0.0','port':primary,'servername':text(env.get('SERVER_NAME','Onset server'),260),'password':text(env.get('SERVER_PASSWORD',''),128),'masterlist':boolean(env.get('PUBLIC_SERVER','true'))})
    elif game=='jc3':
        roles=[]
        for key in ('QUERY_PORT','STEAM_PORT','HTTP_PORT'):
            value=env.get(key,'');chosen=integer(value) if value else next((p for p in ports if p not in [primary,*roles]),None)
            if chosen is None or chosen not in ports or chosen in [primary,*roles]:raise ValueError('JC3MP needs four distinct allocated game/query/Steam/HTTP ports')
            roles.append(chosen)
        patch_json(confined(root,'config.json'),{'host':'0.0.0.0','bind':'0.0.0.0','port':primary,'queryPort':roles[0],'steamPort':roles[1],'httpPort':roles[2],'name':text(env.get('SERVER_NAME','JC3MP server')),'description':text(env.get('SERVER_DESCRIPTION','')),'password':text(env.get('SERVER_PASSWORD',''),30),'maxPlayers':integer(env.get('MAX_PLAYER','32'),1,1000),'maxTickRate':integer(env.get('TICK_RATE','60'),1,1000),'announce':boolean(env.get('PUBLIC_SERVER','true'))})
    elif game=='lac':
        path=confined(root,'.config/unity3d/MA/LAC/ServerConfig.txt');path.parent.mkdir(parents=True,exist_ok=True)
        if path.exists() and path.stat().st_size>8*1024**2:raise ValueError('LAC configuration exceeds bounds')
        original=path.read_bytes() if path.exists() else b'';body=original.decode('utf-8-sig');newline='\r\n' if '\r\n' in body else '\n'
        values={'starting port':str(primary),'max players':str(integer(env.get('MAX_PLAYERS','16'),1,1000)),'map name':text(env.get('MAP_NAME','TrainFacility'),256,True),'share to community':str(boolean(env.get('PUBLIC_SERVER','false'))).lower(),'server language':text(env.get('SERVER_LANGUAGE','English'),64,True),'server password':text(env.get('SERVER_PASSWORD','none'),128,True)}
        admin=env.get('ADMIN_CODE','')
        if admin:
            if not re.fullmatch('[0-9]{1,30}',admin):raise ValueError('LAC administrator code must be numeric')
            values['admin code']=admin
        lines=body.splitlines(keepends=True);seen=set()
        for index,line in enumerate(lines):
            key=line.split('=',1)[0].strip()
            if '=' in line and key in values and not line.lstrip().startswith('#'):
                if key in seen:raise ValueError('Duplicate LAC managed setting')
                seen.add(key);lines[index]=key+'='+values[key]+newline
        updated=''.join(lines)
        if updated and not updated.endswith(('\r','\n')):updated+=newline
        updated+=''.join(key+'='+value+newline for key,value in values.items() if key not in seen)
        if updated.encode()!=original:private_bytes(path,updated.encode(),path.stat() if path.exists() else None)
    else:raise ValueError('Unknown reviewed open-world game')


def preserved_paths(root,game):
    names={'onset':['server_config.json','packages','autostart','plugins'],'jc3':['config.json','packages'],'lac':['.config/unity3d/MA/LAC']}[game]
    paths=[]
    for name in names:
        path=confined(root,name)
        if path.exists():
            candidates=[path,*path.rglob('*')] if path.is_dir() else [path]
            for candidate in candidates:
                confined(root,str(candidate.relative_to(root)))
                if candidate.is_file() or candidate.is_dir():paths.append(candidate)
                else:raise ValueError('Unsupported operator filesystem entry')
    return paths


def install(root,game,env):
    root=Path(root).resolve()
    if game not in ('onset','jc3','lac'):raise ValueError('Unknown reviewed open-world game')
    if game!='lac':
        if game=='onset' and env.get('SRCDS_APPID','1204170')!='1204170':raise ValueError('Onset application identity is fixed')
        platform='windows' if env.get('WINDOWS_INSTALL','0')=='1' else 'linux'
        app=PINS[game]['appid'];arguments(root,app,env,True,platform=platform)
        required=(('OnsetServer.exe',) if platform=='windows' else ('OnsetServer',)) if game=='onset' else (('Server.exe',) if platform=='windows' else ('Server',))
    state=confined(root,'.voltra/open-world-'+game);state.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='operator-',dir=state) as temporary:
        backup=Path(temporary);previous=[]
        for path in preserved_paths(root,game):
            metadata=path.stat();relative=path.relative_to(root);saved=backup/relative
            if path.is_file():saved.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,saved);saved.chmod(0o600)
            previous.append((relative,metadata,path.is_dir()))
        try:
            if game!='lac':receipt=update(root,app,env=env,validate=True,required=required,platform=platform)
            else:
                identity=lac_identity(env)
                with tempfile.TemporaryDirectory(prefix='publisher-',dir=state) as download:
                    stage=Path(download);archive=stage/'publisher.zip';release.download(identity,archive);ready=stage/'ready';ready.mkdir();publisher.extract_zip(archive,ready)
                    binary='LAC_Linux_v'+identity['version']+'.x86_64'
                    if not (ready/binary).is_file():raise ValueError('Publisher archive lacks selected LAC server binary')
                    (ready/binary).chmod(0o755);publisher.publish(root,ready,root,dict(identity,game='open-world-lac'),binary);receipt=identity
            return receipt
        finally:
            for relative,metadata,isdir in previous:
                path=confined(root,str(relative));path.parent.mkdir(parents=True,exist_ok=True)
                if isdir:path.mkdir(exist_ok=True)
                else:
                    fd,tmp=tempfile.mkstemp(prefix='.voltra-restore-',dir=path.parent)
                    try:
                        with os.fdopen(fd,'wb') as output,(backup/relative).open('rb') as source:shutil.copyfileobj(source,output)
                        os.chown(tmp,metadata.st_uid,metadata.st_gid);os.chmod(tmp,metadata.st_mode&0o777);os.replace(tmp,path)
                    finally:
                        if os.path.exists(tmp):os.unlink(tmp)
                os.chown(path,metadata.st_uid,metadata.st_gid);path.chmod(metadata.st_mode&0o777)


def launch(root,game,env):
    root=Path(root).resolve();env=dict(env)
    if game!='lac' and boolean(env.get('AUTO_UPDATE','1')):install(root,game,env)
    if env.get('WINDOWS_INSTALL','0')=='1':raise ValueError('Windows payload acquisition is retained; runtime needs a separately verified Windows/Wine stack')
    configure(root,game,env)
    binary={'onset':'OnsetServer','jc3':'Server','lac':'LAC_Linux_v'+lac_version(env)+'.x86_64'}[game]
    child=dict(env);child['HOME']=str(root);child['XDG_CONFIG_HOME']=str(root/'.config');child['LD_LIBRARY_PATH']=':'.join([str(root),str(root/'linux64'),env.get('LD_LIBRARY_PATH','.')])
    for key in ('PYTHONHOME','PYTHONPATH','STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS'):child.pop(key,None)
    argv=[str(confined(root,binary))]+(['--noinput'] if game=='onset' else [])
    # Replace the wrapper, retaining original native stdin and Wings SIGINT
    # (^C) stop semantics. Passwords remain in native config, never process argv.
    os.chdir(root);os.execvpe(argv[0],argv,child)


if __name__=='__main__':
    action,game=sys.argv[1:3]
    if action=='install':install(Path.cwd(),game,dict(os.environ))
    elif action=='run':launch(Path.cwd(),game,dict(os.environ))
    else:raise ValueError('Unknown reviewed open-world operation')
