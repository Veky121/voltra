#!/usr/bin/env python3
"""MIT. Reviewed Java-game releases and typed Steam installation."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from native_config import private_write
from steam_template import update

JAVA8 = {'url':'https://github.com/adoptium/temurin8-binaries/releases/download/jdk8u504-b01/OpenJDK8U-jre_x64_linux_hotspot_8u504b01.tar.gz',
         'sha256':'52dcd578baca1d3e449ea86768a9129c0ee04d7b22565695498353cc66940c61','version':'1.8.0_504-b01'}
JAVA21 = {'url':'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jre_x64_linux_hotspot_21.0.13_9.tar.gz',
          'sha256':'a535a1df9c6284d9618872984e026ae0352d1f7e9e0605425c0e6114f47351dd','version':'21.0.13+9-LTS'}
STARMADE = {'url':'https://files.star-made.org/build/starmade-build_20261012_093817.zip',
            'sha256':'67165f971ac53553c68de8626b04ee198257c1736c48fea58d0a38dbcb7f0222','version':'0.305.11#20261012_094029'}


def confined(root, relative):
    path = root / relative
    if not path.resolve().is_relative_to(root):raise ValueError('Installation path leaves the server volume')
    return path


def digest(path):
    value=hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda:source.read(1048576),b''):value.update(block)
    return value.hexdigest()


def write_receipt(path, value):
    content=json.dumps(value,indent=2)+'\n'
    if path.is_file() and path.read_text()==content:return
    metadata=path.stat() if path.exists() else None
    private_write(path,content)
    # Receipts contain public release IDs/hashes, not authentication data.
    # Preserve operator ownership across root-run reinstalls and native updates.
    path.chmod(stat.S_IMODE(metadata.st_mode) if metadata else 0o644)
    if metadata:os.chown(path,metadata.st_uid,metadata.st_gid)


def download(root, release, maximum=2*1024**3):
    cache=confined(root,'.voltra/java-game/downloads');cache.mkdir(parents=True,exist_ok=True)
    target=confined(root,'.voltra/java-game/downloads/'+release['sha256'])
    if target.is_file() and digest(target)==release['sha256']:return target
    fd,temporary=tempfile.mkstemp(prefix='.download-',dir=cache)
    try:
        with os.fdopen(fd,'wb') as output,urllib.request.urlopen(release['url'],timeout=60) as response:
            if not response.url.startswith('https://'):raise ValueError('Publisher redirected outside HTTPS')
            total=0
            for block in iter(lambda:response.read(1048576),b''):
                total+=len(block)
                if total>maximum:raise ValueError('Publisher archive exceeds its size limit')
                output.write(block)
        if digest(Path(temporary))!=release['sha256']:raise ValueError('Publisher archive checksum mismatch')
        os.replace(temporary,target)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)
    return target


def member_path(name):
    path=PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name:raise ValueError('Archive path leaves its installation directory')
    return path


def java_runtime(root, release, label):
    if label not in ('java8','java21'):raise ValueError('Unknown reviewed Java runtime')
    target=confined(root,'.voltra/'+label);receipt=confined(root,'.voltra/java-game/'+label+'.json')
    if target.is_dir() and receipt.is_file() and json.loads(receipt.read_text())==release and (target/'bin/java').is_file():return
    if target.exists():raise ValueError('Existing Java runtime differs from the reviewed release; preserve and review it before replacement')
    archive=download(root,release,128*1024**2)
    with tempfile.TemporaryDirectory(prefix=label+'-',dir=root/'.voltra') as directory:
        staging=Path(directory)
        with tarfile.open(archive,'r:gz') as package:
            entries=package.getmembers()
            roots={member_path(entry.name).parts[0] for entry in entries if member_path(entry.name).parts}
            if len(roots)!=1:raise ValueError('Java archive has an unexpected layout')
            for entry in entries:
                relative=member_path(entry.name);destination=staging/str(relative)
                if not destination.resolve().is_relative_to(staging):raise ValueError('Java archive member leaves its installation directory')
                if entry.isdir():destination.mkdir(parents=True,exist_ok=True)
                elif entry.isfile():
                    destination.parent.mkdir(parents=True,exist_ok=True)
                    with package.extractfile(entry) as source,destination.open('wb') as output:shutil.copyfileobj(source,output)
                    destination.chmod(entry.mode&0o777)
                elif entry.issym():
                    destination.parent.mkdir(parents=True,exist_ok=True)
                    if not (destination.parent/entry.linkname).resolve().is_relative_to(staging):raise ValueError('Java archive symlink leaves its installation directory')
                    destination.symlink_to(entry.linkname)
                else:raise ValueError('Unsupported Java archive member')
        source=staging/next(iter(roots))
        if not (source/'bin/java').is_file():raise ValueError('Java runtime executable missing')
        os.replace(source,target)
    write_receipt(receipt,release)


def java8(root):java_runtime(root,JAVA8,'java8')


def starmade(root):
    archive=download(root,STARMADE)
    persistent={'server-database','server.cfg','admins.txt','banned.txt','whitelist.txt','mods','logs','blueprints','factions','server-message.txt'}
    with zipfile.ZipFile(archive) as package:
        entries=package.infolist()
        if sum(entry.file_size for entry in entries)>4*1024**3:raise ValueError('Expanded StarMade archive is too large')
        for entry in entries:
            relative=member_path(entry.filename)
            if not relative.parts or relative.parts[0]=='.voltra':raise ValueError('Unexpected StarMade archive member')
            if stat.S_ISLNK(entry.external_attr>>16):raise ValueError('StarMade archive contains a symlink')
            confined(root,str(relative))
        names=[entry.filename for entry in entries]
        if len(names)!=len(set(names)):raise ValueError('Duplicate StarMade archive member')
        if 'StarMade.jar' not in names or 'version.txt' not in names:raise ValueError('Unexpected StarMade release contents')
        version=package.getinfo('version.txt')
        if version.file_size>256 or package.read(version).decode('utf-8').strip()!=STARMADE['version']:raise ValueError('Unexpected StarMade release contents')
        preserved={name for name in persistent if (root/name).exists()}
        files={str(member_path(entry.filename)) for entry in entries if not entry.is_dir()}
        for entry in entries:
            relative=member_path(entry.filename)
            if relative.parts[0] in preserved:continue
            target=confined(root,str(relative))
            if any(str(parent) in files for parent in relative.parents if str(parent)!='.'):
                raise ValueError('Conflicting StarMade archive paths')
            if any(parent.exists() and not parent.is_dir() for parent in target.parents if parent.is_relative_to(root)):
                raise ValueError('StarMade destination parent is not a directory')
            if target.exists() and target.is_dir()!=entry.is_dir():raise ValueError('StarMade destination type differs')
        if package.testzip() is not None:raise ValueError('Corrupt StarMade archive member')
        for entry in entries:
            relative=member_path(entry.filename);target=confined(root,str(relative))
            if not relative.parts or relative.parts[0]=='.voltra':raise ValueError('Unexpected StarMade archive member')
            if relative.parts[0] in preserved:continue
            if entry.is_dir():target.mkdir(parents=True,exist_ok=True);continue
            target.parent.mkdir(parents=True,exist_ok=True)
            fd,temporary=tempfile.mkstemp(prefix='.publisher-',dir=target.parent)
            try:
                with os.fdopen(fd,'wb') as output,package.open(entry) as source:shutil.copyfileobj(source,output)
                os.chmod(temporary,0o644);os.replace(temporary,target)
            finally:
                if os.path.exists(temporary):os.unlink(temporary)
    if not (root/'StarMade.jar').is_file() or (root/'version.txt').read_text().strip()!=STARMADE['version']:raise ValueError('Unexpected StarMade release contents')
    write_receipt(confined(root,'.voltra/java-game/release.json'),STARMADE)


def rising_update(root, env, validate):
    # Publisher writes into a fresh tree. Existing worlds/plugins never enter it.
    with tempfile.TemporaryDirectory(prefix='voltra-rising-') as directory:
        stage=Path(directory)
        update(stage,339010,env,validate=validate,required=('server.jar',))
        entries=list(stage.rglob('*')); planned=[]
        for source in entries:
            relative=source.relative_to(stage)
            if relative.parts[0] in ('Worlds','plugins','server.properties') and (root/relative.parts[0]).exists():continue
            if relative.parts[:2]==('.voltra','steamcmd') and (root/'.voltra/steamcmd').exists():continue
            if source.is_symlink():raise ValueError('Unexpected publisher symlink')
            target=confined(root,str(relative))
            if target.is_symlink() or (target.exists() and target.is_dir()!=source.is_dir()):raise ValueError('Publisher destination type differs')
            if any(p.exists() and not p.is_dir() for p in target.parents if p.is_relative_to(root)):raise ValueError('Publisher destination parent differs')
            planned.append((source,target))
        for source,target in planned:
            if source.is_dir():target.mkdir(parents=True,exist_ok=True);continue
            target.parent.mkdir(parents=True,exist_ok=True)
            fd,temporary=tempfile.mkstemp(prefix='.rising-',dir=target.parent)
            try:
                with os.fdopen(fd,'wb') as output,source.open('rb') as incoming:shutil.copyfileobj(incoming,output)
                os.chmod(temporary,stat.S_IMODE(source.stat().st_mode));os.replace(temporary,target)
            finally:
                if os.path.exists(temporary):os.unlink(temporary)


def install(root, kind, env, validate=True):
    root=Path(root).resolve()
    if kind not in ('necesse','starmade','rising-world-java'):raise ValueError('Unknown reviewed Java game')
    if kind=='starmade':
        from java_games_runtime import validate_starmade
        validate_starmade(root,env)
    if kind=='necesse':
        from java_games_runtime import validate_necesse
        validate_necesse(env)
    if kind=='rising-world-java':
        from java_games_runtime import validate_rising
        validate_rising(root,env)
    effective_env=dict(env)
    if kind=='rising-world-java':
        branch=effective_env.get('SRCDS_BETAID') or 'java'
        effective_env['SRCDS_BETAID']='java' if branch=='legacy' else branch
    protected=['cfg/server.cfg'] if kind=='necesse' else ['server.properties'] if kind=='rising-world-java' else []
    saved={}
    for relative in protected:
        path=confined(root,relative)
        if path.is_file():
            if path.stat().st_size>4*1024**2:raise ValueError('Existing game configuration is too large')
            saved[relative]=(path.read_bytes(),path.stat())
    try:
        if kind=='rising-world-java':rising_update(root,effective_env,validate)
        elif kind=='starmade':starmade(root)
        else:update(root,1169370 if kind=='necesse' else 339010,effective_env,validate=validate,required=('Server.jar','jre/bin/java') if kind=='necesse' else ('server.jar',))
    finally:
        for relative,(content,metadata) in saved.items():
            path=confined(root,relative)
            if not path.exists() or path.read_bytes()!=content:
                path.parent.mkdir(parents=True,exist_ok=True)
                fd,temporary=tempfile.mkstemp(prefix='.restore-',dir=path.parent)
                try:
                    with os.fdopen(fd,'wb') as output:
                        output.write(content)
                        os.fchmod(output.fileno(),stat.S_IMODE(metadata.st_mode))
                        os.fchown(output.fileno(),metadata.st_uid,metadata.st_gid)
                    os.replace(temporary,path)
                finally:
                    if os.path.exists(temporary):os.unlink(temporary)
            elif path.stat().st_uid!=metadata.st_uid or path.stat().st_gid!=metadata.st_gid or stat.S_IMODE(path.stat().st_mode)!=stat.S_IMODE(metadata.st_mode):
                path.chmod(stat.S_IMODE(metadata.st_mode));os.chown(path,metadata.st_uid,metadata.st_gid)
    if kind=='rising-world-java':java8(root)
    if kind=='starmade':java_runtime(root,JAVA21,'java21')


if __name__=='__main__':install(Path.cwd(),sys.argv[1],os.environ)
