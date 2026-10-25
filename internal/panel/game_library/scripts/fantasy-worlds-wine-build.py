#!/usr/bin/env python3
"""MIT. Compile and verify the fixed Portal Knights PE32 console helper."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
from fantasy_worlds_runtime import confined, publish, publish_stream


def paths(root):
    root=Path(root).resolve()
    selected=[confined(root,'.voltra/'+name) for name in ('fantasy_worlds_wine_console.c','fantasy_worlds_wine_console.exe','fantasy_worlds_wine_console.json')]
    if any(p.is_symlink() or not p.resolve().is_relative_to(root) for p in selected):raise ValueError('Console helper escapes server volume')
    return selected


def digest(path,maximum):
    if not path.is_file() or path.stat().st_size>maximum:raise ValueError('Invalid bounded console helper artifact')
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verified_build(root):
    source,binary,receipt=paths(root)
    try:
        if receipt.stat().st_size>65536:return None
        record=json.loads(receipt.read_text())
        if not isinstance(record,dict) or record.get('schema_version')!=1 or record.get('source_sha256')!=digest(source,65536) or record.get('binary_sha256')!=digest(binary,4*1024**2):return None
        with binary.open('rb') as stream:
            if stream.read(2)!=b'MZ':return None
            stream.seek(60);offset=struct.unpack('<I',stream.read(4))[0]
            if offset>1024**2:return None
            stream.seek(offset)
            if stream.read(4)!=b'PE\0\0' or struct.unpack('<H',stream.read(2))[0]!=0x14c:return None
        return record
    except (OSError,ValueError,KeyError,struct.error):return None


def ensure(root):
    root=Path(root).resolve();source,binary,receipt=paths(root)
    existing=verified_build(root)
    if existing:return {**existing,'reused':True}
    source_hash=digest(source,65536)
    if not shutil.which('i686-w64-mingw32-gcc'):
        subprocess.run(['apt-get','install','-y','--no-install-recommends','gcc-mingw-w64-i686'],check=True,timeout=300)
    owner=root.stat();descriptor,name=tempfile.mkstemp(prefix='.console-',suffix='.exe',dir=binary.parent);os.close(descriptor)
    try:
        subprocess.run(['i686-w64-mingw32-gcc','-D_WIN32_WINNT=0x0600','-Wall','-Werror','-Os','-o',name,str(source)],check=True,timeout=60)
        if digest(source,65536)!=source_hash:raise ValueError('Console source changed during compilation')
        binary_hash=digest(Path(name),4*1024**2)
        with open(name,'rb')as stream:
            publish_stream(root,binary.relative_to(root).as_posix(),lambda output:shutil.copyfileobj(stream,output),mode=0o755)
        versions=subprocess.check_output(['dpkg-query','-W','-f=${Package}=${Version}\n','gcc-mingw-w64-i686','mingw-w64-i686-dev'],text=True,timeout=10)
        record={'schema_version':1,'source_sha256':source_hash,'binary_sha256':binary_hash,'target':'Windows PE32 i386','compiler':'i686-w64-mingw32-gcc','packages':versions.splitlines(),'provenance':'Own MIT source compiled with Debian signed APT MinGW toolchain; binary digest is computed build identity.'}
        publish(root,receipt.relative_to(root).as_posix(),(json.dumps(record,indent=2)+'\n').encode())
    finally:
        if os.path.exists(name):os.unlink(name)
    if not verified_build(root):raise ValueError('Compiled console helper verification failed')
    return {**record,'reused':False}
