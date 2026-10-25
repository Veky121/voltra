"""MIT. Copy only three verified existing public SteamCMD SDK ELF libraries."""
from pathlib import Path
import fcntl
import hashlib
import json
import os
import re
import stat
import struct
import sys
import tarfile

run,uid,gid=sys.argv[1:]
if not re.fullmatch('[a-f0-9-]{36}',run):raise ValueError('Exact own run required')
root=Path('/host/managed-proton')/run/'home'
if root.is_symlink() or not root.is_dir():raise ValueError('Own existing directory required')
archive_sha='e3414c3ba26341647905c1324da13bee1ba80fd07eb0bb2a6d2e3e3fc7fe546b'
entries={
 'linux64/steamclient.so':('3e32119f473cb9c2615e1b282da8498b9986378e8b71537a4aed9f77e7b797e0',47709360),
 'linux64/libtier0_s.so':('8d0622e0ecd9a7c853e0dba0fcc707df34d4876f5ae7a2296ced596e4269931e',416568),
 'linux64/libvstdlib_s.so':('642875157a7aa15dafafdf10031c5252bc70a758a90665ad72c69197c0caff47',1394272),
}
manifest=json.loads(Path('/public-manifest.json').read_bytes())
if manifest['archive_sha256']!=archive_sha or manifest['kind']!='public-steamcmd-updated':raise ValueError('Reviewed public source manifest required')
archive=Path('/public-cache/sha256')/archive_sha
with open('/public-cache/.capacity.lock','rb') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX)
    if archive.is_symlink() or not stat.S_ISREG(archive.stat().st_mode) or archive.stat().st_size!=61758781:raise ValueError('Exact existing public cache archive required')
    with archive.open('rb') as stream:
        digest=hashlib.file_digest(stream,'sha256').hexdigest()
    if digest!=archive_sha:raise ValueError('Public archive checksum mismatch')
    payloads={}
    with tarfile.open(archive,'r:gz') as source:
        for name,(sha,size) in entries.items():
            pin=manifest['files'][name]
            if pin['sha256']!=sha or pin['bytes']!=size:raise ValueError('Public SDK pin differs')
            member=source.getmember(name)
            if not member.isfile() or member.size!=size:raise ValueError('Ordinary pinned SDK file required')
            data=source.extractfile(member).read(size+1)
            if len(data)!=size or hashlib.sha256(data).hexdigest()!=sha:raise ValueError('SDK checksum mismatch')
            if data[:6]!=b'\x7fELF\x02\x01' or struct.unpack_from('<H',data,18)[0]!=62:raise ValueError('Native Linux AMD64 ELF required')
            payloads[name]=data
    for name,data in payloads.items():
        target=root/'.steam/sdk64'/Path(name).name
        if target.exists() or target.is_symlink():raise ValueError('Fresh SDK destination required')
        for parent in (root/'.steam',root/'.steam/sdk64'):
            if parent.is_symlink():raise ValueError('SDK parent link refused')
            parent.mkdir(mode=0o700,exist_ok=True);os.chown(parent,int(uid),int(gid))
        with target.open('xb') as stream:stream.write(data)
        target.chmod(0o500);os.chown(target,int(uid),int(gid))
    print(json.dumps({'source_archive':archive_sha,'no_account_state':True,'libraries':{name:{'sha256':sha,'bytes':size,'target':'.steam/sdk64/'+Path(name).name,'elf':'linux/amd64'} for name,(sha,size) in entries.items()}}))
