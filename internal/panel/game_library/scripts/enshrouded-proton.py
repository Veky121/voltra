#!/usr/bin/env python3
"""MIT. Pinned per-server GE-Proton; archive licenses remain beside its files."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import shutil
import tarfile
import tempfile
import urllib.request

VERSION='GE-Proton11-9'
ARCHIVE_ROOT=VERSION+'-x86_64'
SHA256='b2cf4a632a70ec321cdb9904fa396a2a45d4061129f9fdc89d8a27ea5ceeb9d6'
SHA512='30160946a5e4ffdf1f29d6f83a3d27108f6aa71b6aa59095b2c2260fe3a003b62acf8fdcb02a3dfc602b28473f5679d8a3eaee5a8adb141c1dfa01c42888da2d'
URL='https://github.com/GloriousEggroll/proton-ge-custom/releases/download/'+VERSION+'/'+VERSION+'-x86_64.tar.gz'


def digest(path):
    first,second=hashlib.sha256(),hashlib.sha512()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1048576),b''):first.update(block);second.update(block)
    return first.hexdigest(),second.hexdigest()


def unpack(archive, stage):
    """Bounded extraction, including confined distribution links on Python 3.11."""
    seen=set();links=[];total=0
    with tarfile.open(archive,'r:gz') as source:
        for member in source:
            path=PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or '\\' in member.name or not path.parts or path.parts[0]!=ARCHIVE_ROOT:raise ValueError('Unsafe Proton archive path')
            relative=PurePosixPath(*path.parts[1:])
            if str(relative)=='.':continue
            if str(relative) in seen:raise ValueError('Duplicate Proton archive member')
            seen.add(str(relative));total+=member.size
            if len(seen)>100000 or total>8*1024**3:raise ValueError('Proton archive expansion exceeds its limit')
            target=stage.joinpath(*relative.parts)
            if not target.parent.resolve().is_relative_to(stage.resolve()):raise ValueError('Proton archive leaves staging directory')
            if member.isdir():target.mkdir(parents=True,exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True,exist_ok=True)
                with source.extractfile(member) as inp,target.open('xb') as output:shutil.copyfileobj(inp,output)
                target.chmod(member.mode&0o777)
            elif member.issym() or member.islnk():
                link=PurePosixPath(member.linkname)
                if link.is_absolute() or '\\' in member.linkname:raise ValueError('External Proton distribution link')
                if member.islnk():
                    if not link.parts or link.parts[0]!=ARCHIVE_ROOT:raise ValueError('Invalid Proton hard link')
                    resolved=posixpath.normpath(str(PurePosixPath(*link.parts[1:])))
                else:resolved=posixpath.normpath(str(relative.parent/link))
                if resolved=='..' or resolved.startswith('../'):raise ValueError('Proton link escapes staging directory')
                links.append((target,member.linkname,stage/resolved,member.issym()))
            else:raise ValueError('Unsupported Proton archive member')
    for target,link,resolved,symbolic in links:
        if not target.parent.resolve().is_relative_to(stage.resolve()) or not resolved.resolve().is_relative_to(stage.resolve()):raise ValueError('Proton link chain escapes staging directory')
        target.parent.mkdir(parents=True,exist_ok=True)
        if symbolic:target.symlink_to(link)
        else:
            if not resolved.is_file():raise ValueError('Proton hard link target is missing')
            os.link(resolved,target)


def location(root):
    root=Path(root).resolve();target=root/'.voltra/proton'/VERSION/'proton'
    if not target.resolve().is_relative_to(root) or not target.is_file():raise ValueError('Reviewed GE-Proton runtime is missing; reinstall this recipe')
    return target


def provision(root):
    root=Path(root).resolve();base=root/'.voltra/proton';target=base/VERSION
    if base.is_symlink() or target.is_symlink() or not base.resolve().is_relative_to(root):raise ValueError('Proton destination leaves the volume')
    base.mkdir(parents=True,exist_ok=True)
    bridge=target/'files/lib/wine/x86_64-unix/lsteamclient.so';receipt=base/'release.json'
    if receipt.is_file() and target.is_dir():
        previous=json.loads(receipt.read_text())
        if previous.get('sha512')==SHA512 and location(root).is_file() and bridge.is_file() and hashlib.sha256(bridge.read_bytes()).hexdigest()==previous.get('bridge_sha256'):return previous
        raise ValueError('Existing GE-Proton installation differs; keep it for operator review')
    with tempfile.TemporaryDirectory(prefix='.proton-',dir=base) as temporary:
        stage=Path(temporary);archive=stage/'source.tar.gz';cached=root/'.voltra/public-cache'/SHA256
        if cached.exists():
            if cached.is_symlink() or not cached.resolve().is_relative_to(root) or digest(cached)!=(SHA256,SHA512):raise ValueError('Cached GE-Proton archive failed integrity validation')
            archive=cached
        else:
            with urllib.request.urlopen(URL,timeout=120) as response,archive.open('xb') as output:
                if not response.geturl().startswith('https://'):raise ValueError('Proton archive redirected outside HTTPS')
                count=0
                for block in iter(lambda:response.read(1048576),b''):
                    count+=len(block)
                    if count>1024**3:raise ValueError('Proton archive exceeds its download limit')
                    output.write(block)
            if digest(archive)!=(SHA256,SHA512):raise ValueError('Publisher GE-Proton checksum mismatch')
        ready=stage/'ready';ready.mkdir();unpack(archive,ready)
        native_bridge=ready/'files/lib/wine/x86_64-unix/lsteamclient.so'
        sdk=root/'.steam/sdk64/steamclient.so'
        if not (ready/'proton').is_file() or not all(p.is_file() and b'SteamUtils011' in p.read_bytes() for p in (native_bridge,sdk)):raise ValueError('Proton or native Steam SDK lacks SteamUtils011')
        if target.exists():raise ValueError('Unreceipted existing GE-Proton directory needs operator review')
        os.replace(ready,target)
    library=base/'lib';library.mkdir(exist_ok=True)
    if library.is_symlink() or not library.resolve().is_relative_to(root):raise ValueError('Proton library path leaves the volume')
    shutil.copy2('/usr/lib/x86_64-linux-gnu/libvulkan.so.1',library/'libvulkan.so.1')
    previous={'version':VERSION,'url':URL,'sha256':SHA256,'sha512':SHA512,'bridge_sha256':hashlib.sha256(bridge.read_bytes()).hexdigest(),'licenses':'Included unchanged in the extracted publisher distribution','cache_hit':archive==cached}
    receipt.write_text(json.dumps(previous,indent=2)+'\n');return previous
