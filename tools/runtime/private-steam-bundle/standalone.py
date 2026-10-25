#!/usr/bin/env python3
"""Standalone offline source rebuild. Python3.11+, native .NET SDK prerequisites.
No repository checkout, private .local directory, Docker or network needed.
"""
import argparse,hashlib,json,os,shutil,subprocess,tarfile
from pathlib import Path

def sha(p,kind='sha256'):
 h=hashlib.new(kind)
 with p.open('rb')as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def inventory(p):return {x.relative_to(p).as_posix():sha(x)for x in sorted(p.rglob('*'))if x.is_file()}
def no_links(p):
 for x in [p,*p.parents]:
  if x.is_symlink():raise ValueError('symlink input rejected')
def closed_tree(root,expected_files,explicit_dirs=()):
 no_links(root);allowed_dirs={'.',*explicit_dirs}
 for name in expected_files:
  for parent in Path(name).parents:allowed_dirs.add(parent.as_posix())
 actual=set()
 for p in root.rglob('*'):
  if p.is_symlink():raise ValueError('symlink input rejected')
  name=p.relative_to(root).as_posix()
  if p.is_dir():
   if name not in allowed_dirs:raise ValueError('unlisted input directory')
  elif p.is_file():
   if name not in expected_files:raise ValueError('unlisted input file')
   actual.add(name)
  else:raise ValueError('special input rejected')
 if actual!=set(expected_files):raise ValueError('input inventory mismatch')
def main():
 p=argparse.ArgumentParser();
 for name in('source-root','inputs','sdk','sdk-archive','packages','build-dir'):p.add_argument('--'+name,required=True,type=Path)
 p.add_argument('--compare-output',type=Path);a=p.parse_args()
 for item in (a.source_root,a.inputs,a.sdk,a.sdk_archive,a.packages,a.build_dir):
  if not item.is_absolute():raise ValueError('absolute input/output paths required')
  no_links(item)
 inputs=json.loads(a.inputs.read_text());source_names={v['path'].removeprefix('tools/runtime/steam-private-content/')for v in inputs['sources']};closed_tree(a.source_root,source_names)
 for item in inputs['sources']:
  name=item['path'].removeprefix('tools/runtime/steam-private-content/');assert not name.startswith('/')and'..'not in Path(name).parts;assert sha(a.source_root/name)==item['sha256'],'worker source pin mismatch'
 assert inputs['sdk']['version']=='10.0.402';assert sha(a.sdk_archive,'sha512')==inputs['sdk']['sha512'],'SDK pin mismatch'
 expected=set();sdk_dirs=set()
 with tarfile.open(a.sdk_archive,'r:gz')as archive:
  for m in archive:
   if m.isdir():
    sdk_dirs.add(m.name.removeprefix('./').rstrip('/')or'.');continue
   assert m.isfile()and not m.name.startswith('/')and'..'not in Path(m.name).parts
   name=m.name.removeprefix('./');expected.add(name);f=archive.extractfile(m);h=hashlib.sha256()
   for b in iter(lambda:f.read(1048576),b''):h.update(b)
   actual=a.sdk/name;assert actual.is_file()and not actual.is_symlink()and sha(actual)==h.hexdigest(),'SDK extracted file mismatch'
 closed_tree(a.sdk,expected,sdk_dirs)
 for item in inputs['sources']:
  name=item['path'].removeprefix('tools/runtime/steam-private-content/');assert not name.startswith('/')and'..'not in Path(name).parts;assert sha(a.source_root/name)==item['sha256'],'worker source pin mismatch'
 for item in inputs['packages']:
  name=item['package'].lower();assert sha(a.packages/name/item['version']/(name+'.'+item['version']+'.nupkg'))==item['sha256'],'package pin mismatch'
 a.build_dir.mkdir(mode=0o700) # exclusive fresh output, never reuse failed trees
 config=a.build_dir/'offline.config';config.write_text('<?xml version="1.0"?><configuration><packageSources><clear/><add key="offline" value="'+str(a.packages)+'"/></packageSources><packageSourceMapping><packageSource key="offline"><package pattern="*"/></packageSource></packageSourceMapping></configuration>')
 env={k:v for k,v in os.environ.items()if k in('PATH','TMPDIR','LD_LIBRARY_PATH')};env.update({'DOTNET_ROOT':str(a.sdk),'DOTNET_CLI_HOME':str(a.build_dir/'home'),'NUGET_PACKAGES':str(a.build_dir/'packages'),'HOME':str(a.build_dir/'home'),'DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_NOLOGO':'1','DOTNET_SYSTEM_GLOBALIZATION_INVARIANT':'1','DOTNET_EnableDiagnostics':'0','SOURCE_DATE_EPOCH':'0'})
 def run(name,args):
  result=subprocess.run([str(a.sdk/'dotnet'),*args],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180);(a.build_dir/(name+'.log')).write_bytes(result.stdout);assert result.returncode==0,name+' failed; see retained log'
 for name in('a','b'):
  base=a.build_dir/name;src=base/'src';shutil.copytree(a.source_root,src);closed_tree(src,source_names)
  for item in inputs['sources']:assert sha(src/item['path'].removeprefix('tools/runtime/steam-private-content/'))==item['sha256'],'copied source pin mismatch'
  opts=['-p:BaseIntermediateOutputPath='+str(base/'obj-2')+'/','-p:MSBuildProjectExtensionsPath='+str(base/'obj-2')+'/'];project=str(src/'ContentWorker.csproj')
  run(name+'-restore',['restore',project,'--locked-mode','--configfile',str(config),*opts]);run(name+'-build',['build',project,'--no-restore','-c','Release',*opts,'-p:OutputPath='+str(base/'out-2')+'/','-p:ContinuousIntegrationBuild=true','-p:PathMap='+str(base)+'=/voltra-source','-p:Deterministic=true','-p:DebugType=portable'])
 first=inventory(a.build_dir/'a/out-2');second=inventory(a.build_dir/'b/out-2');assert first==second,'two-root rebuild mismatch'
 if a.compare_output:assert first==inventory(a.compare_output),'rebuild does not match candidate outputs'
 report={'two_root_equal':True,'files':first,'matches_candidate':bool(a.compare_output),'network_used':False};(a.build_dir/'result.json').write_text(json.dumps(report,sort_keys=True,indent=2));print(json.dumps({'two_root_equal':True,'files':len(first),'matches_candidate':bool(a.compare_output)}))
if __name__=='__main__':
 if not __debug__:raise RuntimeError('optimized Python is unsupported; verification assertions must remain enabled')
 main()
