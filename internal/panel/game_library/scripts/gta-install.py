#!/usr/bin/env python3
"""MIT. Publisher releases and operator-owned GTA multiplayer data."""
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request

spec=importlib.util.spec_from_file_location('release',Path(__file__).with_name('native-release.py'))
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
ROOT=Path(os.environ.get('VOLTRA_SERVER_ROOT','/mnt/server')).resolve()
OPENMP={'version':'v1.6.7.3218','url':'https://github.com/openmultiplayer/open.mp/releases/download/v1.6.7.3218/open.mp-linux-x86.tar.gz','sha256':'0f7bfe70bb68ea780fe24a910b69412046e53d10feb65a9d4a9de8ff1f7f1329','prefix':'Server'}
OPENMP_LICENSE={'url':'https://raw.githubusercontent.com/openmultiplayer/open.mp/v1.6.7.3218/LICENSE.md','sha256':'1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5'}
MTA={'version':'1.6.0-release-24153','url':'https://mirror-cdn.multitheftauto.com/linux/dl/multitheftauto_linux_x64.tar.gz','sha256':'84e3614ac9b88a7e57e5abb4ee7f72e074cbd4474675a503968edb05b16b9992','prefix':'multitheftauto_linux_x64'}
MTA_CONFIG={'version':'2022-10-06','url':'https://mirror-cdn.multitheftauto.com/linux/dl/baseconfig.tar.gz','sha256':'161beb7823bc77df9952339e6e7048c61a426bd186ff6313e1e50b3b61804465','prefix':'baseconfig'}
MTA_RESOURCES={'version':'0c8be6ace57ec619856db7a5993d3923fe02440a','url':'https://codeload.github.com/multitheftauto/mtasa-resources/tar.gz/0c8be6ace57ec619856db7a5993d3923fe02440a','sha256':'ac52bd5a3bad61ea7969f763c27b82fbe86803efe5ad0f391ef5fa6089d59963','prefix':'mtasa-resources-0c8be6ace57ec619856db7a5993d3923fe02440a'}

def identified_download_cache(root,identity):
    """The publisher CDN requires an identified client, not urllib's default UA."""
    cache=root/'.voltra/public-cache'
    if cache.is_symlink() or not cache.resolve().is_relative_to(root):raise ValueError('Publisher cache escapes volume')
    cache.mkdir(parents=True,exist_ok=True);destination=cache/identity['sha256']
    if destination.exists():
        if destination.is_symlink() or release.sha256(destination)!=identity['sha256']:raise ValueError('Invalid publisher cache')
        return
    with tempfile.NamedTemporaryFile(dir=cache,delete=False) as output:
        path=Path(output.name)
        try:
            request=urllib.request.Request(identity['url'],headers={'User-Agent':'Voltra-game-setup/1.0','Accept':'application/octet-stream'})
            with urllib.request.urlopen(request,timeout=120) as source:shutil.copyfileobj(source,output)
        except BaseException:path.unlink(missing_ok=True);raise
    if release.sha256(path)!=identity['sha256']:
        path.unlink();raise ValueError('Publisher stable archive changed; review its SHA256 before updating')
    path.rename(destination)

def bundle_openmp_compat(root):
    source=Path('/usr/lib/i386-linux-gnu/libatomic.so.1')
    if not source.is_file():raise ValueError('Installer needs Debian libatomic1:i386')
    target=root/'.voltra/openmp32'
    if not target.resolve().is_relative_to(root):raise ValueError('Native library directory escapes volume')
    target.mkdir(parents=True,exist_ok=True)
    destination=target/'libatomic.so.1';digest=release.sha256(source)
    if destination.is_file() and release.sha256(destination)==digest and (target/'libatomic1.copyright').is_file() and (target/'manifest.json').is_file():return
    shutil.copy2(source,destination)
    shutil.copy2('/usr/share/doc/libatomic1/copyright',target/'libatomic1.copyright')
    (target/'manifest.json').write_text(json.dumps({'libatomic.so.1':digest,'package':subprocess.check_output(['dpkg-query','-W','-f=${Version}','libatomic1:i386'],text=True)},indent=2)+'\n')

def resolve_openmp(version,checksum=''):
    if version==OPENMP['version']:return dict(OPENMP)
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,40}',version):raise ValueError('Invalid VERSION')
    request=urllib.request.Request('https://api.github.com/repos/openmultiplayer/open.mp/releases/'+('latest' if version=='latest' else 'tags/'+version),headers={'User-Agent':'Voltra-game-setup'})
    with urllib.request.urlopen(request,timeout=60) as source:data=json.load(source)
    assets=[asset for asset in data['assets'] if asset['name']=='open.mp-linux-x86.tar.gz']
    if not assets:assets=[asset for asset in data['assets'] if asset['name']=='open.mp-linux-x86-dynssl.tar.gz']
    if len(assets)!=1:raise ValueError('No unique Linux x86 publisher release')
    asset=assets[0];digest=asset.get('digest','')
    if not re.fullmatch(r'sha256:[0-9a-f]{64}',digest):
        if not re.fullmatch(r'[0-9a-f]{64}',checksum):raise ValueError('Older release requires trusted RELEASE_SHA256')
        digest='sha256:'+checksum
    return {'version':data['tag_name'],'url':asset['browser_download_url'],'sha256':digest[7:],'prefix':'Server','bytes':asset['size']}

def copy_missing(root,identity,target):
    """Seed publisher resources/configuration once; never overwrite user data."""
    root=root.resolve();target=Path(target)
    if not target.resolve().is_relative_to(root):raise ValueError('Resource destination escapes volume')
    state=root/'.voltra/gta-seeds';state.mkdir(parents=True,exist_ok=True)
    receipt=state/(identity['sha256']+'.json')
    # Missing individual operator resources stay deleted on reinstall. The
    # immutable archive remains available to recover defaults explicitly.
    if receipt.exists():return
    with tempfile.TemporaryDirectory(prefix='seed-',dir=state) as temporary:
        stage=Path(temporary);release.download(identity,stage/'archive');ready=stage/'ready';ready.mkdir();release.extract(stage/'archive',ready,identity['prefix'])
        copied=[]
        for source in ready.rglob('*'):
            if not source.is_file():continue
            name=source.relative_to(ready);destination=target/name
            if not destination.resolve().is_relative_to(root):raise ValueError('Resource path escapes volume')
            if destination.exists():continue
            destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,destination);copied.append(name.as_posix())
        receipt.write_text(json.dumps({'release':identity,'seeded':copied},indent=2)+'\n')

def migrate(root,game,names):
    marker=root/'.voltra'/game/'legacy-layout-imported.json'
    if marker.exists():return
    copied=[]
    for name in names:
        source=root/name;target=root/game/name
        if not source.exists():continue
        if source.is_symlink() or not source.resolve().is_relative_to(root):raise ValueError('Legacy data path escapes volume')
        paths=list(source.rglob('*')) if source.is_dir() else [source]
        if any(p.is_symlink() for p in paths):raise ValueError('Legacy symlinks require explicit operator migration')
        for old in paths:
            if not old.is_file():continue
            new=target/old.relative_to(source) if source.is_dir() else target
            if not new.resolve().is_relative_to(root):raise ValueError('Legacy destination escapes volume')
            new.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(old,new);copied.append(old.relative_to(root).as_posix())
    marker.write_text(json.dumps({'copied':copied,'originals_retained':True},indent=2)+'\n')

def install(game,root=ROOT,env=None):
    env=os.environ if env is None else env;root.mkdir(parents=True,exist_ok=True)
    if not (root/'.voltra').resolve().is_relative_to(root) or not (root/'.voltra'/game).resolve().is_relative_to(root):raise ValueError('Installer state escapes volume')
    if game=='openmp':
        bundle_openmp_compat(root)
        identity=resolve_openmp(env.get('VERSION',OPENMP['version']),env.get('RELEASE_SHA256','').lower())
        release.install_release(root,identity,'openmp','omp-server')
        migrate(root,'openmp',['config.json','server.cfg','bans.json','gamemodes','filterscripts','plugins','components','scriptfiles','models','recordings'])
        if not (root/'openmp/LICENSE.md').exists():release.download(OPENMP_LICENSE,root/'openmp/LICENSE.md')
    elif game=='mtasa':
        identity=dict(MTA)
        if env.get('MTA_RELEASE_SHA256'):
            digest=env['MTA_RELEASE_SHA256'].lower()
            if not re.fullmatch(r'[0-9a-f]{64}',digest):raise ValueError('Invalid MTA_RELEASE_SHA256')
            identity.update(sha256=digest,version='operator-reviewed-stable-'+digest[:12])
        identified_download_cache(root,identity)
        identified_download_cache(root,MTA_CONFIG)
        release.install_release(root,identity,'mtasa','mta-server64')
        migrate(root,'mtasa',['mods','x64/modules','x64/libmysqlclient.so.16'])
        copy_missing(root,MTA_CONFIG,root/'mtasa/mods/deathmatch')
        copy_missing(root,MTA_RESOURCES,root/'mtasa/mods/deathmatch/resources')
    else:raise ValueError('Unknown GTA multiplayer server')

if __name__=='__main__':install(sys.argv[1])
