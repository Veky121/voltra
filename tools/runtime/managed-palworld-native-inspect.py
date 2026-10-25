import json,sys,stat,hashlib,importlib.util,re
from pathlib import Path
spec=importlib.util.spec_from_file_location('common','/common.py');common=importlib.util.module_from_spec(spec);spec.loader.exec_module(common)
expected=json.loads(sys.stdin.read(16384));root=Path('/game')
platform=sys.argv[2] if len(sys.argv)>2 else 'linux'
if platform not in ('linux','windows'):raise ValueError('Exact supported platform required')
configuration='Pal/Saved/Config/'+('WindowsServer' if platform=='windows' else 'LinuxServer')+'/PalWorldSettings.ini'
file=root/configuration;text=file.read_text() if file.exists() else ''
values={}
for key in ['ServerName','ServerDescription','ServerPlayerMaxNum','PublicIP','PublicPort','RCONEnabled','RCONPort','CrossplayPlatforms','AllowConnectPlatform','ExpRate']:
 match=re.search(r'(?:\(|,)'+re.escape(key)+r'=(\([^)]*\)|"(?:\\.|[^"\\])*"|[^,)]+)',text)
 if match:values[key]=match.group(1)
for key,secret in [('AdminPassword','admin'),('ServerPassword','join')]:
 match=re.search(r'(?:\(|,)'+key+r'="([^"\\]*)"',text);values[key+'_matches_expected']=bool(match and match.group(1)==expected[secret])
report={'configuration':values,'native_configuration_exists':file.exists(),'world_ids':sorted(p.name for p in (root/'Pal/Saved/SaveGames/0').glob('*') if p.is_dir() and re.fullmatch('[A-Fa-f0-9]{32}',p.name))}
if sys.argv[1]=='snapshot':
 files={}
 bases=[root/'Pal/Saved',root/'.voltra']
 if platform=='windows':bases += [root/path for path in ['Pal/Binaries/Win64/ue4ss/Mods','Pal/Binaries/Win64/ue4ss/UE4SS-settings.ini','Pal/Binaries/Win64/ue4ss/UE4SS_SDK_Backends','Pal/Content/Paks/LogicMods','Pal/Content/Paks/~mods','Pal/Content/Paks/Mods']]
 for base in bases:
  if not base.exists():continue
  for path in base.rglob('*') if base.is_dir() else [base]:
   st=path.lstat()
   if not stat.S_ISREG(st.st_mode):
    if stat.S_ISDIR(st.st_mode):continue
    raise ValueError('Private protected path contains link/special file')
   files[path.relative_to(root).as_posix()]={'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'size':st.st_size,'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid}
 report['protected_files']=files
else:
 report.update(common.processes())
 for process in report['processes']:
  environ=(Path('/proc')/str(process['pid'])/'environ').read_bytes().decode('utf-8',errors='replace')
  process['forbidden_environment_keys']=[key for key in ['ADMIN_PASSWORD','SERVER_PASSWORD','PASSWORD','SRCDS_BETAPASS','STEAM_PASS','STEAM_AUTH'] if key+'=' in environ]
  if process['forbidden_environment_keys']:raise ValueError('Native process inherited forbidden credential environment')
  if any(secret in '\0'.join(process['argv']) or secret in environ for secret in expected.values()):raise ValueError('Native credential leaked into process arguments/environment')

if (root/'.voltra/palworld-console.json').exists():
 config=json.loads((root/'.voltra/palworld-console.json').read_text());report['private_console_matches_expected']=config['default']['password']==expected['admin']
 package={}
 for name in ['.voltra/console-client','.voltra/palworld-console.json','.voltra/palworld-start.sh',configuration]:
  path=root/name;st=path.lstat();package[name]={'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid}
 report['private_files']=package
manifest=root/'steamapps/appmanifest_2394010.acf'
if manifest.exists():report['appmanifest']=manifest.read_text()
print(json.dumps(report))
