"""MIT. Anonymous official Steam depots, preserving operator JSON during validation."""
import os,sys,tempfile,json,hashlib,subprocess,shutil
from pathlib import Path
import steam_template
from light_games_next_runtime import APPS,config_path,confined
def build_puck_plugin(root):
 project=confined(root,'.voltra/puck_legacy_controls.csproj');source=confined(root,'.voltra/puck_legacy_controls.cs')
 if not project.is_file() or not source.is_file():raise ValueError('Puck compatibility plugin sources are missing')
 managed=confined(root,'Puck_Data/Managed')
 target=confined(root,'Plugins/VoltraLegacyControls/VoltraLegacyControls.dll');record=confined(root,'.voltra/puck-compat-release.json')
 names=['Puck_Data/Managed/Puck.dll','Puck_Data/Managed/0Harmony.dll','.voltra/puck_legacy_controls.cs','.voltra/puck_legacy_controls.csproj']
 identities={name:hashlib.sha256(confined(root,name).read_bytes()).hexdigest() for name in names}
 if record.is_file() and record.stat().st_size<32768 and target.is_file():
  previous=json.loads(record.read_text())
  if all(previous.get('sha256',{}).get(name)==value for name,value in identities.items()) and previous.get('sha256',{}).get('Plugins/VoltraLegacyControls/VoltraLegacyControls.dll')==hashlib.sha256(target.read_bytes()).hexdigest():return
 private=confined(root,'.voltra/puck-compiler');system=Path('/usr/share/dotnet')
 if (system/'dotnet').is_file() and (system/'sdk').is_dir():
  versions=lambda path:sorted((p for p in path.iterdir() if p.is_dir() and p.name.startswith('10.')),key=lambda p:tuple(int(v) for v in p.name.split('.') if v.isdigit()))
  sdk=versions(system/'sdk')[-1];runtime=versions(system/'shared/Microsoft.NETCore.App')[-1];host=versions(system/'host/fxr')[-1]
  for relative,origin in [('dotnet',system/'dotnet'),('compiler',sdk/'Roslyn/bincore'),('shared/Microsoft.NETCore.App/'+runtime.name,runtime),('host/fxr/'+host.name,host),('LICENSE.txt',system/'LICENSE.txt'),('ThirdPartyNotices.txt',system/'ThirdPartyNotices.txt')]:
   if origin.is_dir():
    for parent,dirs,files in os.walk(origin):
     for name in dirs+files:
      if (Path(parent)/name).is_symlink():raise ValueError('Pinned compiler source unexpectedly contains a link')
     for name in files:
      source_file=Path(parent)/name;destination='.voltra/puck-compiler/'+relative+'/'+str(source_file.relative_to(origin))
      with source_file.open('rb') as incoming:steam_template._publish(root,destination,lambda outgoing:shutil.copyfileobj(incoming,outgoing),source_file.stat().st_mode & 0o777)
   elif origin.is_file():
    with origin.open('rb') as incoming:steam_template._publish(root,'.voltra/puck-compiler/'+relative,lambda outgoing:shutil.copyfileobj(incoming,outgoing),origin.stat().st_mode & 0o777)
  compiler=system/'dotnet';csc=sdk/'Roslyn/bincore/csc.dll' # Root installer executes only immutable-image tools.
 else:
  compiler=confined(root,'.voltra/puck-compiler/dotnet');csc=confined(root,'.voltra/puck-compiler/compiler/csc.dll')
  if not compiler.is_file() or not csc.is_file():raise ValueError('Puck compatibility compiler is missing; reinstall using the reviewed SDK installer')
 environment={**os.environ,'DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_NOLOGO':'1','DOTNET_GCHeapHardLimit':'0x10000000'}
 for name in ['PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH']:environment.pop(name,None)
 if compiler==private/'dotnet':environment.update(DOTNET_ROOT=str(private),DOTNET_MULTILEVEL_LOOKUP='0')
 references=['mscorlib.dll','System.dll','System.Core.dll','netstandard.dll','Puck.dll','0Harmony.dll','Newtonsoft.Json.dll','UnityEngine.CoreModule.dll','Unity.Netcode.Runtime.dll','SuperSimpleTcp.dll']
 with tempfile.TemporaryDirectory(prefix='voltra-puck-build-') as temporary:
  built=Path(temporary)/'VoltraLegacyControls.dll'
  subprocess.run([str(compiler),str(csc),'-nologo','-target:library','-langversion:latest','-deterministic+','-noconfig','-nostdlib+','-pathmap:'+str(root)+'=/_/puck','-out:'+str(built),*['-r:'+str(managed/name) for name in references],str(source)],cwd=root,env=environment,check=True,timeout=180)
  if not built.is_file() or built.stat().st_size>1024*1024:raise ValueError('Puck compatibility plugin build output is invalid')
  with built.open('rb') as incoming:steam_template._publish(root,'Plugins/VoltraLegacyControls/VoltraLegacyControls.dll',lambda out:shutil.copyfileobj(incoming,out))
 identities['Plugins/VoltraLegacyControls/VoltraLegacyControls.dll']=hashlib.sha256(target.read_bytes()).hexdigest()
 payload=(json.dumps({'plugin':'VoltraLegacyControls-v1','license':'MIT','publisher_api':'IPuckPlugin','client_plugin_required':False,'sha256':identities},indent=2)+'\n').encode()
 steam_template._publish(root,'.voltra/puck-compat-release.json',lambda out:out.write(payload),0o600)
def install(root,game,env,validate=True):
 root=root.resolve();app=APPS[game]
 if env.get('SRCDS_APPID',app)!=app:raise ValueError('This recipe requires its original dedicated-server app ID')
 steam_template.arguments(root,int(app),env,validate) # Private-credential gate precedes all writes/processes.
 paths=[config_path(root,game,env)]
 if game=='puck':paths.extend(confined(root,name) for name in ['server_config.json','public_game_mode_config.json'])
 saved=[]
 for path in paths:
  metadata=path.stat() if path.exists() else None
  if metadata and metadata.st_size>4*1024*1024:raise ValueError('Native JSON exceeds four MiB')
  if metadata:saved.append((path,path.read_bytes(),metadata))
 required={'banana':('BSDS.x86_64',),'nuclear':('NuclearOptionServer.x86_64',),'puck':('start_server.sh',)}[game]
 try:
  receipt=steam_template.update(root,int(app),env,validate=validate,required=required)
  if game=='puck':build_puck_plugin(root)
  return receipt
 finally:
  for path,content,metadata in saved:
   confined(root,str(path.relative_to(root))) # Recheck after publisher process, including symlink replacement.
   path.parent.mkdir(parents=True,exist_ok=True)
   fd,temporary=tempfile.mkstemp(prefix='.voltra-restore-',dir=path.parent)
   try:
    with os.fdopen(fd,'wb') as output:output.write(content)
    os.replace(temporary,path)
   finally:
    if os.path.exists(temporary):os.unlink(temporary)
   os.chmod(path,metadata.st_mode & 0o777)
   if hasattr(os,'chown'):os.chown(path,metadata.st_uid,metadata.st_gid)
if __name__=='__main__':install(Path.cwd(),sys.argv[1],dict(os.environ))
