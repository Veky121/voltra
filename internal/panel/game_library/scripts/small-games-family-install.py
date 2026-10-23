"""MIT installer for publisher-native server distributions; no proprietary MOH data."""
import hashlib,json,os,shutil,stat,sys,tempfile,urllib.request,zipfile
from pathlib import Path,PurePosixPath
from native_release import download,install_release,sha256

RELEASES={
 'clone':dict(version='v1.1.0.6142-final',url='https://github.com/clonehero-game/releases/releases/download/v1.1.0.6142-final/CloneHero-StandaloneServer.zip',sha256='b64804a4834b0b66f5f1a77a526273ff699db9fbd1a092ef519615e28cf7d5ae',bytes=71307454,prefix='build/linux-x64/',binary='Server'),
 'tachyon':dict(version='v1.0.2',url='https://github.com/Davwyn/TachyonsCE/releases/download/v1.0.2/TachyonsCE.zip',sha256='516cc90196e1bc4c27ae2bf8fed01ad25730d9fbc92b23fc49ead0935dfb85ac',bytes=165409658,prefix='server/',binary='TachyonsCEServer.jar'),
 'mohaa':dict(version='v0.82.1',url='https://github.com/openmoh/openmohaa/releases/download/v0.82.1/openmohaa-v0.82.1-linux-amd64.zip',sha256='57692d057a684afb7f7e91a61fcd8c062b29ab1b639f27453830084a88cd653c',bytes=16999314,prefix='',binary='omohaaded'),
 'stk':dict(version='1.5',url='https://github.com/supertuxkart/stk-code/releases/download/1.5/SuperTuxKart-1.5-linux-x86_64.tar.gz',sha256='57090b6c2163eb691f20104ae9712204acbb4e8341059dee0a5ff5315efc401b',bytes=735211939,prefix='SuperTuxKart-1.5-linux-x86_64',binary='bin/supertuxkart')}

def confined(root,path):
 if not path.resolve().is_relative_to(root.resolve()):raise ValueError('Native path leaves server volume')
 return path

def extract_zip(archive,target,prefix):
 seen=set();total=0
 with zipfile.ZipFile(archive) as source:
  for entry in source.infolist():
   path=PurePosixPath(entry.filename)
   if path.is_absolute() or '..' in path.parts or '\\' in entry.filename or stat.S_ISLNK(entry.external_attr>>16):raise ValueError('Unsafe publisher ZIP entry')
   if not entry.filename.startswith(prefix):continue
   name=entry.filename[len(prefix):]
   if not name:continue
   relative=PurePosixPath(name)
   if str(relative).casefold() in seen:raise ValueError('Duplicate publisher ZIP entry')
   seen.add(str(relative).casefold());total+=entry.file_size
   if total>2*1024**3 or len(seen)>50000:raise ValueError('Publisher ZIP extraction bound exceeded')
   path=target.joinpath(*relative.parts)
   if entry.is_dir():path.mkdir(parents=True,exist_ok=True)
   else:
    path.parent.mkdir(parents=True,exist_ok=True)
    with source.open(entry) as inp,path.open('xb') as out:shutil.copyfileobj(inp,out)
    path.chmod(0o644)

def resolve(game,env):
 release=dict(RELEASES[game]);version=env.get('VERSION','latest')
 if game not in ('clone','tachyon') or version in ('','latest',release['version']):return release
 if game=='tachyon':raise ValueError('This TachyonsCE release has no publisher checksums; only reviewed v1.0.2 is supported explicitly')
 import re
 if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,31}',version):raise ValueError('Choose an exact public Clone Hero release tag')
 with urllib.request.urlopen(urllib.request.Request('https://api.github.com/repos/clonehero-game/releases/releases/tags/'+version,headers={'User-Agent':'Voltra-public-server-installer'}),timeout=30) as response:data=json.load(response)
 if data.get('draft') or data.get('tag_name')!=version:raise ValueError('Clone Hero version is not a published release')
 assets=[a for a in data['assets'] if a['name'].lower()=='clonehero-standaloneserver.zip']
 if len(assets)!=1 or not str(assets[0].get('digest','')).startswith('sha256:'):raise ValueError('This historical standalone server needs a reviewed archive checksum/layout before installation')
 asset=assets[0];return {**release,'version':version,'url':asset['browser_download_url'],'sha256':asset['digest'][7:],'bytes':asset['size']}

def install(root,game,env):
 root=root.resolve();release=resolve(game,env);private=confined(root,root/'.voltra/small-games-family');private.mkdir(parents=True,exist_ok=True)
 if game=='tachyon':
  from java_games_install import java8
  java8(root)
 if game=='stk':install_release(root,release,'stk',release['binary']);return
 target=confined(root,root/game);receipt=private/(game+'-release.json');binary=target/release['binary']
 old=json.loads(receipt.read_text()) if receipt.is_file() else {}
 if old.get('sha256')==release['sha256'] and binary.is_file() and sha256(binary)==old.get('binary_sha256') and all((target/name).is_file() for name in old.get('files',{})):print('Reviewed native payload and operator data retained');return
 with tempfile.TemporaryDirectory(dir=private,prefix=game+'-') as temporary:
  stage=Path(temporary);archive=stage/'archive';download(release,archive);ready=stage/'ready';ready.mkdir();extract_zip(archive,ready,release['prefix'])
  if not (ready/release['binary']).is_file():raise ValueError('Publisher layout changed; expected dedicated server missing')
  files={p.relative_to(ready).as_posix():sha256(p) for p in ready.rglob('*') if p.is_file()}
  target.mkdir(exist_ok=True)
  for name in files:
   source=ready/name;destination=confined(root,target/name)
   # Preserve all existing operator configuration, worlds and modified assets.
   if destination.exists() and name!=release['binary'] and (name.endswith(('.cfg','.ini','.xml','.dat','.db')) or name not in old.get('files',{}) or sha256(destination)!=old['files'][name]):continue
   destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,destination)
  binary.chmod(0o755)
  receipt.write_text(json.dumps({**release,'files':files,'binary_sha256':sha256(binary)},indent=2)+'\n')
 if game=='tachyon':
  from java_games_install import java8
  java8(root)
 print('Reviewed '+game+' server installed; publisher source retained in receipt')
if __name__=='__main__':install(Path.cwd(),sys.argv[1],dict(os.environ))
