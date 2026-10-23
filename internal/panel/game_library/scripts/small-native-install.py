#!/usr/bin/env python3
"""MIT. Staged publisher releases for OpenRCT2 and CS2D; retain operator files."""
import hashlib
import importlib.util
import json
import os
import re
import html
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tempfile
import time
import urllib.request
import urllib.parse
import zipfile

spec=importlib.util.spec_from_file_location('release',Path(__file__).with_name('native-release.py'))
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)

CS_CLIENT={'url':'https://www.unrealsoftware.de/get.php?get=cs2d_1018_linux.zip','sha256':'855314b79c1cca60e93834461784882464fe00bf6a5aa2e86017c4ecbc4b16b1','bytes':29404443}
CS_SERVER={'url':'https://www.unrealsoftware.de/files_pub/cs2d_dedicated_linux.zip','sha256':'a1b39e1f0aaca1903dc150dd9dfbfe67fcae67a264de56c3de1a7ba3b20ca7b0','bytes':3903595}
RCT={'url':'https://github.com/OpenRCT2/OpenRCT2/releases/download/v0.5.6/OpenRCT2-v0.5.6-linux-x86_64.AppImage','sha256':'8198b5ef8b9b07685fc860f3f04ce88a5f07ce6c1e5a9e2badffa811ed0f2eba'}
DEFAULT_PARK={'url':'https://raw.githubusercontent.com/ptero-eggs/game-eggs/c637a6d1e0449b167efeff81bb9a0177aa3df6c2/openrct2/save.park','sha256':'3d6df405562e487b240de4311520aa2056db33deb0a94c6edcf8e2fdbe30109e','bytes':73489}

def extract_zip(archive,target):
    seen=set();total=0
    with zipfile.ZipFile(archive) as source:
        for entry in source.infolist():
            parts=PurePosixPath(entry.filename).parts
            if not parts or entry.filename.startswith('/') or '..' in parts or '\\' in entry.filename or entry.filename in seen:
                raise ValueError('Unsafe publisher ZIP path')
            seen.add(entry.filename);total+=entry.file_size
            if len(seen)>100000 or total>1024**3 or ((entry.external_attr>>16)&0o170000)==0o120000:
                raise ValueError('Unsupported publisher ZIP contents')
            path=target.joinpath(*parts)
            if entry.is_dir():path.mkdir(parents=True,exist_ok=True)
            else:
                path.parent.mkdir(parents=True,exist_ok=True)
                with source.open(entry) as src,path.open('wb') as dst:shutil.copyfileobj(src,dst)
                path.chmod(0o644)

def publish(root,stage,target,identity,binary):
    root=root.resolve();target=Path(target);state=root/'.voltra'/identity['game'];state.mkdir(parents=True,exist_ok=True)
    if not target.resolve().is_relative_to(root):raise ValueError('Engine path escapes volume')
    receipt=state/'release.json';old=json.loads(receipt.read_text()) if receipt.is_file() else {}
    files={p.relative_to(stage).as_posix():release.sha256(p) for p in stage.rglob('*') if p.is_file()}
    if binary not in files:raise ValueError('Publisher executable missing')
    previous=state/('previous-'+str(time.time_ns()));changes=[]
    try:
        for name,digest in files.items():
            src=stage/name;dst=target/name
            if not dst.resolve().is_relative_to(root) or dst.is_symlink():raise ValueError('Engine publication escapes volume')
            backup=None
            if dst.exists():
                current=release.sha256(dst)
                if current==digest:continue
                if name!=binary and current!=old.get('files',{}).get(name):continue
                backup=previous/name;backup.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(dst,backup)
            dst.parent.mkdir(parents=True,exist_ok=True);os.replace(src,dst);changes.append((dst,backup))
        data={**identity,'files':files,'binary_sha256':release.sha256(target/binary)}
        temporary=state/'receipt.tmp';temporary.write_text(json.dumps(data,indent=2)+'\n')
        if receipt.exists():
            metadata=receipt.stat();temporary.chmod(metadata.st_mode&0o777);os.chown(temporary,metadata.st_uid,metadata.st_gid)
        os.replace(temporary,receipt)
    except BaseException:
        for dst,backup in reversed(changes):
            if backup:os.replace(backup,dst)
            else:dst.unlink()
        raise

def install(root,game):
    root=Path(root).resolve();state=root/'.voltra'/game;state.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.install-',dir=state) as directory:
        stage=Path(directory);ready=stage/'ready';ready.mkdir()
        if game=='cs2d':
            for index,asset in enumerate([CS_CLIENT,CS_SERVER]):
                if index==0 and not (root/'.voltra/public-cache'/asset['sha256']).is_file():
                    with urllib.request.urlopen(asset['url'],timeout=45) as response:page=response.read(2*1024**2).decode('utf-8')
                    match=re.search(r'href="([^"<>]*get\.php\?get=cs2d_1018_linux\.zip[^"<>]*cid=\d+[^"<>]*)"',page,re.I)
                    if not match:raise ValueError('Publisher client download confirmation not found')
                    url=urllib.parse.urljoin(asset['url'],html.unescape(match.group(1)))
                    if not url.startswith('https://www.unrealsoftware.de/get.php?get=cs2d_1018_linux.zip&'):raise ValueError('Unexpected publisher client download')
                    asset={**asset,'url':url}
                archive=stage/('archive-'+str(index));release.download(asset,archive);extract_zip(archive,ready)
            (ready/'cs2d_dedicated').chmod(0o755)
            publish(root,ready,root/'cs2d',{'game':game,'version':'1.0.1.8','archives':[CS_CLIENT,CS_SERVER]},'cs2d_dedicated')
        elif game=='openrct2':
            version=os.environ.get('VERSION','v0.5.6')
            if version=='develop':
                subprocess.run(['apt-get','update'],check=True)
                subprocess.run(['apt-get','install','-y','--no-install-recommends','git','cmake','ninja-build','g++','pkg-config','libicu-dev','libcurl4-openssl-dev','libpng-dev','libssl-dev','libzip-dev','nlohmann-json3-dev','libfreetype-dev','libfontconfig-dev','libduktape207','duktape-dev'],check=True)
                source=stage/'source';subprocess.run(['git','clone','--depth','1','--branch','develop','https://github.com/OpenRCT2/OpenRCT2.git',str(source)],check=True)
                subprocess.run(['cmake','-S',str(source),'-B',str(stage/'build'),'-G','Ninja','-DCMAKE_BUILD_TYPE=Release','-DDISABLE_GUI=ON','-DDISABLE_TTF=ON','-DDISABLE_GOOGLE_BENCHMARK=ON','-DDISABLE_DISCORD_RPC=ON','-DPORTABLE=ON'],check=True)
                subprocess.run(['cmake','--build',str(stage/'build'),'--parallel','2'],check=True)
                subprocess.run(['cmake','--install',str(stage/'build'),'--prefix',str(ready)],check=True)
                # Keep full installed layout and invoke bin/openrct2-cli.
                commit=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
                identity={'game':game,'version':'develop','commit':commit};binary='bin/openrct2-cli'
                shutil.copytree(source,ready/'source',ignore=shutil.ignore_patterns('.git','build'))
            else:
                asset=RCT
                if version not in ('v0.5.6','0.5.6'):
                    endpoint='latest' if version=='latest' else 'tags/'+urllib.parse.quote(version,safe='')
                    with urllib.request.urlopen('https://api.github.com/repos/OpenRCT2/OpenRCT2/releases/'+endpoint,timeout=45) as response:info=json.load(response)
                    found=next((a for a in info['assets'] if a['name'].endswith('linux-x86_64.AppImage')),None)
                    if not found or not found.get('digest','').startswith('sha256:'):raise ValueError('Release has no checksum-addressed Linux AppImage')
                    asset={'url':found['browser_download_url'],'sha256':found['digest'][7:]};version=info['tag_name']
                image=stage/'engine.AppImage';release.download(asset,image);image.chmod(0o755)
                subprocess.run([str(image),'--appimage-extract'],cwd=stage,check=True,stdout=subprocess.DEVNULL)
                source=stage/'squashfs-root/usr'
                for name in ['bin','lib','share']:shutil.copytree(source/name,ready/name,symlinks=False)
                identity={'game':game,'version':version,'archive':asset};binary='bin/openrct2-cli'
            publish(root,ready,root/'OpenRCT2',identity,binary)
            (root/'ServerData/save').mkdir(parents=True,exist_ok=True)
            default=root/'ServerData/save/save.park'
            if not default.exists():
                temporary=stage/'default.park';release.download(DEFAULT_PARK,temporary);os.replace(temporary,default)
        else:raise ValueError('Unknown native game')
    print('Native '+game+' installed; operator files retained.',flush=True)

if __name__=='__main__':
    import sys
    install(Path.cwd(),sys.argv[1])

