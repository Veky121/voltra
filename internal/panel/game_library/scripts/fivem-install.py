#!/usr/bin/env python3
"""MIT integration. Pinned public FXServer runtime and immutable base resources."""
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import tarfile
import tempfile
import urllib.request
import zipfile

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'));result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

RELEASE={'version':'35245','url':'https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/35245-6efb47dff473c0e2a12fb50b08d74c0eb24a50d5/fx.tar.xz','sha256':'16fcffd53a30a3909cbb2cfd26f89f950a59452792cafd0eda2174bdfeef9b2f','bytes':70603408,'prefix':None}
DATA={'version':'c6afa3909c763e3327ed76825e78453286c99f05','url':'https://codeload.github.com/citizenfx/cfx-server-data/tar.gz/c6afa3909c763e3327ed76825e78453286c99f05','sha256':'f4d7f7a20c0cbb9905db150b81ea4be103eb38ebe0a3a60615592a758c576960','bytes':344895,'prefix':'cfx-server-data-c6afa3909c763e3327ed76825e78453286c99f05'}

def identity(env):
    version=env.get('FIVEM_VERSION',env.get('CFX_VERSION',RELEASE['version']));custom=env.get('DOWNLOAD_URL','')
    if version==RELEASE['version'] and not custom:return dict(RELEASE)
    checksum=env.get('FIVEM_RELEASE_SHA256','').lower()
    if not re.fullmatch(r'[0-9a-f]{64}',checksum):raise ValueError('Other channels/builds/custom archives require reviewed FIVEM_RELEASE_SHA256')
    if custom:
        if not custom.startswith('https://'):raise ValueError('Custom DOWNLOAD_URL requires HTTPS')
        return {'version':'operator-'+checksum[:12],'url':custom,'sha256':checksum,'prefix':None}
    if re.fullmatch(r'[0-9]{1,8}-[0-9a-f]{40}',version):return {'version':version,'url':'https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/'+version+'/fx.tar.xz','sha256':checksum,'prefix':None}
    if version not in ['recommended','latest'] and not re.fullmatch(r'[0-9]{1,8}',version):raise ValueError('Invalid FIVEM_VERSION/CFX_VERSION')
    with urllib.request.urlopen('https://changelogs-live.fivem.net/api/changelog/versions/linux/server',timeout=60) as response:data=json.load(response)
    if version in ['recommended','latest']:url=data[version+'_download']
    else:
        # Select exact publisher build from its index; never silently substitute.
        with urllib.request.urlopen('https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/',timeout=60) as response:index=response.read().decode()
        links=re.findall(r'href=["\']([^"\']+)["\']',index);matching=[link for link in links if re.fullmatch(version+r'-[0-9a-f]{40}/?',link)]
        if len(matching)!=1:raise ValueError('Exact publisher build not found')
        url='https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/'+matching[0].rstrip('/')+'/fx.tar.xz'
    return {'version':version,'url':url,'sha256':checksum,'prefix':None}

def extract_runtime(archive,target,prefix):
    """Materialize only publisher runtime libraries, with contained link targets.

    Alpine absolute links refer to the bundled Alpine root, never host paths.
    No archive link is created on disk; no devices/proc or host tools are used.
    """
    if zipfile.is_zipfile(archive):return extract_zip_runtime(archive,target)
    with tarfile.open(archive,'r:*') as source:
        members={};total=0
        for item in source:
            name=item.name.rstrip('/');parts=PurePosixPath(name).parts
            if not parts or item.name.startswith('/') or '..' in parts or '\\' in item.name or name in members:raise ValueError('Unsafe FXServer archive path')
            if not (item.isfile() or item.isdir() or item.issym() or item.islnk()):raise ValueError('Unsupported FXServer special file')
            members[name]=item;total+=item.size
            if len(members)>100000 or total>4*1024**3:raise ValueError('FXServer archive exceeds limits')
        def resolve(name,seen=()):
            if name in seen or len(seen)>32 or name not in members:raise ValueError('Unresolved FXServer runtime link')
            item=members[name]
            if item.issym() or item.islnk():
                link=item.linkname
                destination=posixpath.normpath(('alpine/'+link.lstrip('/')) if link.startswith('/') else (link if item.islnk() else posixpath.join(posixpath.dirname(name),link)))
                if destination.startswith('../') or destination.startswith('/') or '\\' in destination:raise ValueError('FXServer link escapes archive')
                return resolve(destination,(*seen,name))
            return item
        for name,item in members.items():
            if not name.startswith(('alpine/opt/cfx-server/','alpine/lib/','alpine/usr/lib/','alpine/usr/share/licenses/','alpine/usr/glibc-compat/lib/')):continue
            if item.isdir():continue
            original=resolve(name)
            if not original.isfile():continue
            path=target.joinpath(*PurePosixPath(name).parts);path.parent.mkdir(parents=True,exist_ok=True)
            with source.extractfile(original) as inp,path.open('xb') as out:shutil.copyfileobj(inp,out)
            path.chmod(original.mode&0o777)

def extract_zip_runtime(archive,target):
    """Preserve the original custom ZIP download API with confined links."""
    with zipfile.ZipFile(archive) as source:
        members={};total=0
        for item in source.infolist():
            name=item.filename.rstrip('/');parts=PurePosixPath(name).parts
            if not parts or name.startswith('/') or '..' in parts or '\\' in name or name in members:raise ValueError('Unsafe FXServer ZIP path')
            members[name]=item;total+=item.file_size
            if len(members)>100000 or total>4*1024**3:raise ValueError('FXServer ZIP exceeds limits')
        def resolve(name,seen=()):
            if name in seen or len(seen)>32 or name not in members:raise ValueError('Unresolved FXServer ZIP link')
            item=members[name]
            if ((item.external_attr>>16)&0o170000)==0o120000:
                link=source.read(item).decode('utf-8')
                destination=posixpath.normpath('alpine/'+link.lstrip('/') if link.startswith('/') else posixpath.join(posixpath.dirname(name),link))
                if destination.startswith('../') or destination.startswith('/') or '\\' in destination:raise ValueError('FXServer ZIP link escapes archive')
                return resolve(destination,(*seen,name))
            return item
        for name,item in members.items():
            if item.is_dir() or not name.startswith(('alpine/opt/cfx-server/','alpine/lib/','alpine/usr/lib/','alpine/usr/share/licenses/','alpine/usr/glibc-compat/lib/')):continue
            original=resolve(name)
            if original.is_dir():continue
            path=target.joinpath(*PurePosixPath(name).parts);path.parent.mkdir(parents=True,exist_ok=True)
            with source.open(original) as inp,path.open('xb') as out:shutil.copyfileobj(inp,out)
            path.chmod(((original.external_attr>>16)&0o777) or (0o755 if name.endswith(('/FXServer','/ld-musl-x86_64.so.1')) else 0o644))

def install(root,env):
    root=root.resolve()
    if any(not (root/name).resolve().is_relative_to(root) for name in ['.voltra/fivem','.voltra/public-cache','.voltra/gta-seeds']):raise ValueError('FXServer installer state escapes volume')
    release=module('native-release');release.extract=extract_runtime
    release.install_release(root,identity(env),'fivem','alpine/opt/cfx-server/FXServer')
    # Seed once. Existing resources, custom recipes and deliberate deletions
    # are retained, independent of later engine updates or reinstall.
    module('gta-install').copy_missing(root,DATA,root)
    cfg=root/'server.cfg'
    if not cfg.exists():
        game=env.get('TXHOST_GAME_NAME',env.get('VOLTRA_CFX_GAME','fivem'))
        module('native-config').private_write(cfg,'# Native operator configuration; Voltra manages only its declared convars.\nensure mapmanager\nensure chat\nensure spawnmanager\nensure sessionmanager\nensure basic-gamemode\n'+('ensure redm-map-one\n' if game=='redm' else '')+'ensure hardcap\nensure rconlog\nset onesync on\n')

if __name__=='__main__':install(Path(os.environ.get('VOLTRA_SERVER_ROOT','/mnt/server')),os.environ)
