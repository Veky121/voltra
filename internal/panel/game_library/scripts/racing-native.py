#!/usr/bin/env python3
"""MIT. Independent launch/install adapter for unmodified BeamMP and KissMP."""
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sys
import tempfile
import tomllib
import urllib.error
import urllib.request
import zipfile

def helper(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

release=helper('native-release');config=helper('native-config')
REPOS={'beammp':'BeamMP/BeamMP-Server','kissmp':'TheHellBox/KISS-multiplayer'}
PINNED={
 'beammp':{'version':'v3.9.3','url':'https://github.com/BeamMP/BeamMP-Server/releases/download/v3.9.3/BeamMP-Server.debian.12.x86_64','sha256':'8d24d463542be2e1d0e38c5eb58a1c168aa8c1a1309170a8bbdcdbdc27e2d6f1','bytes':12151000},
 'kissmp':{'version':'v0.8.0','url':'https://github.com/TheHellBox/KISS-multiplayer/releases/download/v0.8.0/KissMP_v0.8.0.zip','sha256':'b0de0d10608e892e2a10faf8fba53177c9dd5a46a2ade5025848bfd59be1a05d','bytes':23342449}}

def number(env,key,default,low,high):
    value=str(env.get(key,default))
    if not re.fullmatch(r'[0-9]+',value) or not low<=int(value)<=high:raise ValueError('Invalid '+key)
    return int(value)

def text(env,key,default,limit=1024):
    value=env.get(key,default)
    if not isinstance(value,str) or len(value)>limit or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid '+key)
    return value

def boolean(env,key,default):
    value=str(env.get(key,default)).lower()
    if value not in ('true','false','0','1'):raise ValueError('Invalid '+key)
    return value in ('true','1')

def owned(root,path):
    path=Path(path)
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):raise ValueError('Racing path escapes volume')
    return path

def write(path,data):
    old=path.stat() if path.exists() else None
    config.private_write(path,data)
    if old:
        path.chmod(old.st_mode&0o777);os.chown(path,old.st_uid,old.st_gid)

def configure(root,game,env):
    root=Path(root).resolve();port=number(env,'SERVER_PORT',30814 if game=='beammp' else 3698,1024,65535)
    if game=='beammp':
        path=owned(root,root/'ServerConfig.toml');previous=path.read_text() if path.exists() else ''
        tomllib.loads(previous)
        values={'Name':text(env,'NAME','BeamMP Server',128),'Description':text(env,'DESCRIPTION','BeamMP Default Description',128),
                'AuthKey':text(env,'AUTHKEY','',64),'Map':text(env,'MAP','/levels/gridmap_v2/info.json',1024),
                'Port':port,'MaxPlayers':number(env,'MAX_PLAYERS',6,1,100),'MaxCars':number(env,'MAX_CARS',1,0,10),
                'Private':boolean(env,'PRIVATE','false'),'LogChat':boolean(env,'LOGCHAT','true')}
        if not values['AuthKey']:raise ValueError('BeamMP v3.9.3 requires your own Keymaster authentication key, including private servers')
        # TOML requires Unicode scalar values; JSON surrogate-pair escapes for
        # astral characters are invalid TOML. Write UTF-8 directly instead.
        updated=config.patch_ini(previous,{'General':{k:json.dumps(v,ensure_ascii=False) for k,v in values.items()}})
        tomllib.loads(updated)
    elif game=='kissmp':
        path=owned(root,root/'config.json');previous=path.read_text() if path.exists() else ''
        data=json.loads(previous) if previous else {}
        if not isinstance(data,dict):raise ValueError('KissMP config must be an object')
        # Native serde(default) creates a random identifier for missing fields
        # without writing it back. Materialize publisher defaults once so the
        # server identity survives restarts, as its original generated config did.
        defaults={'server_name':'Vanilla KissMP Server','description':'Vanilla KissMP Server','map':'/levels/smallgrid/info.json',
                  'max_players':8,'tickrate':60,'max_vehicles_per_client':3,'show_in_server_list':False,'upnp_enabled':False,
                  'server_identifier':secrets.token_hex(10),'mods':None,'require_scripts':False}
        for key,value in defaults.items():data.setdefault(key,value)
        data['port']=port
        # Empty dashboard values leave existing native file values in control.
        for key,native,default in [('SERVER_NAME','server_name','Vanilla KissMP Server'),('DESCRIPTION','description','Vanilla KissMP Server'),('MAP','map','/levels/smallgrid/info.json')]:
            if env.get(key):data[native]=text(env,key,default)
        for key,native,low,high in [('MAX_PLAYERS','max_players',1,255),('TICKRATE','tickrate',1,255),('MAX_CARS','max_vehicles_per_client',0,255)]:
            if env.get(key):data[native]=number(env,key,8,low,high)
        for key,native in [('PUBLIC_SERVER','show_in_server_list'),('UPNP_ENABLED','upnp_enabled'),('REQUIRE_SCRIPTS','require_scripts')]:
            if env.get(key):data[native]=boolean(env,key,'false')
        updated=json.dumps(data,indent=2,ensure_ascii=True)+'\n'
    else:raise ValueError('Unsupported racing game')
    if previous!=updated:
        if previous:
            backup=owned(root,root/'.voltra'/game/'config-backups');backup.mkdir(parents=True,exist_ok=True)
            import time
            config.private_write(backup/(str(time.time_ns())+'-'+path.name),previous)
        write(path,updated)
    return path

def select_release(game,env):
    version=text(env,'VERSION',PINNED[game]['version'],64)
    if version==PINNED[game]['version']:return dict(PINNED[game])
    if not re.fullmatch(r'[A-Za-z0-9._-]+',version):raise ValueError('Invalid release version')
    base='https://api.github.com/repos/'+REPOS[game]+'/releases/'
    url=base+('latest' if version=='latest' else 'tags/'+version)
    def fetch(url):
        with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Voltra-native-installer'}),timeout=45) as response:return json.load(response)
    try:metadata=fetch(url)
    except urllib.error.HTTPError as error:
        if error.code!=404 or game!='beammp':raise
        print('Unknown BeamMP version; resolving latest publisher release.',flush=True);metadata=fetch(base+'latest')
    name='BeamMP-Server.debian.12.x86_64' if game=='beammp' else 'KissMP_'+metadata['tag_name']+'.zip'
    assets=[a for a in metadata['assets'] if a['name']==name]
    if len(assets)!=1:raise ValueError('Publisher release lacks the supported Linux asset')
    asset=assets[0];digest=env.get('RELEASE_SHA256','') or asset.get('digest','').removeprefix('sha256:')
    if not re.fullmatch('[0-9a-f]{64}',digest):raise ValueError('Release requires publisher SHA-256 or an explicitly verified RELEASE_SHA256')
    expected='https://github.com/'+REPOS[game]+'/releases/download/'
    if not asset['browser_download_url'].startswith(expected):raise ValueError('Unexpected publisher asset origin')
    return {'version':metadata['tag_name'],'url':asset['browser_download_url'],'sha256':digest,'bytes':asset['size']}

def install(root,game,env):
    root=Path(root).resolve();state=owned(root,root/'.voltra'/game);state.mkdir(parents=True,exist_ok=True)
    identity=select_release(game,env);binary='BeamMP-Server' if game=='beammp' else 'kissmp-server'
    destination=owned(root,root/binary);receipt=owned(root,state/'release.json')
    old=json.loads(receipt.read_text()) if receipt.exists() else {}
    if old.get('sha256')==identity['sha256'] and destination.is_file() and release.sha256(destination)==old.get('binary_sha256'):
        print('Verified racing release retained; operator configuration untouched.',flush=True);return
    with tempfile.TemporaryDirectory(prefix='.install-',dir=state) as directory:
        stage=Path(directory);archive=stage/'archive';release.download(identity,archive)
        ready=stage/binary
        if game=='beammp':shutil.copyfile(archive,ready)
        else:
            with zipfile.ZipFile(archive) as source:
                # The publisher ZIP contains Linux x86_64 and ARM binaries.
                # Match the reviewed architecture path, never flatten by name.
                candidates=[m for m in source.infolist() if m.filename=='linux/kissmp-server' and not m.is_dir()]
                if len(candidates)!=1 or candidates[0].file_size>128*1024**2:raise ValueError('Ambiguous or oversized KissMP binary')
                with source.open(candidates[0]) as inp,ready.open('xb') as out:shutil.copyfileobj(inp,out)
        if ready.read_bytes()[:5]!=b'\x7fELF\x02':raise ValueError('Publisher asset is not a Linux ELF64 executable')
        ready.chmod(0o755)
        backup=None
        if destination.exists():
            backup=stage/'previous-binary';shutil.copy2(destination,backup)
        os.replace(ready,destination)
        try:
            write(receipt,json.dumps({**identity,'binary_sha256':release.sha256(destination),'source':'https://github.com/'+REPOS[game]+'/tree/'+identity['version']},indent=2)+'\n')
        except BaseException:
            if backup:os.replace(backup,destination)
            else:destination.unlink()
            raise
    print('Publisher racing release installed; configuration and mods retained.',flush=True)

def main():
    mode,game=sys.argv[1:3];root=Path.cwd();env=dict(os.environ)
    if game not in REPOS:raise ValueError('Unsupported racing game')
    if mode=='install':install(root,game,env);return 0
    if mode!='run':raise ValueError('Unsupported action')
    configure(root,game,env)
    if game=='kissmp':os.execv(str(root/'kissmp-server'),[str(root/'kissmp-server')])
    console=helper('native-console')
    return console.run(root,[str(root/'BeamMP-Server')],env,'exit',credentials=[env.get('AUTHKEY','')],terminal_input=True)

if __name__=='__main__':
    try:sys.exit(main())
    except (ValueError,OSError,KeyError) as error:
        # Do not print malformed native file contents or credentials.
        print('Racing setup failed: '+type(error).__name__+'. Check configuration and selected publisher version.',file=sys.stderr);sys.exit(1)
