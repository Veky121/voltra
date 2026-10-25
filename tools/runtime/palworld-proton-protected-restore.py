"""Stopped owned fixture restore; preserve this generation's canonical tools."""
from pathlib import Path,PurePosixPath
import hashlib,importlib.util,json,os,stat,tarfile,shutil

root=Path('/game');source=Path('/export')
manifest=json.loads((source/'manifest.json').read_bytes());archive=source/'protected.tar'
if hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()!=manifest['archive_sha256']:raise ValueError('Private archive checksum mismatch')
helper=root/'.voltra/palworld-loader-tools/palworld-loader-install.py'
spec=importlib.util.spec_from_file_location('fixture_loader',helper)
loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
loader.verify(root)
prefixes=('Pal/Saved/','Pal/Binaries/Win64/ue4ss/Mods/','Pal/Binaries/Win64/ue4ss/UE4SS_SDK_Backends/','Pal/Content/Paks/LogicMods/','Pal/Content/Paks/~mods/','Pal/Content/Paks/Mods/')
def selected(name):
 return name=='Pal/Binaries/Win64/ue4ss/UE4SS-settings.ini' or name.startswith(prefixes)
members={}
with tarfile.open(archive,'r') as tar:
 # Verify the ENTIRE private archive before any selected target mutation.
 for member in tar:
  name=member.name
  if name in members or PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts or '\\' in name:raise ValueError('Unsafe/duplicate archive member')
  members[name]=member
  if member.isdir():
   if name not in manifest['directories']:raise ValueError('Unrecorded archive directory')
   continue
  wanted=manifest['files'].get(name)
  if not wanted or not member.isfile() or member.size!=wanted['size'] or member.mode!=wanted['mode'] or member.uid!=wanted['uid'] or member.gid!=wanted['gid'] or hashlib.file_digest(tar.extractfile(member),'sha256').hexdigest()!=wanted['sha256']:raise ValueError('Private archive member verification failed')
 if set(members)!=set(manifest['files'])|set(manifest['directories']):raise ValueError('Incomplete private archive')
 chosen={name:info for name,info in manifest['files'].items() if selected(name)}
 for name,info in chosen.items():
  if info['uid']!=os.geteuid() or info['gid']!=os.getegid():raise ValueError('Private ownership incompatible with game user')
  loader.location(root,name)
 for name,info in chosen.items():
  with tar.extractfile(members[name]) as stream:
   loader.publication._publish(root,name,lambda output:shutil.copyfileobj(stream,output,1024*1024),info['mode'])
  # Normal publication preserves an existing target's mode. A private restore
  # explicitly restores the archived mode after the same confined path checks.
  with loader.publication._publication_parent(root,name) as (parent,leaf,_):
   descriptor=os.open(leaf,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent)
   try:os.fchmod(descriptor,info['mode'])
   finally:os.close(descriptor)
  actual=(root/name).lstat()
  if actual.st_uid!=info['uid'] or actual.st_gid!=info['gid'] or stat.S_IMODE(actual.st_mode)!=info['mode'] or hashlib.file_digest((root/name).open('rb'),'sha256').hexdigest()!=info['sha256']:raise ValueError('Private restored file verification failed')
 for name,info in sorted(manifest['directories'].items(),reverse=True):
  if not selected(name+'/'):continue
  path=loader.location(root,name)
  if not path.exists():path.mkdir(parents=True)
  if not path.is_dir() or path.lstat().st_uid!=info['uid'] or path.lstat().st_gid!=info['gid']:raise ValueError('Private restored directory ownership mismatch')
  path.chmod(info['mode'])
loader.verify(root)
print(json.dumps({'private_archive_sha256':manifest['archive_sha256'],'restored_selected_files':len(chosen),'canonical_voltra_files_restored':False,'native_loader_reverified':True,'world_ids':sorted(p.name for p in (root/'Pal/Saved/SaveGames/0').glob('*') if p.is_dir())}))
