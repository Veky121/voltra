#!/usr/bin/env python3
"""Offline candidate packaging. Invoked only by build.mjs in a bounded container."""
import hashlib,json,os,shutil,sys,tarfile
from pathlib import Path

def digest(p,kind='sha256'):
 h=hashlib.new(kind)
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def canonical(v):return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def inventory(root):
 out=[]
 for p in sorted(root.rglob('*')):
  if p.is_symlink() or not(p.is_file()or p.is_dir()):raise ValueError('special input rejected')
  if p.is_file():out.append({'path':p.relative_to(root).as_posix(),'sha256':digest(p),'bytes':p.stat().st_size,'mode':493 if p.name in ('SteamPrivateContentWorker','dotnet') else 420})
 return out
def tar(root,path):
 with tarfile.open(path,'w',format=tarfile.USTAR_FORMAT)as t:
  for p in sorted(root.rglob('*')):
   if not p.is_file():continue
   name=p.relative_to(root).as_posix();i=tarfile.TarInfo(name);i.size=p.stat().st_size;i.mode=0o755 if p.name in ('SteamPrivateContentWorker','dotnet') else 0o644;i.uid=i.gid=0;i.mtime=0
   with p.open('rb')as f:t.addfile(i,f)

def stage(work,src,public,inputs):
 base=work/'bundle-candidate';base.mkdir(mode=0o700) # exclusive attempt; never reuse failure
 sources=inputs['sources']
 for v in sources:
  p=src/v['path'];assert p.is_file()and digest(p)==v['sha256'],'source pin mismatch'
 sdk=public/'dotnet-sdk.tar.gz';assert digest(sdk,'sha512')==inputs['sdk']['sha512'],'SDK archive mismatch'
 # Verify the actual reused SDK against its cached publisher-verified archive.
 expected=set()
 with tarfile.open(sdk,'r:gz')as a:
  for m in a:
   if m.isdir():continue
   assert m.isfile()and not m.name.startswith('/')and '..'not in Path(m.name).parts,'SDK archive type/path'
   name=m.name.removeprefix('./');expected.add(name);p=work/'sdk'/name
   assert p.is_file()and not p.is_symlink()and p.stat().st_size==m.size,'SDK file missing'
   h=hashlib.sha256();f=a.extractfile(m)
   for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
   assert digest(p)==h.hexdigest(),'SDK extracted file mismatch'
 actual={p.relative_to(work/'sdk').as_posix()for p in (work/'sdk').rglob('*')if p.is_file()};assert actual==expected,'SDK extra files'
 for pkg in inputs['packages']:
  root=work/'nuget'/pkg['package'].lower()/pkg['version'];p=root/(pkg['package'].lower()+'.'+pkg['version']+'.nupkg');assert digest(p)==pkg['sha256'],'NuGet archive mismatch'
  # Locked restore additionally verifies NuGet's distinct restored contentHash.
 for name in ('a','b'):
  dest=base/name/'src';dest.mkdir(parents=True)
  for v in sources:
   relative=v['path'].removeprefix('tools/runtime/steam-private-content/');p=dest/relative;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src/v['path'],p)
 print('pinned sources, actual SDK and cached package archives verified')

def package(work,src,inputs):
 base=work/'bundle-candidate';a=base/'a'/'out-2';b=base/'b'/'out-2';ia=inventory(a);ib=inventory(b);
 if ia!=ib:
  differences=[{'path':x['path'],'a':x['sha256'],'b':next((v['sha256']for v in ib if v['path']==x['path']),None)}for x in ia if x not in ib];(base/'reproducibility-failure-initial.json').write_bytes(canonical({'equal':False,'differences':differences}));print(differences);raise ValueError('two-root compiled output mismatch')
 (base/'reproducibility.json').write_bytes(canonical({'equal':True,'outputs':ia,'build_roots':['a','b'],'network':False}))
 payload=base/'payload';payload.mkdir();shutil.copytree(a,payload/'worker')
 # Runtime comes exclusively from the verified cached SDK, not the build image.
 runtime=payload/'runtime';runtime.mkdir();sdk=work/'sdk';version=inputs['runtime_version'];assert (sdk/'shared/Microsoft.NETCore.App'/version).is_dir();shutil.copy2(sdk/'dotnet',runtime/'dotnet');shutil.copytree(sdk/'host/fxr'/version,runtime/'host/fxr'/version);shutil.copytree(sdk/'shared/Microsoft.NETCore.App'/version,runtime/'shared/Microsoft.NETCore.App'/version)
 for name in ('LICENSE.txt','ThirdPartyNotices.txt'):
  assert(sdk/name).is_file(),'runtime notice missing';shutil.copy2(sdk/name,runtime/name)
 licenses=payload/'licenses';shutil.copytree(src/'tools/runtime/steam-private-content/licenses',licenses);shutil.copy2(src/'tools/runtime/steam-private-content/LICENSE',licenses/'Voltra-MIT.txt')
 source=base/'source';source.mkdir();worker=source/'worker';worker.mkdir()
 for v in inputs['sources']:
  relative=v['path'].removeprefix('tools/runtime/steam-private-content/');p=worker/relative;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src/v['path'],p)
 corresponding=source/'corresponding-source';corresponding.mkdir();steam=src/'tools/runtime/steam-private-content/corresponding-source/SteamKit-49387aec55c24104946af7a7b160148358e538b4.tar.gz';shutil.copy2(steam,corresponding/steam.name)
 with tarfile.open(steam,'r:gz')as t:
  m=t.getmember('SteamKit-49387aec55c24104946af7a7b160148358e538b4/LICENSE');text=t.extractfile(m).read();assert b'GNU LESSER GENERAL PUBLIC LICENSE'in text; (licenses/'LGPL-2.1-full.txt').write_bytes(text)
 shutil.copytree(licenses,source/'licenses');(source/'BUILD-AND-RELINK.txt').write_text('Candidate only. Original orchestration is MIT; SteamKit remains a separate dynamically loaded DLL.\nSteamKit source is exact commit49387aec55c24104946af7a7b160148358e538b4, unmodified; use its SteamKit2 solution/project and locked dependency versions.\nRebuild Voltra using SDK10.0.402 and the included ContentWorker.csproj/packages.lock.json with offline locked restore, Release Deterministic+ContinuousIntegrationBuild and PathMap to /voltra-source.\nSupply cached SDK/NuGet artifacts with the input manifest hashes. Builder source is tools/runtime/private-steam-bundle, shipped below.\nReplacing/relinking SteamKit2.dll requires rebuilding a candidate manifest and explicit administrator approval of the new digest; immutable integrity policy is not DRM or a claim of compatibility.\nNo self-contained/single-file/trimming/AOT linking is used. Runtime publisher notices retained. No legal compliance guarantee is asserted.\n')
 shutil.copytree(src/'tools/runtime/private-steam-bundle',source/'builder',ignore=shutil.ignore_patterns('__pycache__'));(source/'inputs.json').write_bytes(canonical(inputs))
 for root in (payload,source):
  for p in root.rglob('*'):p.chmod(0o755 if p.is_dir()or p.name in('SteamPrivateContentWorker','dotnet')else 0o644)
 files=inventory(payload);sourcefiles=inventory(source);tar(payload,base/'worker.tar');tar(source,base/'source.tar')
 manifest={'version':1,'provider':'steamkit-depot-v1','rid':'linux-x64','entrypoint':'worker/SteamPrivateContentWorker','runtime_root':'runtime','runtime_version':version,'sdk':'10.0.402','source_inputs_sha256':hashlib.sha256(canonical(inputs)).hexdigest(),'worker_tar_sha256':digest(base/'worker.tar'),'source_tar_sha256':digest(base/'source.tar'),'files':files,'source_files':sourcefiles,'production_enabled':False}
 (base/'manifest.json').write_bytes(canonical(manifest));print(json.dumps({'manifest_sha256':digest(base/'manifest.json'),'worker_files':len(files),'source_files':len(sourcefiles),'two_root_equal':True,'production_enabled':False}))
def revision(work,src,number=2):
 old=work/'bundle-candidate';base=work/('bundle-candidate-'+str(number));base.mkdir(mode=0o700)
 m=json.loads((old/'manifest.json').read_text());assert digest(old/'worker.tar')==m['worker_tar_sha256'];assert digest(old/'source.tar')==m['source_tar_sha256']
 shutil.copyfile(old/'worker.tar',base/'worker.tar');shutil.copytree(old/'source',base/'source');shutil.rmtree(base/'source/builder');shutil.copytree(src/'tools/runtime/private-steam-bundle',base/'source/builder')
 (base/'source/BUILD-AND-RELINK.txt').write_text((src/'tools/runtime/private-steam-bundle/README.md').read_text())
 for p in (base/'source').rglob('*'):p.chmod(0o755 if p.is_dir()else 0o644)
 m['source_files']=inventory(base/'source');tar(base/'source',base/'source.tar');m['source_tar_sha256']=digest(base/'source.tar');(base/'manifest.json').write_bytes(canonical(m));print(json.dumps({'revision':number,'manifest_sha256':digest(base/'manifest.json'),'worker_unchanged':True,'source_files':len(m['source_files'])}))

if __name__=='__main__':
 command=sys.argv[1];work=Path('/work');src=Path('/repo');inputs=json.loads(Path('/inputs.json').read_text())
 if command=='stage':stage(work,src,Path('/public'),inputs)
 elif command=='package':package(work,src,inputs)
 elif command=='revision':revision(work,src)
 elif command=='revision-3':revision(work,src,3)
 else:raise ValueError('unknown offline phase')
