#!/usr/bin/env python3
"""MIT. Public publisher payloads; EXILED documented manual install layout."""
import hashlib,io,json,os,re,sys,tarfile,urllib.request
from pathlib import Path,PurePosixPath
import steam_template
from session_servers_runtime import APPS,confined

EXILED_PIN={'tag_name':'v9.15.2','prerelease':False,'draft':False,'published_at':'2026-10-01T00:00:00Z','assets':[{'name':'Exiled.tar.gz','size':1153101,'digest':'sha256:6b0537f92f911657e2187b079905781c9c0606fc8e6cef0ce8f737f4d8308ec8','browser_download_url':'https://github.com/ExMod-Team/EXILED/releases/download/v9.15.2/Exiled.tar.gz'}]}
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
   name=member.name.removeprefix('./');parts=PurePosixPath(name).parts
   if not parts or name.startswith('/') or '\\' in name or any(p in ['..','.'] for p in parts):raise ValueError('Unsafe publisher archive path')
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

def publish_archive(root,data,exiled=False):
 rows=archive_files(data,exiled) # Validate every member before first publication.
 for name,content,mode in rows:
  if exiled and confined(root,name).exists() and not name.casefold().endswith(('.dll','.pdb','.xml')):continue
  steam_template._publish(root,name,lambda out,value=content:out.write(value),mode or 0o644)
 return len(rows)

def install(root,game,env):
 root=Path(root).resolve();app=APPS[game]
 if env.get('SRCDS_APPID',app)!=app:raise ValueError('Original dedicated-server app ID is required')
 steam_template.arguments(root,int(app),env) # Gate before even resolving/downloading public artifacts.
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
    saved.append((str(target.relative_to(root)),target.read_bytes()))
 try:
  receipt=steam_template.update(root,int(app),env,required=('Binaries/Win64/KFGameSteamServer.bin.x86_64',) if game=='kf2' else ('LocalAdmin',))
 finally:
  for name,content in saved:steam_template._publish(root,name,lambda out,value=content:out.write(value),0o600)
 if game!='kf2':
  data=fetch(DOTNET['url'],64*1024*1024)
  if hashlib.sha512(data).hexdigest()!=DOTNET['sha512']:raise ValueError('Microsoft runtime digest mismatch')
  for name,content,mode in archive_files(data):steam_template._publish(root,'.voltra/scp-dotnet/'+name,lambda out,value=content:out.write(value),mode or 0o644)
 if release:
  data=fetch(release['url'],release['size'])
  if len(data)!=release['size'] or hashlib.sha256(data).hexdigest()!=release['sha256']:raise ValueError('EXILED archive digest/size mismatch')
  publish_archive(root,data,True)
  record=(json.dumps({**release,'installation':'documented manual archive layout','source_commit':'d3159abff700d2927005a51eef656c2304f0f75b'})+'\n').encode()
  steam_template._publish(root,'.voltra/exiled-release.json',lambda out:out.write(record),0o600)
 return receipt

if __name__=='__main__':install(Path.cwd(),sys.argv[1],dict(os.environ))
