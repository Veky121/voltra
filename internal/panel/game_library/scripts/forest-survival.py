#!/usr/bin/env python3
"""MIT. Original Forest/Sons/Sunkenland typed source adapters; no native proof."""
import contextlib,hashlib,importlib.util,ipaddress,json,os,re,shutil,sys,tempfile,urllib.request,uuid,signal
from pathlib import Path

def helper(name):
 path=Path(__file__).with_name(name+'.py')
 if not path.exists():path=path.with_name(name.replace('-','_')+'.py')
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules[name.replace('-','_')]=module;spec.loader.exec_module(module);return module

shared=helper('steam-native-next');steam=shared.steam;console=helper('native-console');wine=helper('private-wine-prerequisites')
PINS=json.loads(Path(__file__).with_name('forest-survival-pins.json').read_text())
GAMES={'forest':('556450','TheForestDedicatedServer.exe'),'sons':('2465200','SonsOfTheForestDS.exe'),'sunken':('2667530','Sunkenland-DedicatedServer.exe')}
SUN=' .wine/drive_c/users/container/AppData/LocalLow/Vector3 Studio/Sunkenland'.lstrip()
FOREST_CONFIG='TheForestDedicatedServer_Data/forest/config/config.cfg'

def path(root,name):return shared.confined(root,root/name)
def text(env,key,default='',maximum=255):return shared.text(env,key,default,maximum)
def integer(env,key,default,low=1,high=65535):return shared.integer(env,key,default,low,high)
def choice(env,key,default,values):
 value=text(env,key,default)
 if value not in values:raise ValueError('Invalid '+key)
 return value

def roles(game,env):
 keys={'forest':['STEAM_PORT','QUERY_PORT'],'sons':['QUERY_PORT','BLOBSYNC_PORT'],'sunken':[]}[game]
 defaults={'SERVER_PORT':8766 if game=='sons' else 27015,'STEAM_PORT':8766,'QUERY_PORT':27016,'BLOBSYNC_PORT':9700}
 result={};used=set();raw=env.get('VOLTRA_ALLOCATED_PORTS','')
 if not re.fullmatch(r'[0-9]+(?:,[0-9]+)*',raw):raise ValueError('Explicit allocation list required')
 available={int(v) for v in raw.split(',')}
 if any(not 1<=v<=65535 for v in available):raise ValueError('Invalid allocation list')
 for key in ['SERVER_PORT',*keys]:
  value=integer(env,key,defaults[key])
  if value not in available or value in used:raise ValueError('Distinct allocated '+key+' required')
  result[key]=value;used.add(value)
 return result

def publish(root,name,content,mode=0o600):
 path(root,name);steam._publish(root,name,lambda output:output.write(content),mode)

def patch_forest(previous,values):
 result=[];seen=set()
 for row in previous.splitlines(keepends=True):
  stripped=row.strip();key=stripped.split(None,1)[0] if stripped else ''
  if key in values and not stripped.startswith('//'):
   if key in seen:raise ValueError('Duplicate managed Forest setting: '+key)
   seen.add(key);row=key+' '+values[key]+'\n'
  result.append(row)
 if result and not result[-1].endswith('\n'):result[-1]+='\n'
 return ''.join(result)+''.join(key+' '+value+'\n' for key,value in values.items() if key not in seen)

def configure(root,game,env):
 root=Path(root).resolve();app,binary=GAMES[game]
 if env.get('SRCDS_APPID',app)!=app or env.get('WINDOWS_INSTALL','1')!='1':raise ValueError('Original Windows dedicated app is required')
 steam.arguments(root,int(app),env,platform='windows',force_platform=True)
 ports=roles(game,env);secrets=[]
 if game=='forest':
  password=text(env,'SERVER_PASS','',20);admin=text(env,'ADMIN_PASS','cHanGetHePaSwWord',20);token=text(env,'STEAM_ACC','');secrets=[password,admin,token]
  values={'serverIP':'0.0.0.0','serverSteamPort':str(ports['STEAM_PORT']),'serverGamePort':str(ports['SERVER_PORT']),'serverQueryPort':str(ports['QUERY_PORT']),'serverName':text(env,'SERVER_NAME','Pterodactyl Forest Server',64),'serverPlayers':str(integer(env,'MAX_PLAYERS',10,1,100)),'serverPassword':password,'serverPasswordAdmin':admin,'serverSteamAccount':token,'enableVAC':choice(env,'VAC','off',['on','off']),'initType':choice(env,'INIT_TYPE','New',['New','Continue']),'difficulty':choice(env,'SERVER_DIFFICULTY','Normal',['Peaceful','Normal','Hard'])}
  target=path(root,FOREST_CONFIG)
  if target.exists() and target.stat().st_size>4*1024*1024:raise ValueError('Forest config exceeds budget')
  previous=target.read_text() if target.exists() else PINS['forest_default_config']
  if len(previous.encode())>4*1024*1024:raise ValueError('Forest config exceeds budget')
  publish(root,FOREST_CONFIG,patch_forest(previous,values).encode())
  args=['-batchmode','-nographics','-serverPasswordAdmin',admin,'-inittype',values['initType'],'-nosteamclient','-savefolderpath',str(path(root,'TheForestDedicatedServer_Data')),'-configfilepath',str(target)]
  ready=b'Game autosave started'
 elif game=='sons':
  password=text(env,'SRV_PW','changeme',40);secrets=[password]
  slot=text(env,'SAVE_SLOT','0000000001',30)
  if not re.fullmatch('[0-9]{1,30}',slot) or int(slot)<1 or int(slot)>2147483647:raise ValueError('SAVE_SLOT requires a positive native Int32; legacy leading zeros are preserved in the source field')
  target=path(root,'serverconfig/dedicatedserver.cfg')
  if target.exists() and target.stat().st_size>4*1024*1024:raise ValueError('Sons config exceeds budget')
  config=json.loads(target.read_text(encoding='utf-8-sig')) if target.exists() else {}
  if not isinstance(config,dict):raise ValueError('Sons config must be an object')
  config.update(IpAddress='0.0.0.0',GamePort=ports['SERVER_PORT'],QueryPort=ports['QUERY_PORT'],BlobSyncPort=ports['BLOBSYNC_PORT'],ServerName=text(env,'SRV_NAME','Pterodactyl hosted Server',60),MaxPlayers=integer(env,'MAX_PLAYERS',4,1,8),Password=password,GameMode=choice(env,'GAME_MODE','normal',['normal','hard','hardsurvival','peaceful','custom']),SkipNetworkAccessibilityTest=choice(env,'SKIP_TESTS','false',['true','false'])=='true',SaveSlot=int(slot),LogFilesEnabled=True,TimestampLogFilenames=True)
  publish(root,'serverconfig/dedicatedserver.cfg',(json.dumps(config,indent=2)+'\n').encode())
  if not path(root,'serverconfig/ownerswhitelist.txt').exists():publish(root,'serverconfig/ownerswhitelist.txt',b'')
  args=['-userdatapath',str(path(root,'serverconfig'))]
  ready=b'#DSL Dedicated server loaded.'
 else:
  guid=text(env,'WORLD_GUID','11223344-5566-7788-99aa-bbccddeeff00')
  try:guid=str(uuid.UUID(guid))
  except ValueError:raise ValueError('WORLD_GUID must be the uploaded world UUID') from None
  password=text(env,'PASSWORD','12345678',8)
  if not password.isascii():raise ValueError('Sunkenland publisher password must be ASCII')
  region=choice(env,'REGION','asia',['asia','cn','jp','eu','sa','kr','us','usw']);maximum=integer(env,'MAX_PLAYER',3,3,15)
  address=text(env,'SERVER_IP','0.0.0.0')
  try:ipaddress.IPv4Address(address)
  except ValueError:raise ValueError('SERVER_IP must be an IPv4 address') from None
  world(root,env,False);secrets=[password]
  args=['-nographics','-batchmode','-worldGuid',guid,'-region',region,'-password',password,'-maxPlayerCapacity',str(maximum),'-publicIP',address,'-publicPort',str(ports['SERVER_PORT'])]
  ready=b'Server Start Complete, Ready for Clients to Join. ServerID is '
 return ['xvfb-run','--auto-servernum','--server-args=-screen 0 640x480x24:32','wine',str(path(root,binary)),*args],tuple(v for v in secrets if v),ready

def world(root,env,bootstrap):
 guid=str(uuid.UUID(text(env,'WORLD_GUID','11223344-5566-7788-99aa-bbccddeeff00')))
 name=text(env,'SERVER_NAME','Pterodactyl World') or 'Pterodactyl Sunkenland'
 if name in ['.','..'] or any(v in name for v in ['~','/','\\',':']):raise ValueError('SERVER_NAME must be a world folder name')
 base=path(root,SUN+'/Worlds');target=path(root,SUN+'/Worlds/'+name+'~'+guid)
 found=[item for item in base.glob('*~'+guid) if item.is_dir()] if base.exists() else []
 for item in found:shared.confined(root,item)
 if len(found)>1:raise ValueError('Multiple Sunkenland worlds have this GUID; resolve collision without deletion')
 if not found:
  if not bootstrap:raise ValueError('Upload the selected Sunkenland world before starting')
  if guid!=PINS['sample_world']['guid']:raise ValueError('Selected Sunkenland world is missing; upload the legitimate world files')
  # Original catalog default is supported as an explicitly pinned legacy sample,
  # never replacing an existing world. Current game compatibility is not implied.
  payloads=[]
  for item in PINS['sample_world']['files']:
   request=urllib.request.Request(item['url'],headers={'User-Agent':'Voltra-forest-survival/1'})
   with urllib.request.urlopen(request,timeout=30) as response:data=response.read(item['bytes']+1)
   if len(data)!=item['bytes'] or hashlib.sha1(('blob '+str(len(data))+'\0').encode()+data).hexdigest()!=item['git_blob_sha1'] or hashlib.sha256(data).hexdigest()!=item['sha256']:raise ValueError('Pinned sample world SHA256/Git object identity mismatch')
   payloads.append((item['name'],data))
  # Publish a complete new world directory once. A failed member never leaves a
  # partial default world that a later install could mistake for operator data.
  with steam._publication_parent(root,str(base.relative_to(root))+'/placeholder',create=True):pass
  if target.exists():raise ValueError('Sunkenland sample destination changed; existing files retained')
  with tempfile.TemporaryDirectory(prefix='.voltra-world-',dir=base) as folder:
   stage=Path(folder)
   if os.geteuid()==0:os.chown(stage,root.stat().st_uid,root.stat().st_gid)
   for filename,data in payloads:publish(root,str(stage.relative_to(root))+'/'+filename,data)
   if target.exists():raise ValueError('Sunkenland sample destination changed; existing files retained')
   os.rename(stage,target)
  found=[target]
 if found[0]!=target:
  if target.exists():raise ValueError('Sunkenland rename destination exists; operator files retained')
  os.rename(found[0],target) # Same-volume move preserves every file's metadata.
 for filename in ['AdminSteamIDs.txt','BanSteamIDs.txt']:
  if not path(root,str(target.relative_to(root))+'/'+filename).exists():publish(root,str(target.relative_to(root))+'/'+filename,b'')
 return target

def preserve_paths(game):
 common=['Mods','BepInEx/config','BepInEx/plugins','MelonLoader/Mods']
 return common+{'forest':['TheForestDedicatedServer_Data/forest','TheForestDedicatedServer_Data/Multiplayer','TheForestDedicatedServer_Data/Saves','.wine/drive_c/users/container/AppData/LocalLow/SKS/TheForestDedicatedServer'],'sons':['serverconfig'],'sunken':[SUN]}[game]

@contextlib.contextmanager
def preserve(root,game):
 # Stream saves to bounded private disk staging, not RAM; retain exact metadata.
 folder=Path(tempfile.mkdtemp(prefix='.forest-preserve-',dir=root));identity=folder.stat();retain=False
 try:
  saved={};total=0
  for relative in preserve_paths(game):
   origin=path(root,relative)
   if not origin.exists():continue
   for parent,dirs,files in os.walk(origin,followlinks=False):
    for name in dirs+files:shared.confined(root,Path(parent)/name)
    for name in files:
     source=Path(parent)/name;relative=str(source.relative_to(root))
     if relative in saved:continue
     metadata=source.stat();total+=metadata.st_size
     if total>32*1024**3:raise ValueError('Save/config preservation exceeds 32GiB; make an external backup first')
     backup=Path(folder)/str(len(saved));shutil.copyfile(source,backup);saved[relative]=(backup,metadata)
  try:yield
  finally:
   errors=[]
   for relative,(backup,metadata) in saved.items():
    try:
     shared.confined(root,root/relative)
     def restore(output,backup=backup):
      with backup.open('rb') as source:shutil.copyfileobj(source,output)
     steam._publish(root,relative,restore,metadata.st_mode&0o777)
     with steam._publication_parent(root,relative) as (parent,leaf,volume):
      descriptor=os.open(leaf,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent)
      try:
       current=os.fstat(descriptor)
       if (current.st_uid,current.st_gid)!=(metadata.st_uid,metadata.st_gid):os.fchown(descriptor,metadata.st_uid,metadata.st_gid)
       os.fchmod(descriptor,metadata.st_mode&0o777)
      finally:os.close(descriptor)
    except (ValueError,OSError) as error:errors.append(relative)
   if errors:
    retain=True
    manifest={relative:{'backup':backup.name,'mode':metadata.st_mode&0o777,'uid':metadata.st_uid,'gid':metadata.st_gid} for relative,(backup,metadata) in saved.items()}
    (folder/'recovery.json').write_text(json.dumps({'failed_paths':errors,'files':manifest},indent=2)+'\n')
    raise RuntimeError('Save/config restoration incomplete; recovery copies retained in '+folder.name)
 finally:
  if not retain:
   current=folder.lstat()
   if folder.is_symlink() or folder.resolve().parent!=root or (current.st_dev,current.st_ino)!=(identity.st_dev,identity.st_ino):raise ValueError('Private preservation directory changed; cleanup refused')
   shutil.rmtree(folder)

def install(root,game,env):
 root=Path(root).resolve();app,binary=GAMES[game]
 if env.get('SRCDS_APPID',app)!=app or env.get('WINDOWS_INSTALL','1')!='1':raise ValueError('Original Windows dedicated app is required')
 steam.arguments(root,int(app),env,platform='windows',force_platform=True);roles(game,env)
 with preserve(root,game):receipt=steam.update(root,int(app),env,platform='windows',force_platform=True,required=(binary,))
 if game=='sunken':world(root,env,True)
 return receipt

def run(root,game,env):
 root=Path(root).resolve()
 if env.get('WINEPREFIX',str(root/'.wine'))!=str(root/'.wine'):raise ValueError('This family requires its original private .wine prefix for save/admin compatibility')
 auto=choice(env,'VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','1'),['0','1'])
 if auto=='1':install(root,game,env)
 argv,secrets,ready=configure(root,game,env)
 defaults={'forest':'sound=disabled','sons':'mono vcrun2019','sunken':'mono vcrun2022'}
 environment=wine.prepare(root,env,defaults[game],PINS,('mono','vcrun2019','vcrun2022','sound=disabled'))
 return console.run(root,argv,environment,'\x03',credentials=secrets,ready_marker=ready,terminal_input=True,stop_signal=signal.SIGINT)

if __name__=='__main__':
 try:
  operation,game=sys.argv[1:]
  if operation not in ['run','install'] or game not in GAMES:raise ValueError('Expected install/run and an original family game')
  sys.exit(run(Path.cwd(),game,dict(os.environ)) if operation=='run' else (install(Path.cwd(),game,dict(os.environ)) and 0))
 except (ValueError,OSError) as error:print('Forest survival setup failed: '+str(error),file=sys.stderr);sys.exit(2)
