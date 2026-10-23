#!/usr/bin/env python3
"""MIT integration for the MIT-licensed public RAGECOOP dedicated server."""
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
import urllib.request
import zipfile

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'));result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

RELEASE={'version':'1.5.4.7','url':'https://github.com/RAGECOOP/RAGECOOP-V/releases/download/1.5.4.7/RageCoop.Server-linux-x64.zip','sha256':'85cb91487993138f30f913ed2fe7bffbcc5c9e2f2c2b59eba91480ce1016fd8d','bytes':30391867}
LICENSE={'url':'https://raw.githubusercontent.com/RAGECOOP/RAGECOOP-V/1.5.4.7/LICENSE','sha256':'371fd5f1dc6192fa06792ec5af649fc3c1d4a325e06e94529878daafae7a81e7'}

def identity(env):
    version=env.get('VERSION',RELEASE['version'])
    if version==RELEASE['version']:return dict(RELEASE)
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,40}',version):raise ValueError('Invalid VERSION')
    url='https://api.github.com/repos/RAGECOOP/RAGECOOP-V/releases/'+('latest' if version=='latest' else 'tags/'+version)
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Voltra-game-setup/1.0'}),timeout=60) as response:data=json.load(response)
    assets=[a for a in data['assets'] if a['name']=='RageCoop.Server-linux-x64.zip']
    if len(assets)!=1:raise ValueError('Publisher release has no unique Linux dedicated server')
    asset=assets[0];digest=asset.get('digest') or 'sha256:'+env.get('RELEASE_SHA256','').lower()
    if not re.fullmatch(r'sha256:[0-9a-f]{64}',digest):raise ValueError('Other releases require trusted RELEASE_SHA256')
    return {'version':data['tag_name'],'url':asset['browser_download_url'],'bytes':asset['size'],'sha256':digest[7:]}

def extract(archive,target):
    seen=set();total=0
    with zipfile.ZipFile(archive) as source:
        for member in source.infolist():
            parts=PurePosixPath(member.filename).parts;mode=member.external_attr>>16
            if not parts or member.filename.startswith('/') or '..' in parts or '\\' in member.filename or member.filename in seen or (mode&0o170000)==0o120000:raise ValueError('Unsafe RAGECOOP archive member')
            seen.add(member.filename);total+=member.file_size
            if len(seen)>10000 or total>1024**3:raise ValueError('RAGECOOP archive exceeds limits')
            destination=target.joinpath(*parts)
            if member.is_dir():destination.mkdir(parents=True,exist_ok=True);continue
            destination.parent.mkdir(parents=True,exist_ok=True)
            with source.open(member) as inp,destination.open('xb') as out:shutil.copyfileobj(inp,out)
            destination.chmod(0o755 if member.filename=='RageCoop.Server' else 0o644)

def install(root,env):
    root=root.resolve();state=root/'.voltra/ragecoop';target=root/'ragecoop'
    for path in [state,target]:
        if not path.resolve().is_relative_to(root):raise ValueError('RAGECOOP destination escapes volume')
    state.mkdir(parents=True,exist_ok=True);selected=identity(env);receipt=state/'release.json'
    release=module('native-release');old=json.loads(receipt.read_text()) if receipt.is_file() else {}
    if not (target/'LICENSE').exists():
        target.mkdir(parents=True,exist_ok=True);release.download(LICENSE,target/'LICENSE')
    if old.get('sha256')==selected['sha256'] and (target/'RageCoop.Server').is_file() and release.sha256(target/'RageCoop.Server')==old.get('binary_sha256'):return
    with tempfile.TemporaryDirectory(dir=state) as temporary:
        stage=Path(temporary);release.download(selected,stage/'archive');ready=stage/'ready';ready.mkdir();extract(stage/'archive',ready)
        if not (ready/'RageCoop.Server').is_file():raise ValueError('Dedicated executable missing')
        target.mkdir(parents=True,exist_ok=True)
        for path in ready.rglob('*'):
            if not path.is_file():continue
            relative=path.relative_to(ready);destination=target/relative
            if not destination.resolve().is_relative_to(root):raise ValueError('RAGECOOP member escapes volume')
            if destination.exists() and str(relative)!='RageCoop.Server':continue
            destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,destination)
        receipt.write_text(json.dumps({**selected,'binary_sha256':release.sha256(target/'RageCoop.Server')},indent=2)+'\n')
    module('gta-install').migrate(root,'ragecoop',['Settings.xml','Resources','resources','Plugins','plugins'])

if __name__=='__main__':install(Path(os.environ.get('VOLTRA_SERVER_ROOT','/mnt/server')),os.environ)
