#!/usr/bin/env python3
"""MIT. Checked ID-family engine/data publication with operator preservation."""
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
from native_release import download, extract as tar_extract, sha256
from native_zip_release import extract as zip_extract

RELEASES={
 'zandronum':[
  dict(version='3.2.1',url='https://zandronum.com/downloads/zandronum3.2.1-linux-x86_64.tar.bz2',sha256='9f4b93ed99ab15d2406e697e2a06d956eb808c9ac2e53e62ae9f1affb53c86c0',bytes=8355843,prefix=None,format='tar',destination=''),
  dict(version='Freedoom0.13.0',url='https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip',sha256='3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59',bytes=24143781,prefix='freedoom-0.13.0',format='zip',destination='IWAD'),
 ],
 'nzportable':[
  dict(version='FTE2026-07-13',url='https://fastdl.idtech.space/bin/fteqw-linux-x86_64-2026-07-13.zip',sha256='0478478467cb147703f5501515a8e5043d87b188358bd75d4c7942820a232c2c',bytes=43835170,prefix='fteqw-2026-07-13',format='zip',destination=''),
  dict(version='assets2026-10-21',url='https://github.com/nzp-team/assets/releases/download/newest/pc-nzp-assets.zip',sha256='ce24eec0780995b23b12a2b07fa59c9ae414bbf533627f9cc1671b369ab9aa8a',bytes=72336229,prefix=None,format='zip',destination=''),
  dict(version='QuakeC2026-10-21',url='https://github.com/nzp-team/quakec/releases/download/bleeding-edge/standard-nzp-qc.zip',sha256='69ca9770f9b0d74e29d2cddeefc56c63eeaf781d4160f91edb2375799a7c0cf9',bytes=185263,prefix=None,format='zip',destination='nzp'),
 ]}

def confined(root,path):
 if not path.resolve().is_relative_to(root.resolve()):raise ValueError('ID-family path escapes server volume')
 return path

def install(root,kind):
 root=root.resolve();game=confined(root,root/kind);state=confined(root,root/'.voltra'/kind);state.mkdir(parents=True,exist_ok=True)
 receipt=confined(root,state/'release.json');old=json.loads(receipt.read_text()) if receipt.is_file() else {}
 binary='zandronum-server' if kind=='zandronum' else 'fteqw-sv64';releases=RELEASES[kind]
 if old.get('releases')==releases and (game/binary).is_file() and sha256(game/binary)==old.get('binary_sha256') and all((game/p).is_file() for p in old.get('files',{})):
  print('Checked ID-family release and operator files retained.',flush=True)
 else:
  with tempfile.TemporaryDirectory(prefix='.stage-',dir=state) as temp:
   stage=Path(temp);ready=stage/'ready';ready.mkdir()
   for index,release in enumerate(releases):
    archive=stage/('archive-'+str(index));download(release,archive)
    destination=ready/release['destination'];destination.mkdir(parents=True,exist_ok=True)
    (zip_extract if release['format']=='zip' else tar_extract)(archive,destination,release['prefix'])
   if not (ready/binary).is_file():raise ValueError('Publisher archive lacks native dedicated binary')
   (ready/binary).chmod(0o755)
   files={p.relative_to(ready).as_posix():sha256(p) for p in ready.rglob('*') if p.is_file()}
   backup=state/('previous-'+str(time.time_ns()));replacements=[]
   try:
    for name in files:
     source=ready/name;destination=confined(root,game/name);saved=None
     if destination.exists():
      if name!=binary and (name.endswith(('.cfg','.ini','.txt','.wad')) or name not in old.get('files',{}) or sha256(destination)!=old['files'][name]):continue
      saved=backup/name;saved.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(destination,saved)
     destination.parent.mkdir(parents=True,exist_ok=True);os.replace(source,destination);replacements.append((destination,saved))
    result=stage/'receipt.json';result.write_text(json.dumps(dict(releases=releases,files=files,binary_sha256=sha256(game/binary)),indent=2)+'\n');os.replace(result,receipt)
   except BaseException:
    for destination,saved in reversed(replacements):
     if saved is None:destination.unlink()
     else:os.replace(saved,destination)
    raise
 if kind=='zandronum':
  for folder in ['IWAD','PWAD']:confined(root,game/folder).mkdir(exist_ok=True)
  for name in ['adminlist.txt','whitelist.txt','banlist.txt']:
   p=confined(root,game/name)
   if not p.exists():p.write_text('')
  p=confined(root,game/'zandronum.ini')
  if not p.exists():shutil.copy2(root/'.voltra/zandronum-default.ini',p)
  if os.environ.get('GEOIP','1')=='1':
   p=confined(root,game/'GeoIP.dat')
   if not p.exists():shutil.copy2(root/'.voltra/zandronum-GeoIP.dat',p)
 if kind=='nzportable':
  manifest=confined(root,game/'default.fmf')
  if not manifest.exists():manifest.write_text('FTEManifestVer 1\ngame nzp\nname "Nazi Zombies: Portable"\nbasegame nzp\nmainconfig "config"\n')
 notice=confined(root,game/'PUBLISHER-SOURCES.txt')
 if not notice.exists():
  notice.write_text('Unmodified publisher binaries and complete downloaded game data.\n'+
   ('Zandronum releases/source: https://zandronum.com/downloads/\nFreedoom source/license: https://github.com/freedoom/freedoom/releases/tag/v0.13.0\nFreedoom licenses and credits retained in IWAD/.\n' if kind=='zandronum' else
    'FTE publisher source archive: https://fastdl.idtech.space/bin/fteqw-src-2026-07-13.zip\nFTE source: https://github.com/fte-team/fteqw\nNZP assets/source/licenses: https://github.com/nzp-team/assets\nNZP QuakeC source: https://github.com/nzp-team/quakec/tree/06c49a0cac21f2729587893b065c514748a1c8e2\nGame licenses retained under nzp/licenses/.\n')+
   ('NZP rolling release URLs may change; checked hash mismatch fails instead of installing unreviewed content.\n' if kind=='nzportable' else ''))
 print('Checked ID-family installation complete.',flush=True)

if __name__=='__main__':
 import sys
 install(Path.cwd(),sys.argv[1])
