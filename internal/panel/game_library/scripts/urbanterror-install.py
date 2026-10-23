#!/usr/bin/env python3
"""MIT. Pinned unmodified FrozenSand Urban Terror package and native examples."""
from pathlib import Path
import shutil
from native_zip_release import install_release

RELEASE={'version':'4.3.4','prefix':'UrbanTerror43',
         'url':'https://cdn.urbanterror.info/urt/43/releases/zips/UrbanTerror434_full.zip',
         'sha256':'716669cc6c525663b791852e51ff9c94d96f382be39279dab6084dddacb5a4e7',
         'bytes':1472003870,
         'paths':['Quake3-UrT-Ded.x86_64','Quake3-UrT-Ded.i386','q3ut4/','COPYING.txt','README.txt','readme.txt','LICENSE.txt']}


def install(root):
    install_release(root,RELEASE,'urbanterror','Quake3-UrT-Ded.x86_64')
    game=root/'urbanterror'
    (game/'Quake3-UrT-Ded.i386').chmod(0o755)
    for example,target in [('server_example.cfg','server.cfg'),('mapcycle_example.txt','mapcycle.txt')]:
        destination=game/'q3ut4'/target
        if not destination.resolve().is_relative_to(root.resolve()):raise ValueError('Native example path escapes volume')
        if not destination.exists():shutil.copy2(game/'q3ut4'/example,destination)


if __name__=='__main__':install(Path.cwd())
