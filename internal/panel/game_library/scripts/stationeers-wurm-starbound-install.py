#!/usr/bin/env python3
"""MIT. Typed Steam acquisition with recoverable Wurm world preservation."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
import time
import zipfile
from pathlib import PurePosixPath
from steam_template import update
from native_config import private_write
from valheim_vrising_install import acquire,overlay,confined

BEP={'url':'https://github.com/BepInEx/BepInEx/releases/download/v5.4.23.5/BepInEx_linux_x64_5.4.23.5.zip','sha256':'e538560be65739f562519ab518a75f9c65b3f57f87457403ae7cde683c12dab7','version':'5.4.23.5'}
LAUNCHPAD={'url':'https://github.com/StationeersLaunchPad/StationeersLaunchPad/releases/download/v1.1.0/StationeersLaunchPad-server-v1.1.0.zip','sha256':'2db7f3444a92a129d482345df756ebe5d4224265e22e60ce9e662ef82d31339d','version':'1.1.0'}


def stationeers_framework(root,env):
    selection=env.get('STATIONEERS_MOD_FRAMEWORK','launchpad')
    if selection=='launchpad':framework=LAUNCHPAD
    elif selection=='stationeersmods':
        url=env.get('STATIONEERSMODS_ARCHIVE_URL','');sha=env.get('STATIONEERSMODS_ARCHIVE_SHA256','').lower()
        if not url.startswith('https://')or len(sha)!=64 or any(c not in'0123456789abcdef'for c in sha):raise ValueError('Original StationeersMods publisher endpoint is unavailable; supply an entitled HTTPS archive and exact SHA256 or explicitly choose maintained LaunchPad')
        framework={'url':url,'sha256':sha,'version':'operator-pinned'}
    else:raise ValueError('Unknown Stationeers mod framework')
    plugins=confined(root,'BepInEx/plugins')
    conflict='StationeersMods.dll'if selection=='launchpad'else'StationeersLaunchPad.dll'
    if plugins.exists()and any(p.name==conflict for p in plugins.rglob('*.dll')):raise ValueError('Conflicting Stationeers mod loader remains; preserve it in a backup outside BepInEx/plugins before selecting this framework')
    return selection,framework


def framework_overlay(root,archive,selection,managed):
    """Preserve complete framework resources, not only its managed assemblies."""
    with zipfile.ZipFile(archive)as source:
        members=[];seen=set();expanded=0
        for member in source.infolist():
            normalized=member.filename.replace('\\','/');path=PurePosixPath(normalized);kind=stat.S_IFMT(member.external_attr>>16)
            if not path.parts or path.is_absolute()or'..'in path.parts or ':'in path.parts[0]or kind not in(0,stat.S_IFREG,stat.S_IFDIR):raise ValueError('Unsafe framework archive member')
            if path.as_posix()in seen:raise ValueError('Duplicate framework archive member')
            seen.add(path.as_posix());expanded+=member.file_size
            if expanded>256*1024**2 or len(seen)>10000:raise ValueError('Framework archive exceeds bounds')
            if not member.is_dir():members.append((member,'BepInEx/plugins/'+selection+'/'+path.as_posix()))
        with tempfile.TemporaryDirectory(prefix='framework-',dir=root/'.voltra/stationeers')as temporary:
            wrapped=Path(temporary)/'framework.zip'
            with zipfile.ZipFile(wrapped,'w',compression=zipfile.ZIP_DEFLATED)as target:
                for member,name in members:
                    info=zipfile.ZipInfo(name);info.external_attr=member.external_attr
                    with source.open(member)as inp,target.open(info,'w')as out:shutil.copyfileobj(inp,out)
            return overlay(root,wrapped,managed=managed)


def validate_tree(root,path):
    if not path.resolve().is_relative_to(root)or path.is_symlink()or path.stat().st_dev!=root.stat().st_dev or os.path.ismount(path):raise ValueError('World tree leaves server volume or crosses a mount')
    for entry in path.rglob('*'):
        if entry.is_symlink()or not(entry.is_dir()or entry.is_file())or entry.stat().st_dev!=root.stat().st_dev or os.path.ismount(entry):raise ValueError('World preservation rejects links, mounts and special files')


def world_relative(root,selected):
    if not isinstance(selected,str)or not selected or any(ord(c)<32 for c in selected):raise ValueError('Invalid Wurm world path')
    if selected.startswith('/home/container/'):selected=selected[len('/home/container/'):]
    path=Path(selected)
    if path.is_absolute():
        try:path=path.relative_to(root)
        except ValueError:raise ValueError('Wurm world leaves server volume')from None
    if not path.parts or'..'in path.parts or path.parts[0]in('.voltra','.steam','steamapps'):raise ValueError('Unsafe Wurm world preservation path')
    confined(root,path.as_posix());return path.as_posix()


def preserve_wurm_update(root,env,operation):
    root=Path(root).resolve();selected=world_relative(root,env.get('SERVER_WORLD','dist/Adventure'))
    names={'dist/Adventure','dist/Creative',selected}
    paths=[confined(root,name)for name in sorted(names)]
    chosen=root/selected
    if any(chosen!=root/name and chosen in(root/name).parents for name in('dist/Adventure','dist/Creative')):raise ValueError('World path must not cover the publisher distribution directory')
    paths=[path for path in paths if not any(other!=path and other in path.parents for other in paths)]
    for path in paths:
        if path.exists():
            if not path.is_dir():raise ValueError('Wurm world must be a directory')
            validate_tree(root,path)
    journal=root/'.voltra/wurm/preservation-pending.json'
    if journal.exists():raise ValueError('Unfinished Wurm world preservation; restore recorded private backup before retry')
    folder=root/'.voltra/wurm/update-backups'/str(time.time_ns());folder.mkdir(parents=True,mode=0o700)
    moved=[]
    try:
        private_write(journal,json.dumps({'phase':'prevalidated','paths':[{'live':str(path.relative_to(root)),'saved':str((folder/path.relative_to(root)).relative_to(root))}for path in paths if path.exists()]},indent=2)+'\n')
        for path in paths:
            if not path.exists():continue
            saved=folder/path.relative_to(root);saved.parent.mkdir(parents=True,exist_ok=True);path.rename(saved);moved.append((path,saved))
            private_write(journal,json.dumps({'phase':'worlds-protected','paths':[{'live':str(a.relative_to(root)),'saved':str(b.relative_to(root))}for a,b in moved]},indent=2)+'\n')
        return operation()
    finally:
        for path,saved in reversed(moved):
            if path.exists():
                validate_tree(root,path);fresh=folder/'publisher-new'/path.relative_to(root);fresh.parent.mkdir(parents=True,exist_ok=True);path.rename(fresh)
            path.parent.mkdir(parents=True,exist_ok=True);saved.rename(path)
        journal.unlink(missing_ok=True)


def workshop_links(root,enabled):
    if enabled not in ('0','1'):raise ValueError('WORKSHOP must be 0 or 1')
    confined(root,'mods');receipt=confined(root,'.voltra/starbound/workshop-links.json');old=json.loads(receipt.read_text())if receipt.exists()else{}
    for name,link in old.items():
        if not name.startswith('mods/')or len(Path(name).parts)!=2 or Path(name).name in ('.','..')or not isinstance(link,str)or Path(link).is_absolute()or not(root/name).resolve().is_relative_to(root):raise ValueError('Invalid prior Workshop receipt')
    planned={}
    if enabled=='1':
        workshop=root/'steamapps/workshop/content/211820'
        if not workshop.resolve().is_relative_to(root):raise ValueError('Workshop directory leaves server volume')
        for directory in sorted(workshop.iterdir())if workshop.exists()else():
            if not directory.name.isdigit()or directory.is_symlink()or not directory.is_dir():continue
            for index,pak in enumerate(sorted(directory.glob('*.pak'))):
                if pak.is_symlink()or not pak.is_file()or not pak.resolve().is_relative_to(root):raise ValueError('Workshop package leaves server volume')
                name=f'mods/{directory.name}_{index}.pak';target=root/name
                if target.exists()or target.is_symlink():
                    if name not in old or not target.is_symlink()or os.readlink(target)!=old[name]:raise ValueError('Workshop link would overwrite operator data')
                planned[name]=os.path.relpath(pak,target.parent)
    for name,link in old.items():
        target=confined(root,name)if not(root/name).is_symlink()else root/name
        if not name.startswith('mods/')or len(Path(name).parts)!=2:raise ValueError('Invalid prior Workshop receipt')
        if target.is_symlink()and os.readlink(target)==link:target.unlink()
    for name,link in planned.items():
        target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.symlink_to(link)
    private_write(receipt,json.dumps(planned,indent=2)+'\n')


def install(root,kind,env=None):
    root=Path(root).resolve();env=dict(os.environ if env is None else env);state=confined(root,'.voltra/'+kind);state.mkdir(parents=True,exist_ok=True)
    if kind=='starbound':
        if env.get('STEAM_USER','').lower()in('','anonymous'):raise ValueError('Starbound requires an entitled Steam account configured through the secure Steam integration; anonymous acquisition is unavailable')
        release=update(root,211820,env=env,required=('linux/starbound_server',),validate=env.get('VALIDATE','false')=='true')
        source=root/'linux';plans=[]
        for item in source.iterdir():
            if item.is_symlink()or not item.is_file():raise ValueError('Unexpected Starbound Linux distribution entry')
            target=confined(root,item.name)
            if target.exists()and not target.is_file():raise ValueError('Starbound native destination is not a file')
            if item.name!='sbinit.config':plans.append((item,target))
        for item,target in plans:shutil.copy2(item,target)
        boot=root/'sbinit.config'
        if not boot.exists():
            data=json.loads((source/'sbinit.config').read_text());data['assetDirectories']=[p[3:]if p.startswith('../')else p for p in data.get('assetDirectories',[])];data['storageDirectory']='storage';private_write(boot,json.dumps(data,indent=2)+'\n')
        workshop_links(root,env.get('WORKSHOP','0'))
    elif kind=='stationeers':
        modded=env.get('VOLTRA_STATIONEERS_VARIANT','vanilla')=='bepinex'
        if modded:selection,framework=stationeers_framework(root,env)
        release=update(root,600760,env=env,required=('rocketstation_DedicatedServer.x86_64',),validate=env.get('VALIDATE','false')=='true')
        from stationeers_console_compat import provision
        release={**release,'console_compatibility':provision(root)}
        if modded:
            previous=json.loads((state/'installation.json').read_text())if(state/'installation.json').exists()else{}
            managed={key:value for item in previous.get('mods',[])for key,value in item.get('files',{}).items()};mods=[]
            with tempfile.TemporaryDirectory(prefix='overlays-',dir=state)as temporary:
                for name,package,destination in [('bepinex',BEP,None),(selection,framework,'BepInEx/plugins/'+selection)]:
                    archive=Path(temporary)/(name+'.zip');metadata=acquire(root,package,archive);metadata['files']=overlay(root,archive,managed=managed)if destination is None else framework_overlay(root,archive,selection,managed);mods.append(metadata)
            release={**release,'mods':mods,'framework':selection}
    elif kind=='wurm':
        release=preserve_wurm_update(root,env,lambda:update(root,402370,env=env,required=('WurmServerLauncher',),validate=env.get('VALIDATE','false')=='true'))
        source=root/'.steam/sdk64/steamclient.so';target=confined(root,'nativelibs/steamclient.so');target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
        backup=confined(root,'backup');backup.mkdir(exist_ok=True)
        for relative in ('WurmServerLauncher','dist/Adventure','dist/Creative'):
            source=confined(root,relative);target=backup/source.name
            if target.exists():continue
            validate_tree(root,source)if source.is_dir()else None
            shutil.copytree(source,target,copy_function=shutil.copy2)if source.is_dir()else shutil.copy2(source,target)
    else:raise ValueError('Unsupported native family')
    private_write(state/'installation.json',json.dumps(release,indent=2)+'\n');return release


if __name__=='__main__':install(Path.cwd(),sys.argv[1])
