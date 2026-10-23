#!/usr/bin/env python3
"""MIT. Typed Steam and confined, receipted Valheim/V Rising mod overlays."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import time
import urllib.request
import zipfile
from steam_template import update
from native_config import private_write

RELEASES={
 'valheim':{'url':'https://thunderstore.io/package/download/denikson/BepInExPack_Valheim/5.4.2351/','sha256':'bce631497976a93977ceb08e166712e6c31d15244956f89f17df092a9b62e29f','version':'5.4.2351','prefix':'BepInExPack_Valheim'},
 'vrising':{'url':'https://thunderstore.io/package/download/BepInEx/BepInExPack_V_Rising/1.733.2/','sha256':'eabfb53d80bed427ddbd1ecf8af4dcd6e82e152809d44ab3218d0a09984f491c','version':'1.733.2','prefix':'BepInExPack_V_Rising'},
}
MONO_RELEASE={'url':'https://dl.winehq.org/wine/wine-mono/9.1.0/wine-mono-9.1.0-x86.msi','sha256':'8a0a1e6837b494df49927e5d759b1c6908e89b8a2f8e3ad025e1c2881882476e','version':'9.1.0','bytes':84623872}


def confined(root,relative):
    path=PurePosixPath(relative)
    if not path.parts or path.is_absolute()or'..'in path.parts or'\\'in relative:raise ValueError('Mod path must stay in this volume')
    target=root.joinpath(*path.parts)
    if not target.resolve().is_relative_to(root):raise ValueError('Mod path follows an external link')
    if any(p.is_symlink()for p in [target,*list(target.parents)[:len(path.parts)]]):raise ValueError('Mod destinations must not follow links')
    return target


def api(url):
    request=urllib.request.Request(url,headers={'User-Agent':'Voltra-Setup/1','Accept':'application/json'})
    with urllib.request.urlopen(request,timeout=45)as response:
        data=response.read(8*1024**2+1)
        if len(data)>8*1024**2:raise ValueError('Publisher metadata exceeds limit')
        return json.loads(data)


def acquire(root,release,target):
    if not release['url'].startswith('https://'):raise ValueError('Mod download requires HTTPS')
    cached=root/'.voltra/public-cache'/release.get('sha256','missing')
    if cached.is_file()and not cached.is_symlink():
        if not cached.resolve().is_relative_to(root):raise ValueError('Mod cache leaves volume')
        shutil.copyfile(cached,target)
    else:
        request=urllib.request.Request(release['url'],headers={'User-Agent':'Voltra-Setup/1'})
        with urllib.request.urlopen(request,timeout=120)as response,target.open('xb')as output:
            if not response.geturl().startswith('https://'):raise ValueError('Mod redirect requires HTTPS')
            total=0
            while True:
                block=response.read(1024**2)
                if not block:break
                total+=len(block)
                if total>256*1024**2:raise ValueError('Mod archive exceeds limit')
                output.write(block)
    digest=hashlib.sha256(target.read_bytes()).hexdigest()
    if release.get('sha256')and digest!=release['sha256']:raise ValueError('Mod publisher archive checksum mismatch')
    return {**release,'sha256':digest,'bytes':target.stat().st_size}


def overlay(root,archive,prefix=None,plugin_directory=None,managed=None):
    """Validate the whole ZIP before writing any live file. Preserve operator data."""
    root=Path(root).resolve();protected=('BepInEx/config/','BepInEx/plugins/','BepInEx/patchers/')
    with zipfile.ZipFile(archive)as source:
        planned=[];seen=set();expanded=0
        for member in source.infolist():
            normalized=member.filename.replace('\\','/');path=PurePosixPath(normalized);kind=stat.S_IFMT(member.external_attr>>16)
            if not path.parts or path.is_absolute()or'..'in path.parts or re.match(r'^[A-Za-z]:',normalized)or kind not in(0,stat.S_IFREG,stat.S_IFDIR):raise ValueError('Unsafe mod archive member')
            expanded+=member.file_size
            if expanded>1024**3 or len(seen)>100000:raise ValueError('Mod expansion exceeds limit')
            if normalized in seen:raise ValueError('Duplicate mod archive member')
            seen.add(normalized)
            if member.is_dir():continue
            if prefix:
                if path.parts[0]!=prefix:continue
                path=PurePosixPath(*path.parts[1:])
            if plugin_directory:
                if path.suffix.lower()!='.dll':continue
                path=PurePosixPath(plugin_directory)/path.name
            relative=path.as_posix()
            if path.parts[0]in('.voltra','.steam','steamapps','server','save-data','.config')or relative in('valheim_server.x86_64','VRisingServer.exe','seed.txt'):raise ValueError('Mod archive contains protected operator/game data')
            target=confined(root,relative)
            if target.exists()and not target.is_file():raise ValueError('Mod destination is not a regular file')
            if any(name==relative for _,name,_ in planned):raise ValueError('Colliding mod destinations')
            planned.append((member,relative,target))
        publications=[];backup=root/'.voltra/survival-mods/backups'/str(time.time_ns())
        for member,relative,target in planned:
            if target.exists()and relative.startswith(protected):
                # Only a previously receipted, unchanged publisher plugin may
                # be updated. Configuration and operator edits remain intact.
                previous=(managed or{}).get(relative)
                if relative.startswith('BepInEx/config/') or not previous or hashlib.sha256(target.read_bytes()).hexdigest()!=previous:continue
            publications.append((member,relative,target))
        for member,relative,target in publications:
            if target.exists():
                saved=confined(root,str(backup.relative_to(root)/relative));saved.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target,saved)
        receipt={}
        for member,relative,target in publications:
            target.parent.mkdir(parents=True,exist_ok=True)
            descriptor,temporary=tempfile.mkstemp(prefix='.voltra-mod-',dir=target.parent)
            try:
                with os.fdopen(descriptor,'wb')as output,source.open(member)as inp:shutil.copyfileobj(inp,output)
                os.chmod(temporary,(member.external_attr>>16)&0o777 or 0o644);os.replace(temporary,target)
            finally:
                if os.path.exists(temporary):os.unlink(temporary)
            receipt[relative]=hashlib.sha256(target.read_bytes()).hexdigest()
        return receipt


def package_id(value):
    pieces=value.replace('/','-').split('-')
    if len(pieces)!=3 or not all(re.fullmatch(r'[A-Za-z0-9_]+',part)for part in pieces[:2])or not re.fullmatch(r'\d+\.\d+\.\d+',pieces[2]):raise ValueError('Modpack must be namespace-name-version')
    return pieces


def dependencies(value):
    result=[];visiting=set();visited=set()
    def visit(identifier,depth=0):
        if identifier in visiting:raise ValueError('Cyclic Thunderstore dependencies')
        if identifier in visited:return
        if depth>16 or len(visited)+len(visiting)>256:raise ValueError('Modpack dependency limit exceeded')
        owner,name,version=package_id(identifier);visiting.add(identifier)
        metadata=api('https://thunderstore.io/api/experimental/package/'+owner+'/'+name+'/'+version+'/')
        for child in metadata.get('dependencies',[]):visit(child,depth+1)
        visiting.remove(identifier);visited.add(identifier)
        if not(owner=='denikson'and name=='BepInExPack_Valheim'):result.append({'identifier':identifier,'url':'https://thunderstore.io/package/download/'+owner+'/'+name+'/'+version+'/'})
    visit(value);return result


def plus_release(env):
    repo=env.get('GITHUB_PACKAGE','Grantapher/ValheimPlus');version=env.get('VERSION','latest')or'latest';match=env.get('MATCH','UnixServer.zip')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',repo)or not re.fullmatch(r'[A-Za-z0-9_.-]+',version)or not match or any(c in match for c in '/\\\r\n'):raise ValueError('Invalid ValheimPlus release selection')
    release=api('https://api.github.com/repos/'+repo+'/releases/'+('latest'if version=='latest'else'tags/'+version))
    assets=[a for a in release.get('assets',[])if match.casefold()in a['name'].casefold()]
    if len(assets)!=1 or not assets[0]['name'].endswith('.zip'):raise ValueError('Choose one ZIP release asset using Match')
    asset=assets[0];result={'url':asset['browser_download_url'],'version':release['tag_name'],'repository':repo,'asset':asset['name']}
    if asset.get('digest','').startswith('sha256:'):result['sha256']=asset['digest'][7:]
    return result


def install(root,kind,env):
    root=Path(root).resolve()
    if kind not in('valheim','vrising'):raise ValueError('Unknown survival game')
    variant=env.get('VOLTRA_'+('VALHEIM'if kind=='valheim'else'VRISING')+'_VARIANT','vanilla')
    if variant not in(('vanilla','bepinex','plus')if kind=='valheim'else('vanilla','bepinex')):raise ValueError('Invalid game variant')
    pack=env.get('V_MODPACK','')if kind=='valheim'and variant=='bepinex'else''
    if pack:package_id(pack)
    environment=dict(env)
    if kind=='vrising':environment['WINDOWS_INSTALL']='1'
    update(root,896660 if kind=='valheim' else 1829350,env=environment,required=('valheim_server.x86_64',)if kind=='valheim'else('VRisingServer.exe',),validate=env.get('VALIDATE','')=='true',platform='linux' if kind=='valheim' else 'windows')
    state=confined(root,'.voltra/'+kind);state.mkdir(parents=True,exist_ok=True);receipt={'variant':variant,'overlays':[]}
    previous_path=confined(root,'.voltra/'+kind+'/installation.json')
    previous=json.loads(previous_path.read_text())if previous_path.is_file()else{}
    managed={name:digest for release in previous.get('overlays',[])for name,digest in release.get('files',{}).items()}
    def pinned(release):
        if not release.get('sha256'):
            identity=next((old.get('sha256')for old in previous.get('overlays',[])if old.get('url')==release['url']),None)
            if identity:release={**release,'sha256':identity}
        return release
    with tempfile.TemporaryDirectory(prefix='mods-',dir=state)as directory:
        temporary=Path(directory)
        if variant!='vanilla':
            release=pinned(plus_release(env)if variant=='plus'else RELEASES[kind])
            archive=temporary/'base.zip';identity=acquire(root,release,archive)
            files=overlay(root,archive,release.get('prefix'),managed=managed)
            receipt['overlays'].append({**identity,'files':files})
        if pack:
            for index,release in enumerate(dependencies(pack)):
                release=pinned(release)
                archive=temporary/(str(index)+'.zip');identity=acquire(root,release,archive)
                files=overlay(root,archive,plugin_directory='BepInEx/plugins/'+release['identifier'],managed=managed)
                receipt['overlays'].append({**identity,'files':files})
        current={name for release in receipt['overlays']for name in release.get('files',{})}
        # Switching a selected modpack retires only unchanged files owned by
        # its prior receipt, never arbitrary operator plugin directories.
        for name,digest in managed.items():
            if not name.startswith('BepInEx/plugins/')or name in current:continue
            target=confined(root,name)
            if target.is_file()and hashlib.sha256(target.read_bytes()).hexdigest()==digest:
                destination=confined(root,'.voltra/'+kind+'/retired-plugins/'+str(time.time_ns())+'/'+name)
                destination.parent.mkdir(parents=True,exist_ok=True);os.rename(target,destination)
        if kind=='vrising':
            from enshrouded_proton import provision
            receipt['proton']=provision(root)
            if variant=='bepinex':
                mono=confined(root,'.voltra/vrising/wine-mono-9.1.0-x86.msi')
                if mono.exists():
                    if not mono.is_file()or hashlib.sha256(mono.read_bytes()).hexdigest()!=MONO_RELEASE['sha256']:raise ValueError('Existing private Mono package differs; retain for operator review')
                else:
                    package=temporary/'mono.msi';acquire(root,MONO_RELEASE,package);os.replace(package,mono)
                receipt['mono']=MONO_RELEASE
        else:
            from private_nss import provision
            provision(root)
    target=state/'installation.json';private_write(target,json.dumps(receipt,indent=2)+'\n');owner=root.stat();os.chown(target,owner.st_uid,owner.st_gid)
    return receipt


if __name__=='__main__':install(Path.cwd(),sys.argv[1],dict(os.environ))
