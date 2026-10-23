#!/usr/bin/env python3
"""MIT. Reviewed public Quake Live and SS14 acquisition adapters."""
import sys
import platform
from pathlib import Path
from native_zip_release import install_release as zip_install
from native_release import install_release as tar_install

SS14=dict(version='94087a918a2fae4571f5a529fe14ef7f5dce29a3',url='https://wizards.cdn.spacestation14.com/fork/wizards/version/94087a918a2fae4571f5a529fe14ef7f5dce29a3/file/SS14.Server_linux-x64.zip',sha256='72cfe586368190edcd53f074da1a3e9a03f7f63486bf628a3ad2c7bdb2487187',bytes=43600064,prefix=None)
DOTNET=dict(version='10.0.13',url='https://builds.dotnet.microsoft.com/dotnet/Runtime/10.0.13/dotnet-runtime-10.0.13-linux-x64.tar.gz',sha256='958c952691d2c3f8ce21f717f4e911c02b5da0e21ead21bd576368c454b79c77',bytes=36648012,prefix=None)
SS14_ARM64={**SS14,'url':SS14['url'].replace('linux-x64','linux-arm64'),'sha256':'607d79dcd0d7afa331a009d5ffb916ca2b8ff46b8bf5a7ea33650cae02ca518c','bytes':43317903}
DOTNET_ARM64={**DOTNET,'url':DOTNET['url'].replace('linux-x64','linux-arm64'),'sha256':'e1274f06c9f891737afc32dc9e0e1cbc62d4a1e4b1eac27df50ffb7c00dd87f6','bytes':34401179}

def releases(machine):
 if machine in ('x86_64','amd64'):return DOTNET,SS14
 if machine in ('aarch64','arm64'):return DOTNET_ARM64,SS14_ARM64
 raise ValueError('SS14 requires Linux x64 or arm64')

def install(root,kind):
 root=Path(root).resolve()
 if kind=='quakelive':
  from source_install import update
  return update(root,349090,required=('qzeroded.x64',))
 if kind!='ss14':raise ValueError('Unknown reviewed game')
 runtime,game=releases(platform.machine())
 tar_install(root,runtime,'dotnet','dotnet')
 zip_install(root,game,'ss14','Robust.Server')
 print('Checked SS14 publisher build and supported .NET runtime retained.',flush=True)

if __name__=='__main__':install(Path.cwd(),sys.argv[1])
