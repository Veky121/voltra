#!/usr/bin/env python3
"""MIT. Compile and verify the fixed Contagion PE32 console input helper."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile


def paths(root):
    root=Path(root).resolve()
    selected=[root/'.voltra'/name for name in ('source_wine_console.c','source_wine_console.exe','source_wine_console.json')]
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
        binary_hash=digest(Path(name),4*1024**2);os.chmod(name,0o755);os.chown(name,owner.st_uid,owner.st_gid);os.replace(name,binary)
        versions=subprocess.check_output(['dpkg-query','-W','-f=${Package}=${Version}\n','gcc-mingw-w64-i686','mingw-w64-i686-dev'],text=True,timeout=10)
        record={'schema_version':1,'source_sha256':source_hash,'binary_sha256':binary_hash,'target':'Windows PE32 i386','compiler':'i686-w64-mingw32-gcc','packages':versions.splitlines(),'provenance':'Own MIT source compiled with Debian signed APT MinGW toolchain; binary digest is computed build identity.'}
        fd,temporary=tempfile.mkstemp(prefix='.console-receipt-',dir=receipt.parent)
        try:
            with os.fdopen(fd,'w')as stream:json.dump(record,stream,indent=2);stream.write('\n')
            os.chown(temporary,owner.st_uid,owner.st_gid);os.replace(temporary,receipt)
        finally:
            if os.path.exists(temporary):os.unlink(temporary)
    finally:
        if os.path.exists(name):os.unlink(name)
    if not verified_build(root):raise ValueError('Compiled console helper verification failed')
    return {**record,'reused':False}
