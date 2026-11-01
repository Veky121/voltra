#!/usr/bin/env python3
"""MIT. Native SRB2 dedicated build and standalone RimWorld mod servers."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from additional_survival_install import private_bytes
from native_console import run


def load(name, filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


publisher=load('small_publisher','small-native-install.py')
release=load('native_release','native-release.py')
PINNED=json.loads(Path(__file__).with_name('sonic-rimworld-releases.json').read_text())
LICENSES=json.loads(Path(__file__).with_name('sonic-rimworld-licenses.json').read_text())
REPOS={'sonic':'STJr/SRB2','openworld':'D12-Dev/OpenWorld','together':'RimWorld-Together/Rimworld-Together'}


def bundle_libraries(root,binary):
    target=root/'.voltra/runtime-libs'
    if target.is_symlink() or not target.resolve().is_relative_to(root):raise ValueError('Native library directory escapes the server volume')
    target.mkdir(parents=True,exist_ok=True)
    dependencies=set()
    binaries=[binary,*Path('/usr/lib/x86_64-linux-gnu').glob('libicu*.so.72')]
    for item in binaries:
        output=subprocess.run(['ldd',str(item)],capture_output=True,text=True,check=True).stdout
        if 'not found' in output:raise ValueError('Installer lacks a required native dependency')
        dependencies.update(re.findall(r'=>\s+(/[^\s]+)',output))
        if item.name.startswith('libicu'):dependencies.add(str(item))
    glibc=('libc.so.','libm.so.','libdl.so.','libpthread.so.','librt.so.','libresolv.so.','libutil.so.')
    for name in sorted(dependencies):
        source=Path(name)
        if not source.name.startswith(glibc):shutil.copy2(source,target/source.name)
    notices=target/'licenses';notices.mkdir(exist_ok=True)
    for source in Path('/usr/share/doc').glob('*/copyright'):shutil.copy2(source,notices/(source.parent.name.replace(':','_')+'.copyright'))


def get(url, maximum=4*1024**2):
    if not url.startswith('https://'):raise ValueError('Publisher URL requires HTTPS')
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Voltra-native-installer'}),timeout=120) as response:
        if not response.url.startswith('https://'):raise ValueError('Publisher redirected outside HTTPS')
        data=response.read(maximum+1)
    if len(data)>maximum:raise ValueError('Publisher response exceeds size bound')
    return data


def selected(game, version, cache_root=None):
    pinned=PINNED[game]
    equivalent=(pinned['version'],pinned['version'].removeprefix('SRB2_release_'))
    if version in equivalent:return dict(pinned)
    if not re.fullmatch(r'[A-Za-z0-9_.() -]{1,40}',version):raise ValueError('Invalid publisher version tag')
    tag='SRB2_release_'+version if game=='sonic' and version!='latest' else version
    endpoint='latest' if version=='latest' else 'tags/'+urllib.parse.quote(tag,safe='')
    metadata=json.loads(get('https://api.github.com/repos/'+REPOS[game]+'/releases/'+endpoint))
    if metadata['tag_name']==pinned['version']:return dict(pinned)
    expected='SRB2-v'+metadata['tag_name'].removeprefix('SRB2_release_').replace('.','')+'-Full.zip' if game=='sonic' else ('linux-x64.zip' if game=='openworld' else 'Server-linux-x64.zip')
    asset=next((a for a in metadata['assets'] if a['name']==expected),None)
    if not asset:raise ValueError('Publisher tag has no requested Linux dedicated distribution')
    digest=asset.get('digest') or ''
    result=dict(version=metadata['tag_name'],url=asset['browser_download_url'],bytes=asset['size'])
    if re.fullmatch(r'sha256:[0-9a-f]{64}',digest):return dict(result,sha256=digest[7:],identity='Publisher GitHub asset SHA256')
    blob=get(asset['browser_download_url'],512*1024**2)
    if len(blob)!=asset['size']:raise ValueError('Publisher alternate release size mismatch')
    digest=hashlib.sha256(blob).hexdigest()
    if cache_root is not None:
        if cache_root.is_symlink():raise ValueError('Private publisher cache must not use a symbolic link')
        cache_root.mkdir(parents=True,exist_ok=True);cached=cache_root/digest
        if cached.is_symlink():raise ValueError('Private publisher cache must not use a symbolic link')
        if cached.exists() and release.sha256(cached)!=digest:raise ValueError('Private alternate release cache is corrupt')
        if not cached.exists():private_bytes(cached,blob)
    return dict(result,sha256=digest,identity='Recorded SHA256 from operator-selected official HTTPS release; upstream has no independent SHA256')


def install(root,game,env):
    root=Path(root).resolve()
    if game not in REPOS:raise ValueError('Unknown dedicated server')
    if game=='sonic':
        # Refuse invalid controls and paths before state creation or acquisition.
        configure(root,game,env,preflight=True)
        version=env.get('SRB2_VERSION',PINNED[game]['version'])
        if version not in (PINNED[game]['version'],PINNED[game]['version'].removeprefix('SRB2_release_'),'latest'):
            raise ValueError('Additional SRB2 versions require a matching checksum-pinned source build')
        identity=selected(game,version)
        if identity['version']!=PINNED['sonic']['version']:
            raise ValueError('Additional SRB2 versions require a matching checksum-pinned source build')
    if game!='sonic':
        for name in ('.voltra','.voltra/'+game,'.voltra/public-cache','.voltra/runtime-libs','.voltra/dotnet-8'):
            path=root/name
            if path.is_symlink() or not path.resolve().is_relative_to(root) or path.exists() and not path.is_dir():raise ValueError('Invalid native installer directory')
        configure(root,game,env,preflight=True)
        version=env.get('VERSION',PINNED[game]['version'])
        if not re.fullmatch(r'[A-Za-z0-9_.() -]{1,40}',version):raise ValueError('Invalid publisher version tag')
    state=root/'.voltra'/game
    if not state.resolve().is_relative_to(root):raise ValueError('Installer state escapes server volume')
    state.mkdir(parents=True,exist_ok=True)
    version=env.get('SRB2_VERSION' if game=='sonic' else 'VERSION',PINNED[game]['version'])
    if game!='sonic':identity=selected(game,version,root/'.voltra/public-cache')
    with tempfile.TemporaryDirectory(prefix='.install-',dir=state) as temporary:
        stage=Path(temporary);archive=stage/'publisher.zip';release.download(identity,archive)
        unpack=stage/'unpack';unpack.mkdir();publisher.extract_zip(archive,unpack)
        ready=stage/'ready';ready.mkdir()
        if game=='sonic':
            if identity['version']!=PINNED['sonic']['version']:raise ValueError('Additional SRB2 versions require a matching checksum-pinned source build')
            source_archive=stage/'source.tar.gz';release.download(PINNED['sonic_source'],source_archive)
            source=stage/'source';source.mkdir();release.extract(source_archive,source,PINNED['sonic_source']['prefix'])
            subprocess.run(['make','-j2','LINUX64=1','DEDICATED=1','SDL=0','NOHW=1','NOOPENMPT=1','NOGME=1','NOUPNP=1'],cwd=source,check=True)
            shutil.copy2(source/'bin/lsrb2d',ready/'lsrb2d')
            for name in ['srb2.pk3','zones.pk3','characters.pk3','LICENSE.txt','LICENSE-3RD-PARTY.txt','README.txt']:
                shutil.copy2(unpack/name,ready/name)
            shutil.copytree(source,ready/'source',ignore=shutil.ignore_patterns('make','bin','.git','*.exe','*.dll'))
            publisher.publish(root,ready,root/'SRB2',dict(game=game,version=identity['version'],archive=identity,source=PINNED['sonic_source']),'lsrb2d')
            bundle_libraries(root,root/'SRB2/lsrb2d')
        else:
            source=unpack/'linux-x64' if game=='openworld' else unpack
            for path in source.iterdir():
                if path.is_dir():shutil.copytree(path,ready/path.name)
                else:shutil.copy2(path,ready/path.name)
            binary='OpenWorldServer' if game=='openworld' else ('RTServer' if (ready/'RTServer').is_file() else 'GameServer')
            (ready/binary).chmod(0o755)
            (ready/'LICENSE-Upstream.txt').write_text(LICENSES[game])
            if game=='together':(ready/'LICENSE-Third-Party.txt').write_text(LICENSES['together_third_party'])
            target=root if game=='openworld' else root/'RimworldTogether'
            publisher.publish(root,ready,target,dict(game=game,version=identity['version'],archive=identity),binary,preserve_paths=('Data','Configs','Saves','Mods','Worlds','Backups'))
            bundle_libraries(root,target/binary)
            if game=='openworld':
                managed=load('managed_runtime','among-us-install.py');managed.runtime(root,managed.DOTNET,'dotnet-8','dotnet')
    print('Native dedicated '+game+' installed; operator data remains separate.',flush=True)


def integer(env,key,default,minimum,maximum):
    value=int(env.get(key,str(default)))
    if not minimum<=value<=maximum:raise ValueError(key+' exceeds native range')
    return value


def boolean(env,key,default='false'):
    value=env.get(key,default)
    if value not in ('true','false'):raise ValueError(key+' must be true or false')
    return value=='true'


def config_json(path,values,managed,preflight=False):
    # Existing native values own gameplay settings. Only allocation bindings are forced.
    if path.is_symlink() or path.exists() and (not path.is_file() or path.stat().st_size>16*1024**2):raise ValueError('Native configuration must be a bounded regular file')
    metadata=path.stat() if path.exists() else None
    try:data=json.loads(path.read_text(encoding='utf-8-sig')) if path.exists() else {}
    except (ValueError,UnicodeError):raise ValueError('Invalid native JSON configuration') from None
    if not isinstance(data,dict):raise ValueError('Native JSON configuration must be an object')
    for key,value in values.items():
        if key in managed or key not in data:data[key]=value
    if not preflight:private_bytes(path,(json.dumps(data,indent=2)+'\n').encode(),metadata)
    return data


def native_credentials(root,game):
    if game not in ('openworld','together'):return []
    path=root/('Data/Config.json' if game=='openworld' else 'Configs/ServerConfig.json')
    data=json.loads(path.read_text(encoding='utf-8-sig'))
    result=[]
    def visit(value):
        if isinstance(value,dict):
            for key,item in value.items():
                if re.search(r'password|secret|token|credential|api.?key',key,re.I) and isinstance(item,str) and item:result.append(item)
                visit(item)
        elif isinstance(value,list):
            for item in value:visit(item)
    visit(data)
    return result


def configure(root,game,env,preflight=False):
    root=Path(root).resolve();port=integer(env,'SERVER_PORT',25555,1,65535)
    for name in ('Data','Configs','ServerData','SRB2','OpenWorld','RimworldTogether'):
        path=root/name
        if path.is_symlink() or not path.resolve().is_relative_to(root) or path.exists() and not path.is_dir():raise ValueError('Native data directory escapes the server volume')
    allocated={int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS','').split(',') if p}
    if port not in allocated:raise ValueError('Dedicated port must be an assigned allocation')
    environment=dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD','NSS_WRAPPER_PASSWD','NSS_WRAPPER_GROUP'):environment.pop(key,None)
    environment.update(HOME=str(root),LD_LIBRARY_PATH=str(root/'.voltra/runtime-libs'),DOTNET_BUNDLE_EXTRACT_BASE_DIR=str(root/'.voltra/dotnet-bundles'))
    if game=='sonic':
        name=env.get('SRV_NAME','SRB2 server');password=env.get('SRV_PW','')
        for value in (name,password):
            if len(value.encode())>20 or any(ord(c)<32 or ord(c)==127 or c in '"\\;' for c in value):raise ValueError('SRB2 text contains unsupported console characters or exceeds20bytes')
        players=integer(env,'MAX_PLAYERS',32,1,32);room=integer(env,'ROOM_NR',33,-1,65535)
        listed=boolean(env,'REGISTER_SERVER')
        path=root/'adedserv.cfg'
        native_config=root/'ServerData/.srb2/adedserv.cfg'
        # Validate both destinations before the first operator-file write.
        for destination in (path,native_config):
            for parent in destination.parents:
                if parent==root:break
                if parent.is_symlink() or parent.exists() and not parent.is_dir():raise ValueError('Invalid dedicated config directory')
            if destination.is_symlink() or not destination.resolve().is_relative_to(root):raise ValueError('Native startup configuration escapes server volume')
            if destination.exists() and (not destination.is_file() or destination.stat().st_size>1024**2):raise ValueError('Invalid dedicated config')
        metadata=path.stat() if path.exists() else None
        raw=path.read_bytes() if path.exists() else b''
        managed={b'servername',b'password',b'clearpassword',b'maxplayers',b'masterserver_room_id'}
        lines=[line for line in raw.splitlines(keepends=True) if not line.strip() or line.lstrip().split()[0].lower() not in managed]
        content=b''.join(lines)
        if content and not content.endswith((b'\n',b'\r')):content+=b'\n'
        commands=['servername "'+name+'"','clearpassword',*(['password "'+password+'"'] if password else []),'maxplayers '+str(players),'masterserver_room_id '+str(room if listed else -1)]
        content+=('\n'.join(commands)+'\n').encode()
        if preflight:return
        private_bytes(path,content,metadata)
        private_bytes(native_config,content,native_config.stat() if native_config.exists() else None)
        argv=[str(root/'SRB2/lsrb2d'),'-dedicated','-port',str(port),*(['-room',str(room)] if listed and room>=0 else []),'-home',str(root/'ServerData'),'+exec',str(native_config)]
        (root/'ServerData').mkdir(exist_ok=True)
        return argv,environment,root/'SRB2','quit'
    if game=='openworld':
        values=dict(LocalAddress='0.0.0.0',ServerPort=port,MaxPlayers=integer(env,'MAX_PLAYERS',10,1,1000),PlayerVersion=env.get('PLAYER_VERSION','1.3'))
        if not re.fullmatch(r'[0-9.]{1,10}',values['PlayerVersion']):raise ValueError('Player protocol version must be a numeric dotted version')
        for key,native in [('ENFORCE_MODS','EnforceMods'),('USE_MOD_BLACKLIST','UseModBlacklist'),('USE_CUSTOM_DIFF','UseCustomDifficulty'),('WHITELIST','UseWhitelist'),('CUSTOM_SCEN','AllowCustomScenarios')]:values[native]=boolean(env,key)
        config_json(root/'Data/Config.json',values,{'LocalAddress','ServerPort'},preflight)
        if preflight:return
        environment.update(DOTNET_ROOT=str(root/'.voltra/dotnet-8'),DOTNET_ROLL_FORWARD='Major',DOTNET_SYSTEM_GLOBALIZATION_INVARIANT='1',DOTNET_SYSTEM_GLOBALIZATION_PREDEFINED_CULTURES_ONLY='0')
        return [str(root/'.voltra/dotnet-8/dotnet'),'--roll-forward','Major',str(root/'OpenWorldServer.dll')],environment,root,'shutdown'
    if game=='together':
        name=env.get('SERVER_NAME','RimWorld Together Server')
        if len(name.encode())>128 or any(ord(c)<32 for c in name):raise ValueError('Invalid server name')
        values=dict(IP='0.0.0.0',Port=port,MaxPlayers=integer(env,'MAX_PLAYERS',100,1,150),Name=name,Verbosity=2 if boolean(env,'VERBOSE') else 0,EnableServerBrowser=boolean(env,'REGISTER_SERVER'),EnableServerTelemetry=boolean(env,'SERVER_TELEMETRY'),UseUPnP=False)
        config_json(root/'Configs/ServerConfig.json',values,{'IP','Port','UseUPnP'},preflight)
        if preflight:return
        binary=root/'RimworldTogether/RTServer'
        if not binary.is_file():binary=root/'RimworldTogether/GameServer'
        return [str(binary)],environment,root,'quit'
    raise ValueError('Unknown dedicated server')


if __name__=='__main__':
    mode,game=sys.argv[1:3];root=Path.cwd();env=dict(os.environ)
    if mode=='install':install(root,game,env)
    elif mode=='run':
        argv,environment,cwd,stop=configure(root,game,env)
        raise SystemExit(run(cwd,argv,environment,stop,credentials=[env.get('SRV_PW',''),*native_credentials(root,game)],terminal_input=True,terminal_query_reply=True))
    else:raise ValueError('Choose install or run')
