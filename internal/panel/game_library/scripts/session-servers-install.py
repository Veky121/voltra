#!/usr/bin/env python3
"""MIT. Public publisher payloads; EXILED documented manual install layout."""
import hashlib,io,json,os,re,sys,tarfile,urllib.request,stat,fcntl
from pathlib import Path,PurePosixPath
import steam_template
from session_servers_runtime import APPS,confined,kf2_ports

EXILED_PIN={'tag_name':'v9.15.2','prerelease':False,'draft':False,'published_at':'2026-10-16T23:32:22Z','assets':[{'name':'Exiled.tar.gz','size':1153101,'digest':'sha256:6b0537f92f911657e2187b079905781c9c0606fc8e6cef0ce8f737f4d8308ec8','browser_download_url':'https://github.com/ExMod-Team/EXILED/releases/download/v9.15.2/Exiled.tar.gz'}]}
DOTNET={'url':'https://builds.dotnet.microsoft.com/dotnet/Runtime/9.0.21/dotnet-runtime-9.0.21-linux-x64.tar.gz','sha512':'6faa847e25a02b87c737c8222c6f5f9fd5f20945b7d239a080a7e3d99b97af48e6b6121aa55dee2e797cc89fe7eb97d235e12422b1b22786cbf169420156ae1e'}

def fetch(url,limit):
 if not url.startswith(('https://api.github.com/repos/ExMod-Team/EXILED/','https://github.com/ExMod-Team/EXILED/releases/download/','https://builds.dotnet.microsoft.com/dotnet/Runtime/')):raise ValueError('Unapproved publisher URL')
 request=urllib.request.Request(url,headers={'User-Agent':'Voltra-session-servers/1','Accept':'application/vnd.github+json' if 'api.github.com' in url else 'application/octet-stream'})
 with urllib.request.urlopen(request,timeout=90) as response:
  data=response.read(limit+1)
 if len(data)>limit:raise ValueError('Publisher response exceeds reviewed size limit')
 return data

def resolve_exiled(version,prereleases,request=fetch):
 if prereleases not in ['0','1']:raise ValueError('EXILED_PRE_RELEASES must be 0 or 1')
 if version!='latest' and not re.fullmatch(r'v?[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?',version):raise ValueError('Invalid EXILED_VERSION')
 if version in ['9.15.2','v9.15.2']:release=EXILED_PIN
 elif version!='latest':release=json.loads(request('https://api.github.com/repos/ExMod-Team/EXILED/releases/tags/'+('v'+version.removeprefix('v')),2*1024*1024))
 else:
  releases=[]
  # Pages ordered newest first; bounded fail rather than silently selecting wrong version.
  for page in range(1,11):
   batch=json.loads(request('https://api.github.com/repos/ExMod-Team/EXILED/releases?per_page=100&page='+str(page),4*1024*1024))
   if not isinstance(batch,list):raise ValueError('Invalid publisher release metadata')
   releases.extend(r for r in batch if not r.get('draft') and (prereleases=='1' or not r.get('prerelease')))
   if releases or len(batch)<100:break
  if not releases:raise ValueError('No eligible EXILED release found')
  release=max(releases,key=lambda r:r.get('published_at',''))
 if release.get('draft') or not re.fullmatch(r'v?[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?',release.get('tag_name','')):raise ValueError('Invalid EXILED release')
 if version!='latest' and release['tag_name'].removeprefix('v')!=version.removeprefix('v'):raise ValueError('Publisher returned a different EXILED version')
 assets=[a for a in release.get('assets',[]) if a.get('name')=='Exiled.tar.gz']
 if len(assets)!=1:raise ValueError('Release needs one official Exiled.tar.gz asset')
 asset=assets[0];digest=asset.get('digest') or ''
 if not re.fullmatch(r'sha256:[0-9a-f]{64}',digest):raise ValueError('This EXILED release has no publisher SHA256 digest; unsupported until independently reviewed')
 expected='https://github.com/ExMod-Team/EXILED/releases/download/'+release['tag_name']+'/Exiled.tar.gz'
 if asset.get('browser_download_url')!=expected or not 0<asset.get('size',0)<=32*1024*1024:raise ValueError('Invalid EXILED asset identity')
 return {'tag':release['tag_name'],'url':expected,'sha256':digest[7:],'size':asset['size']}

def archive_files(data,exiled=False):
 result=[];seen=set();total=0
 with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:
  for member in archive:
   if member.isdir() and member.name in ['.','./']:continue
   name=member.name.removeprefix('./');parts=PurePosixPath(name).parts
   if not parts or name.startswith('/') or '\\' in name or any(p in ['..','.'] for p in parts):raise ValueError('Unsafe publisher archive path')
   name=str(PurePosixPath(name)) # Canonical aliases cannot bypass duplicate-member detection.
   if member.isdir():continue
   if not member.isfile() or member.mode & 0o7000:raise ValueError('Archive links/devices/special modes are unsupported')
   if exiled:
    if parts[0] not in ['EXILED','SCP Secret Laboratory']:raise ValueError('Unexpected EXILED archive root')
    if 'example' in name.casefold():continue
    name='.config/'+name
    # Framework binaries only: user settings/plugins are never overwritten by archive defaults.
    if not name.casefold().endswith(('.dll','.pdb','.xml','.json','.yml','.yaml','.txt')):raise ValueError('Unsupported EXILED archive member')
   if name in seen:raise ValueError('Duplicate publisher archive member')
   seen.add(name);total+=member.size
   if member.size>128*1024*1024 or total>256*1024*1024 or len(seen)>10000:raise ValueError('Expanded publisher archive exceeds budget')
   result.append((name,archive.extractfile(member).read(),member.mode & 0o755))
 return result

def snapshot(root,name):
 with steam_template._publication_parent(root,name) as (parent,leaf,volume):
  if parent is None:return None
  metadata=steam_template._publication_leaf(parent,leaf)
  if metadata is None:return None
  if metadata.st_size>128*1024*1024:raise ValueError('Existing EXILED publication file exceeds preservation budget')
  descriptor=os.open(leaf,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent)
  with os.fdopen(descriptor,'rb') as source:
   current=os.fstat(source.fileno())
   if (current.st_dev,current.st_ino)!=(metadata.st_dev,metadata.st_ino):raise ValueError('EXILED destination changed during validation')
   content=source.read(128*1024*1024+1)
   if len(content)>128*1024*1024:raise ValueError('Existing EXILED publication grew beyond preservation budget')
   return content,current

def metadata_restore(root,name,metadata):
 with steam_template._publication_parent(root,name) as (parent,leaf,volume):
  descriptor=os.open(leaf,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent)
  try:
   current=os.fstat(descriptor)
   if not stat.S_ISREG(current.st_mode):raise ValueError('EXILED rollback destination is not regular')
   if (current.st_uid,current.st_gid)!=(metadata.st_uid,metadata.st_gid):os.fchown(descriptor,metadata.st_uid,metadata.st_gid)
   os.fchmod(descriptor,metadata.st_mode & 0o777)
  finally:os.close(descriptor)

def publish_archive(root,data,exiled=False,release=None):
 root=Path(root).resolve();rows=archive_files(data,exiled) # Entire archive validated before publication.
 if not exiled:
  for name,content,mode in rows:steam_template._publish(root,name,lambda out,value=content:out.write(value),mode or 0o644)
  return len(rows)
 # Serialize our own updates without accepting a caller-controlled lock symlink.
 lock=os.open(root/'.voltra-exiled-publication.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
 try:
  if not stat.S_ISREG(os.fstat(lock).st_mode):raise ValueError('Invalid EXILED publication lock')
  if os.geteuid()==0:os.fchown(lock,root.stat().st_uid,root.stat().st_gid)
  fcntl.flock(lock,fcntl.LOCK_EX)
  return publish_exiled_locked(root,rows,release)
 finally:os.close(lock)

def publish_exiled_locked(root,rows,release):
 receipt_name='.voltra/exiled-release.json';old_receipt=snapshot(root,receipt_name)
 previous={}
 if old_receipt:
  if len(old_receipt[0])>2*1024*1024:raise ValueError('EXILED ownership receipt exceeds budget')
  record=json.loads(old_receipt[0])
  if not isinstance(record,dict):raise ValueError('Invalid EXILED ownership receipt')
  previous=record.get('files',{})
  if not isinstance(previous,dict):raise ValueError('Invalid EXILED ownership receipt')
 plans=[];owned={};retained={};backup_size=0
 for name,content,mode in rows:
  before=snapshot(root,name)
  if before:
   backup_size+=len(before[0])
   if backup_size>256*1024*1024:raise ValueError('EXILED rollback snapshot exceeds budget')
   expected=previous.get(name)
   # Native settings remain operator-owned, including publisher-shipped defaults.
   if not name.casefold().endswith(('.dll','.pdb','.xml')):
    retained[name]='existing operator configuration';continue
   if not isinstance(expected,dict) or expected.get('sha256')!=hashlib.sha256(before[0]).hexdigest() or expected.get('size')!=len(before[0]):
    raise ValueError('EXILED update prerequisite: back up and explicitly resolve modified or untracked collision: '+name)
  owned[name]={'sha256':hashlib.sha256(content).hexdigest(),'size':len(content)}
  plans.append((name,content,mode or 0o644,before))
 # Keep ownership of unchanged obsolete publisher files without deleting them.
 for name,identity in previous.items():
  if name in owned or name in retained:continue
  if not isinstance(name,str) or not name.startswith(('.config/EXILED/','.config/SCP Secret Laboratory/')):raise ValueError('Invalid EXILED ownership receipt path')
  existing=snapshot(root,name)
  if existing and isinstance(identity,dict) and identity.get('sha256')==hashlib.sha256(existing[0]).hexdigest() and identity.get('size')==len(existing[0]):owned[name]=identity
 record={**(release or {}),'schema_version':1,'installation':'documented manual archive layout','files':owned,'preserved_operator_settings':sorted(retained)}
 receipt=(json.dumps(record,sort_keys=True,indent=2)+'\n').encode()
 if len(receipt)>2*1024*1024:raise ValueError('New EXILED ownership receipt exceeds budget')
 plans.append((receipt_name,receipt,0o600,old_receipt))
 attempted=[]
 try:
  for name,content,mode,before in plans:
   # Revalidate complete preflight snapshot just before publishing each target.
   now=snapshot(root,name)
   if (now is None)!=(before is None) or now and (now[0]!=before[0] or (now[1].st_mode,now[1].st_uid,now[1].st_gid)!=(before[1].st_mode,before[1].st_uid,before[1].st_gid)):raise ValueError('EXILED destination changed after preflight')
   attempted.append((name,content,mode,before))
   steam_template._publish(root,name,lambda out,value=content:out.write(value),mode)
 except BaseException as original:
  errors=[]
  for name,content,mode,before in reversed(attempted):
   try:
    current=snapshot(root,name)
    if current is not None and current[0] not in [content,*([before[0]] if before else [])]:raise ValueError('Concurrent operator change retained during rollback: '+name)
    if before:
     steam_template._publish(root,name,lambda out,value=before[0]:out.write(value),before[1].st_mode & 0o777)
     metadata_restore(root,name,before[1])
    elif current:
     with steam_template._publication_parent(root,name) as (parent,leaf,volume):
      latest=steam_template._publication_leaf(parent,leaf)
      if (latest.st_dev,latest.st_ino)!=(current[1].st_dev,current[1].st_ino):raise ValueError('EXILED rollback destination changed')
      os.unlink(leaf,dir_fd=parent);os.fsync(parent)
   except BaseException as rollback:errors.append(str(rollback))
  if errors:raise RuntimeError('EXILED publication failed; rollback incomplete, preserved conflicting paths: '+'; '.join(errors)) from original
  raise
 return len(rows)

def install(root,game,env):
 root=Path(root).resolve();app=APPS[game]
 if env.get('SRCDS_APPID',app)!=app:raise ValueError('Original dedicated-server app ID is required')
 steam_template.arguments(root,int(app),env) # Gate before even resolving/downloading public artifacts.
 if game=='kf2':kf2_ports(env) # Port group validation precedes publisher mutation/config backups.
 release=resolve_exiled(env.get('EXILED_VERSION','latest'),env.get('EXILED_PRE_RELEASES','0')) if game=='exiled' else None
 # Preserve entire publisher configuration tree byte-for-byte during Steam validation,
 # including unknown mods/admin arrays; symlink inputs are refused before mutation.
 saved=[];directory=confined(root,'KFGame/Config' if game=='kf2' else '.config')
 if directory.exists():
  for parent,dirs,files in os.walk(directory,followlinks=False):
   for name in dirs+files:confined(root,str((Path(parent)/name).relative_to(root)))
   for name in files:
    target=Path(parent)/name
    if target.stat().st_size>16*1024*1024 or sum(len(row[1]) for row in saved)+target.stat().st_size>128*1024*1024:raise ValueError('Existing configuration tree exceeds preservation budget')
    saved.append((str(target.relative_to(root)),target.read_bytes(),target.stat()))
 try:
  receipt=steam_template.update(root,int(app),env,required=('Binaries/Win64/KFGameSteamServer.bin.x86_64',) if game=='kf2' else ('LocalAdmin',))
 finally:
  for name,content,metadata in saved:
   steam_template._publish(root,name,lambda out,value=content:out.write(value),0o600)
   # Steam may replace an existing file with root-owned/new-mode content. Restore
   # pre-update metadata through the same anchored, no-follow publication parent.
   with steam_template._publication_parent(root,name) as (parent,leaf,volume):
    descriptor=os.open(leaf,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent)
    try:
     current=os.fstat(descriptor)
     if (current.st_uid,current.st_gid)!=(metadata.st_uid,metadata.st_gid):os.fchown(descriptor,metadata.st_uid,metadata.st_gid)
     os.fchmod(descriptor,metadata.st_mode & 0o777)
    finally:os.close(descriptor)
 if game!='kf2':
  data=fetch(DOTNET['url'],64*1024*1024)
  if hashlib.sha512(data).hexdigest()!=DOTNET['sha512']:raise ValueError('Microsoft runtime digest mismatch')
  for name,content,mode in archive_files(data):steam_template._publish(root,'.voltra/scp-dotnet/'+name,lambda out,value=content:out.write(value),mode or 0o644)
 if release:
  data=fetch(release['url'],release['size'])
  if len(data)!=release['size'] or hashlib.sha256(data).hexdigest()!=release['sha256']:raise ValueError('EXILED archive digest/size mismatch')
  publish_archive(root,data,True,release)
 return receipt

if __name__=='__main__':install(Path.cwd(),sys.argv[1],dict(os.environ))
