"""Receipt-scoped PRIVATE acceptance archive; never public content cache."""
from pathlib import Path
import hashlib,json,os,stat,tarfile

root=Path('/game');output=Path('/export')
bases=['Pal/Saved','.voltra','Pal/Binaries/Win64/ue4ss/Mods','Pal/Binaries/Win64/ue4ss/UE4SS-settings.ini','Pal/Binaries/Win64/ue4ss/UE4SS_SDK_Backends','Pal/Content/Paks/LogicMods','Pal/Content/Paks/~mods','Pal/Content/Paks/Mods']
files={};directories={}
for name in bases:
 base=root/name
 if not base.exists():continue
 for path in [base,*sorted(base.rglob('*'))] if base.is_dir() else [base]:
  info=path.lstat();name=path.relative_to(root).as_posix()
  if stat.S_ISDIR(info.st_mode):directories[name]={'mode':stat.S_IMODE(info.st_mode),'uid':info.st_uid,'gid':info.st_gid};continue
  if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1:raise ValueError('Regular independent protected files required')
  files[name]={'sha256':hashlib.file_digest(path.open('rb'),'sha256').hexdigest(),'size':info.st_size,'mode':stat.S_IMODE(info.st_mode),'uid':info.st_uid,'gid':info.st_gid}
archive=output/'protected.tar'
if archive.exists():raise ValueError('Fresh private archive destination required')
with tarfile.open(archive,'x') as tar:
 for name in sorted(directories):tar.add(root/name,arcname=name,recursive=False)
 for name in sorted(files):tar.add(root/name,arcname=name,recursive=False)
with tarfile.open(archive) as tar:
 for member in tar:
  if member.isdir():continue
  wanted=files[member.name];stream=tar.extractfile(member)
  if not member.isfile() or hashlib.file_digest(stream,'sha256').hexdigest()!=wanted['sha256'] or member.size!=wanted['size'] or member.mode!=wanted['mode'] or member.uid!=wanted['uid'] or member.gid!=wanted['gid']:raise ValueError('Archive verification failed')
manifest={'schema':1,'scope':'private owned fixture operator/world state; never shared cache','archive_sha256':hashlib.file_digest(archive.open('rb'),'sha256').hexdigest(),'archive_bytes':archive.stat().st_size,'files':files,'directories':directories}
(output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
os.chmod(archive,0o444);os.chmod(output/'manifest.json',0o444)
print(json.dumps({'private_archive_verified':True,'archive_sha256':manifest['archive_sha256'],'bytes':manifest['archive_bytes'],'files':len(files),'directories':len(directories)}))
