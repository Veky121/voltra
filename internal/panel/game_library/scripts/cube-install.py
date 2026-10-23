#!/usr/bin/env python3
"""MIT. Checked publisher native Cube releases with retained configuration/data."""
import json
import os
from pathlib import Path,PurePosixPath
import re
import shutil
import tarfile
import tempfile
import urllib.request
from native_release import download,install_release

AC={'version':'v1.3.0.2','prefix':None,
    'url':'https://github.com/assaultcube/AC/releases/download/v1.3.0.2/AssaultCube_v1.3.0.2_LockdownEdition_RC1.tar.bz2',
    'sha256':'9b3118e7929253f0114fa06cad8310faab646d177b4660406011152f34086b55','bytes':52071427}
SAUER={'version':'2020_12_29','prefix':'sauerbraten',
       'url':'https://downloads.sourceforge.net/project/sauerbraten/sauerbraten/2020_11_29/sauerbraten_2020_12_29_linux.tar.bz2',
       'sha256':'cdba7c4a47cefd30d0afdd6a912199a1384319cf1619923cb7189e72e468be70','bytes':985823440}


def assault_release(env):
    version=env.get('VERSION','latest')
    if version=='v1.3.0.2':return AC
    if version!='latest' and not re.fullmatch(r'[A-Za-z0-9_.-]{1,20}',version):raise ValueError('Invalid AssaultCube release tag')
    url='https://api.github.com/repos/assaultcube/AC/releases/'+('latest' if version=='latest' else 'tags/'+version)
    request=urllib.request.Request(url,headers={'Accept':'application/vnd.github+json','User-Agent':'Voltra-native-installer'})
    with urllib.request.urlopen(request,timeout=30) as response:
        raw=response.read(1024**2+1)
    if len(raw)>1024**2:raise ValueError('AssaultCube release metadata exceeds 1 MiB')
    release=json.loads(raw)
    if release.get('tag_name')=='v1.3.0.2':return AC
    matches=[a for a in release.get('assets',[]) if a.get('name','').endswith('.tar.bz2') and 'source' not in a.get('name','').lower()]
    if len(matches)!=1:raise ValueError('Choose a release with exactly one publisher Linux tar.bz2 asset')
    asset=matches[0]
    digest=env.get('RELEASE_SHA256','') or (asset.get('digest') or '').removeprefix('sha256:')
    if not re.fullmatch(r'[0-9a-f]{64}',digest):raise ValueError('This AssaultCube release needs RELEASE_SHA256 because GitHub has no published SHA-256 for its asset')
    download=asset.get('browser_download_url','')
    if not download.startswith('https://github.com/assaultcube/AC/releases/download/') or not 1<=int(asset.get('size',0))<=1024**3:raise ValueError('Invalid AssaultCube publisher asset')
    return {'version':release['tag_name'],'prefix':None,'url':download,'sha256':digest,'bytes':int(asset['size'])}


def archive_prefix(path):
    binaries=[]
    with tarfile.open(path,'r:*') as archive:
        for member in archive:
            parts=PurePosixPath(member.name).parts
            if member.isfile() and parts[-2:]==('bin_unix','linux_64_server'):binaries.append(parts)
    if len(binaries)!=1 or len(binaries[0])not in (2,3):raise ValueError('Publisher archive must contain one supported Linux server layout')
    return binaries[0][0] if len(binaries[0])==3 else None


def install(root,env,kind):
    if os.uname().machine not in ('x86_64','amd64'):raise ValueError('These publisher Cube binaries require Linux x64')
    if kind=='assaultcube':release=assault_release(env)
    elif kind=='sauerbraten':release=SAUER
    else:raise ValueError('Unknown native Cube game')
    if kind=='assaultcube' and release['version']!=AC['version']:
        state=root/'.voltra/assaultcube';cache=root/'.voltra/public-cache'
        if not state.resolve().is_relative_to(root.resolve()) or not cache.resolve().is_relative_to(root.resolve()):raise ValueError('Native Cube release staging escapes volume')
        state.mkdir(parents=True,exist_ok=True);cache.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.layout-',dir=state) as directory:
            archive=Path(directory)/'archive';download(release,archive)
            release={**release,'prefix':archive_prefix(archive)}
            # Retain one checked private copy so native publication does not
            # download a selected older release twice after layout inspection.
            blob=cache/release['sha256']
            if not blob.exists():
                with archive.open('rb') as inp,blob.open('xb') as out:shutil.copyfileobj(inp,out)
                blob.chmod(0o600)
    install_release(root,release,kind,'bin_unix/linux_64_server')


if __name__=='__main__':
    import sys
    install(Path.cwd(),os.environ,sys.argv[1])
