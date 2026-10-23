#!/usr/bin/env python3
"""MIT. Pinned ET: Legacy engine and original publisher data without shell execution."""
import hashlib
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import zipfile
from native_release import download,install_release,sha256

RELEASES={
 '32':{'version':'2.86.2-i386','prefix':'etlegacy-v2.86.2-i386','url':'https://www.etlegacy.com/download/file/787','sha256':'30179f4a1e070be43370fa4c1096ab9b04da4f96a01a1ce47297ce46a0a4773a','bytes':91076857},
 '64':{'version':'2.86.2-x86_64','prefix':'etlegacy-v2.86.2-x86_64','url':'https://www.etlegacy.com/download/file/785','sha256':'7f0d5aa3f630cbe6574592d1f41b2feb5542c5e7decada30f84251b3f8908018','bytes':92464590}}
ASSETS={'url':'https://cdn.splashdamage.com/downloads/games/wet/et260b.x86_full.zip','sha256':'2a8fef8e8558efffcad658bb9a8b12df8740418b3514142350eba3b7641eb3e0','bytes':275647724}
PACKAGES={'pak0.pk3':'712966b20e06523fe81419516500e499c86b2b4fec823856ddbd333fcb3d26e5',
          'pak1.pk3':'5610fd749024405b4425a7ce6397e58187b941d22092ef11d4844b427df53e5d',
          'pak2.pk3':'a48ab749a1a12ab4d9137286b1f23d642c29da59845b2bafc8f64e052cf06f3e'}


def install_assets(root):
    game=root/'etlegacy'
    for folder in [root/'.voltra/etlegacy',game/'etmain',game/'licenses/original-et']:
        if not folder.resolve().is_relative_to(root.resolve()):raise ValueError('Native assets path escapes volume')
        folder.mkdir(parents=True,exist_ok=True)
    if all((game/'etmain'/name).is_file() for name in PACKAGES) and (game/'licenses/original-et/EULA_Wolfenstein_Enemy_Territory.txt').is_file():
        print('Original Enemy Territory data and operator overrides retained.',flush=True)
        return
    with tempfile.TemporaryDirectory(prefix='.assets-',dir=root/'.voltra/etlegacy') as directory:
        stage=Path(directory)
        download(ASSETS,stage/'original.zip')
        found=set()
        with zipfile.ZipFile(stage/'original.zip') as zipped,zipped.open('et260b.x86_keygen_V03.run') as installer:
            # The digest-pinned publisher Makeself script stores gzip after 401 lines.
            # Read data only; do not execute its historic installer or key generator.
            for _ in range(401):
                if not installer.readline():raise ValueError('Truncated original ET installer header')
            with tarfile.open(fileobj=installer,mode='r|gz') as archive:
                for member in archive:
                    name=member.name.removeprefix('./')
                    target=None
                    if name.startswith('etmain/') and name[7:] in PACKAGES:
                        target=game/name
                    elif name in ('Docs/EULA_Wolfenstein_Enemy_Territory.txt','Docs/License.rtf'):
                        target=game/'licenses/original-et'/Path(name).name
                    if target is None:continue
                    if not member.isfile() or member.size>256*1024**2:raise ValueError('Invalid original ET data member')
                    temporary=stage/Path(name).name
                    with archive.extractfile(member) as inp,temporary.open('xb') as out:shutil.copyfileobj(inp,out)
                    if Path(name).name in PACKAGES and sha256(temporary)!=PACKAGES[Path(name).name]:
                        raise ValueError('Original ET package digest mismatch')
                    found.add(name)
                    if not target.resolve().is_relative_to(root.resolve()):raise ValueError('Original ET asset escapes volume')
                    if not target.exists():os.replace(temporary,target)
        if not all('etmain/'+name in found for name in PACKAGES):raise ValueError('Original ET archive missing game data')


def install(root,env):
    architecture=env.get('ET_VERSION','32')
    if architecture not in RELEASES:raise ValueError('ET_VERSION must be 32 or 64')
    install_release(root,RELEASES[architecture],'etlegacy','etlded.'+('i386' if architecture=='32' else 'x86_64'))
    install_assets(root)


if __name__=='__main__':install(Path.cwd(),os.environ)
