#!/usr/bin/env python3
"""MIT. Matched modern Vril and legacy FTE engine/data installation."""
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
from native_release import download, extract as tar_extract, sha256
from native_zip_release import extract as zip_extract
from nzp_engine_build import build_vril, build_legacy

RELEASES={
 'vril':[
  dict(version='Vril2026-10-21-package',url='https://github.com/nzp-team/nzportable/releases/download/nightly/nzportable-linux64.zip',sha256='6b07a8622e400d01d13e42ee0f9f28ceaded86860601759a0c6c89ed295bcfea',bytes=74097683,prefix=None,format='zip',role='game'),
  dict(version='Vril-ac0a0ac6',url='https://codeload.github.com/nzp-team/vril-engine/tar.gz/ac0a0ac6b081be3b44e669dafe842b21b2a033d1',sha256='8a6cfae84158c630cc7a077b4ec5bac4be3e7ed0832bd365d0469540acfaf57f',bytes=11828437,prefix='vril-engine-ac0a0ac6b081be3b44e669dafe842b21b2a033d1',format='tar',role='source'),
 ],
 'fte_legacy':[
  dict(version='FTE2026-07-13',url='https://fastdl.idtech.space/bin/fteqw-linux-x86_64-2026-07-13.zip',sha256='0478478467cb147703f5501515a8e5043d87b188358bd75d4c7942820a232c2c',bytes=43835170,prefix='fteqw-2026-07-13',format='zip',role='game'),
  dict(version='NZP-assets-a17c550c',url='https://codeload.github.com/nzp-team/assets/tar.gz/a17c550c5753707c7158e0b4e5f6d034691dc582',sha256='60f1a1566052a5b3009aec87bbb0da8d4804f751d5469398598776a8004b92a1',bytes=188591633,prefix='assets-a17c550c5753707c7158e0b4e5f6d034691dc582',format='tar',role='assets'),
  dict(version='NZP-QuakeC-317da957',url='https://codeload.github.com/nzp-team/quakec/tar.gz/317da957640aabc82288d535c4ef251d2fcb1314',sha256='6f3e949158459cfee7ac0c3bd785031506b3d609ce63b1f114d7806c45a52821',bytes=1203497,prefix='quakec-317da957640aabc82288d535c4ef251d2fcb1314',format='tar',role='quakec'),
 ]}

def confined(root,path):
 if not path.resolve().is_relative_to(root):raise ValueError('NZP installation escapes server volume')
 return path

def publish(root,game,state,ready,binary,old,identity):
 files={p.relative_to(ready).as_posix():sha256(p) for p in ready.rglob('*') if p.is_file()}
 backup=state/('previous-'+str(time.time_ns()));changed=[]
 try:
  for name in files:
   source=ready/name;target=confined(root,game/name);saved=None
   if target.exists():
    if name!=binary and (name.endswith(('.cfg','.ini','.fmf')) or name.startswith('nzp/maps/') or name not in old.get('files',{}) or sha256(target)!=old['files'][name]):continue
    saved=backup/name;saved.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target,saved)
   target.parent.mkdir(parents=True,exist_ok=True);os.replace(source,target);changed.append((target,saved))
  receipt=ready.parent/'receipt.json';receipt.write_text(json.dumps(dict(identity=identity,files=files,binary_sha256=sha256(game/binary)),indent=2)+'\n');os.replace(receipt,state/'release.json')
 except BaseException:
  for target,saved in reversed(changed):
   if saved is None:target.unlink()
   else:os.replace(saved,target)
  raise

def install(root):
 root=root.resolve();mode=os.environ.get('NZP_ENGINE','vril')
 if mode not in RELEASES:raise ValueError('NZP_ENGINE must be vril or fte_legacy')
 game=confined(root,root/'nzportable'/mode);state=confined(root,root/'.voltra'/('nzportable-'+mode));state.mkdir(parents=True,exist_ok=True)
 receipt=confined(root,state/'release.json');old=json.loads(receipt.read_text()) if receipt.is_file() else {}
 binary='nzportable-server' if mode=='vril' else 'fteqw-sv64';patchfile=confined(root,root/'.voltra/nzp-vril-console.patch')
 identity=dict(releases=RELEASES[mode],patch_sha256=sha256(patchfile) if mode=='vril' else None)
 if mode=='fte_legacy':identity['dedicated_layout']='optional-plugins-v1'
 if old.get('identity')==identity and (game/binary).is_file() and sha256(game/binary)==old.get('binary_sha256') and all((game/name).is_file() for name in old.get('files',{})):
  print('Matched NZP '+mode+' installation and operator files retained.',flush=True);return
 with tempfile.TemporaryDirectory(prefix='.stage-',dir=state) as t:
  stage=Path(t);ready=stage/'ready';ready.mkdir();components={}
  for index,release in enumerate(RELEASES[mode]):
   archive=stage/('archive-'+str(index));download(release,archive)
   target=ready if release['role']=='game' else stage/release['role'];target.mkdir(exist_ok=True)
   (zip_extract if release['format']=='zip' else tar_extract)(archive,target,release['prefix']);components[release['role']]=target
  if mode=='vril':build_vril(components['source'],ready,patchfile)
  else:
   build_legacy(components['assets'],components['quakec'],ready)
   (ready/'fteqw-sv64').chmod(0o755)
   (ready/'default.fmf').write_text('FTEManifestVer 1\ngame nzp\nname "Nazi Zombies: Portable Legacy FTE"\nbasegame nzp\nmainconfig "config"\n')
  (ready/'nzp/voltra-server.cfg').write_text('// Operator native console commands. Form values apply afterward.\n')
  (ready/'PUBLISHER-SOURCES.txt').write_text('NZP mode: '+mode+'\nInputs: '+json.dumps(RELEASES[mode],indent=2)+'\nSource and game licenses retained. Modern Vril includes the reviewed dedicated-console patch; legacy FTE is unmodified.\n')
  publish(root,game,state,ready,binary,old,identity)
 print('Matched NZP '+mode+' engine and data installed.',flush=True)

if __name__=='__main__':install(Path.cwd())
