#!/usr/bin/env python3
"""MIT. Verified publisher installations for Impostor and BetterCrewLink."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request

spec=importlib.util.spec_from_file_location('release',Path(__file__).with_name('native-release.py'))
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
ROOT=Path(os.environ.get('VOLTRA_SERVER_ROOT','/mnt/server')).resolve()
IMPOSTOR={'version':'v1.10.9','url':'https://github.com/Impostor/Impostor/releases/download/v1.10.9/Impostor-Server_1.10.9_linux-x64.tar.gz','sha256':'54ff18b773fe2cb6458a67d5ae5291b35d5f9f60054ca30e6fc49f07cc784ad8','prefix':None}
DOTNET={'version':'8.0.32','url':'https://builds.dotnet.microsoft.com/dotnet/aspnetcore/Runtime/8.0.32/aspnetcore-runtime-8.0.32-linux-x64.tar.gz','sha256':'bde0bb08f1f10d6dd60d0c3d8a220e33d7ce6d1c74c7098cf7f6a4e1a1ef5137','prefix':None}
NODE={'version':'24.22.1','url':'https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.xz','sha256':'6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6','prefix':'node-v24.22.1-linux-x64'}
YARN={'version':'1.22.22','url':'https://registry.npmjs.org/yarn/-/yarn-1.22.22.tgz','sha256':'c17d3797fb9a9115bf375e31bfd30058cac6bc9c3b8807a3d8cb2094794b51ca','prefix':'package'}
CREW_COMMIT='0e1d4b12e7a7201cda4db723d08d57baa5549432'
CREW_SHA='7f65a378fa4aa388ddb19aa344820ef48a4ba75768f50f49ed15791be44b84cf'
IMPOSTOR_LICENSE={'url':'https://raw.githubusercontent.com/Impostor/Impostor/v1.10.9/LICENSE','sha256':'3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986'}
LEGACY_DOTNET={
 '7':{'version':'7.0.20','url':'https://builds.dotnet.microsoft.com/dotnet/aspnetcore/Runtime/7.0.20/aspnetcore-runtime-7.0.20-linux-x64.tar.gz','publisher_sha512':'62ed9743972043a72e48d5aa2f7fdf3483cf684a32b051315004d1c778e9712bf66e5e7a97a5a53993fa8e92daf5bacaf2cdb3eae44bb9a9e25532b9a80f4f70'},
 '6':{'version':'6.0.36','url':'https://builds.dotnet.microsoft.com/dotnet/aspnetcore/Runtime/6.0.36/aspnetcore-runtime-6.0.36-linux-x64.tar.gz','publisher_sha512':'0e3d1dcc715bffbcb8ab8cb4fd72accbeed79ac40b7fd517961797a168f4301505044d2c1494a49b0e68103940bd6c178c8ae7bacf75f4b40ce82cc85624f6bd'},
}

def dotnet_release(root,channel):
    if channel=='8':return dict(DOTNET),'dotnet'
    if channel not in LEGACY_DOTNET:raise ValueError('DOTNET_CHANNEL must be 6, 7 or 8')
    identity=LEGACY_DOTNET[channel];name='dotnet-'+channel
    receipt=root/'.voltra'/name/'voltra-release.json'
    if receipt.is_file():
        previous=json.loads(receipt.read_text())
        if previous.get('publisher_sha512')==identity['publisher_sha512'] and previous.get('url')==identity['url']:return previous,name
    cache=root/'.voltra/public-cache';cache.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=cache,delete=False) as output:
        path=Path(output.name)
        try:
            with urllib.request.urlopen(identity['url'],timeout=120) as source:shutil.copyfileobj(source,output)
        except BaseException:path.unlink(missing_ok=True);raise
    if hashlib.sha512(path.read_bytes()).hexdigest()!=identity['publisher_sha512']:
        path.unlink();raise ValueError('Legacy .NET publisher SHA512 mismatch')
    digest=release.sha256(path);destination=cache/digest
    if destination.exists():path.unlink()
    else:path.rename(destination)
    return {**identity,'sha256':digest,'prefix':None},name

def api(url):
    request=urllib.request.Request(url,headers={'User-Agent':'Voltra-game-setup','Accept':'application/vnd.github+json'})
    with urllib.request.urlopen(request,timeout=60) as response:return json.load(response)

def impostor_release(version,checksum=''):
    if version=='v1.10.9':return dict(IMPOSTOR)
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,40}',version):raise ValueError('Invalid VERSION')
    data=api('https://api.github.com/repos/Impostor/Impostor/releases/'+('latest' if version=='latest' else 'tags/'+urllib.parse.quote(version,safe='')))
    assets=[x for x in data.get('assets',[]) if re.fullmatch(r'Impostor-Server_[A-Za-z0-9._-]+_linux-x64\.tar\.gz',x['name'])]
    if len(assets)!=1:raise ValueError('Selected release has no unique Linux x64 server')
    asset=assets[0];digest=asset.get('digest','')
    if not re.fullmatch(r'sha256:[0-9a-f]{64}',digest):
        if not re.fullmatch(r'[0-9a-f]{64}',checksum):raise ValueError('Older release needs RELEASE_SHA256 from its trusted publisher artifact')
        digest='sha256:'+checksum
    return {'version':data['tag_name'],'url':asset['browser_download_url'],'sha256':digest[7:],'bytes':asset['size'],'prefix':None}

def runtime(root,identity,name,executable,node_only=False):
    target=root/'.voltra'/name;receipt=target/'voltra-release.json'
    if receipt.is_file() and json.loads(receipt.read_text()).get('sha256')==identity['sha256'] and (target/executable).is_file():return
    target.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='runtime-',dir=root/'.voltra') as temporary:
        stage=Path(temporary);release.download(identity,stage/'archive');ready=stage/'ready';ready.mkdir()
        if node_only:
            # Portable Node needs the interpreter and notices only. npm symlinks
            # are intentionally excluded; Yarn runs using the reviewed interpreter.
            wanted={'bin/node','LICENSE','README.md','CHANGELOG.md'}
            with tarfile.open(stage/'archive','r:*') as source:
                for member in source:
                    prefix=identity['prefix']+'/'
                    if not member.name.startswith(prefix):continue
                    name_=member.name[len(prefix):]
                    if name_ not in wanted:continue
                    if not member.isfile():raise ValueError('Unexpected Node runtime member')
                    path=ready/name_;path.parent.mkdir(parents=True,exist_ok=True)
                    with source.extractfile(member) as inp,path.open('xb') as out:shutil.copyfileobj(inp,out)
                    path.chmod(member.mode&0o777)
            if not (ready/executable).is_file():raise ValueError('Node runtime missing interpreter')
        else:release.extract(stage/'archive',ready,identity['prefix'])
        (ready/'voltra-release.json').write_text(json.dumps(identity,indent=2)+'\n')
        backup=target.with_name(name+'-previous')
        if backup.exists():raise ValueError('Previous runtime recovery directory needs operator review')
        if target.exists():target.rename(backup)
        try:ready.rename(target)
        except BaseException:
            if backup.exists():backup.rename(target)
            raise
        if backup.exists():shutil.rmtree(backup)

def crew_release(root,branch,policy='pinned'):
    if policy not in ('pinned','follow_branch'):raise ValueError('Invalid SOURCE_POLICY')
    if not re.fullmatch(r'[A-Za-z0-9_./-]{1,100}',branch) or '..' in branch:raise ValueError('Invalid BRANCH')
    if branch==CREW_COMMIT or (branch=='master' and policy=='pinned'):commit=CREW_COMMIT;digest=CREW_SHA
    else:
        commit=api('https://api.github.com/repos/OhMyGuus/BetterCrewLink-server/commits/'+urllib.parse.quote(branch,safe=''))['sha'];digest=None
    if not re.fullmatch(r'[0-9a-f]{40}',commit):raise ValueError('Invalid publisher commit')
    url='https://codeload.github.com/OhMyGuus/BetterCrewLink-server/tar.gz/'+commit
    if digest is None:
        # Explicit alternate branches preserve the original source-selection API.
        # Resolve one immutable commit and record its TLS-fetched source identity.
        cache=root/'.voltra/public-cache';cache.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=cache,delete=False) as out:
            path=Path(out.name)
            try:
                with urllib.request.urlopen(url,timeout=120) as source:shutil.copyfileobj(source,out)
            except BaseException:path.unlink(missing_ok=True);raise
        digest=release.sha256(path);destination=cache/digest
        if destination.exists():path.unlink()
        else:path.rename(destination)
    return {'version':commit,'url':url,'sha256':digest,'prefix':'BetterCrewLink-server-'+commit}

def install(game,root=ROOT,env=None):
    env=dict(os.environ if env is None else env);root.mkdir(parents=True,exist_ok=True)
    if game=='impostor':
        dotnet,name=dotnet_release(root,env.get('DOTNET_CHANNEL','8'))
        runtime(root,dotnet,name,'dotnet')
        identity=impostor_release(env.get('VERSION','v1.10.9'),env.get('RELEASE_SHA256','').lower())
        release.install_release(root,identity,'impostor','Impostor.Server')
        migrate(root,'impostor',['config.json','plugins','plugin-config','logs'])
        notice=root/'impostor/LICENSE'
        if not notice.exists():release.download(IMPOSTOR_LICENSE,notice)
        source_notice=root/'impostor/SOURCE.txt'
        if not source_notice.exists():source_notice.write_text('Publisher source: https://github.com/Impostor/Impostor/tree/'+identity['version']+'\nOfficial release binaries are installed unmodified.\n')
    elif game=='crewlink':
        runtime(root,NODE,'node','bin/node',True);runtime(root,YARN,'yarn','bin/yarn.js')
        identity=crew_release(root,env.get('BRANCH','master'),env.get('SOURCE_POLICY','pinned'))
        release.install_release(root,identity,'crewlink','package.json')
        migrate(root,'crewlink',['.env','config/peerConfig.yml','privkey.pem','fullchain.pem'])
        cwd=root/'crewlink';source=cwd/'src/index.ts';content=source.read_text()
        marker='// Voltra lifecycle adapter: GPL-3.0-or-later modification.'
        if marker not in content:
            # Keep shutdown in the native server: Socket.IO closes its HTTP
            # listener and TURN closes its own sockets; Node exits naturally.
            source.write_text(content+'\n'+marker+'\nprocess.once("SIGINT", () => { io.close(); if (turnServer) turnServer.stop(); logger.info("Voltra native listeners closed"); });\n')
        child=dict(env);child['PATH']=str(root/'.voltra/node/bin')+os.pathsep+child.get('PATH','')
        command=[str(root/'.voltra/node/bin/node'),str(root/'.voltra/yarn/bin/yarn.js')]
        subprocess.run(command+['install','--frozen-lockfile','--ignore-scripts','--non-interactive'],cwd=cwd,env=child,check=True)
        subprocess.run(command+['run','compile'],cwd=cwd,env=child,check=True)
        (cwd/'VOLTRA-MODIFICATIONS.txt').write_text('Voltra adds a marked SIGINT lifecycle handler in src/index.ts. The original source and GPL-3.0-or-later LICENSE are retained. Native relay/application code is otherwise unchanged.\n')
    else:raise ValueError('Unknown Among Us service')

def migrate(root,game,names):
    """Import original egg layout once without moving/deleting operator files."""
    marker=root/'.voltra'/game/'legacy-layout-imported.json'
    if marker.exists():return
    imported=[]
    for name in names:
        source=root/name;destination=root/game/name
        if not source.exists():continue
        if source.is_symlink() or not source.resolve().is_relative_to(root):raise ValueError('Legacy operator path escapes volume')
        if source.is_dir():
            if any(p.is_symlink() for p in source.rglob('*')):raise ValueError('Legacy operator directory contains symlinks; migrate manually')
            if destination.exists():raise ValueError('Legacy operator directory conflicts with installed layout: '+name)
            shutil.copytree(source,destination,copy_function=shutil.copy2)
        else:
            destination.parent.mkdir(parents=True,exist_ok=True)
            if destination.exists() and name!='config.json':continue
            shutil.copy2(source,destination)
        imported.append(name)
    marker.write_text(json.dumps({'copied':imported,'source_files_retained':True},indent=2)+'\n')

if __name__=='__main__':install(sys.argv[1])
