// Source/archive inspection only. Never extracts into an installation or runs tML.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const directory='.local/tmodloader-runtime-family-audit';
export const cases=[
 {tag:'v0.11.8.9',kind:'legacy',file:directory+'/legacy-0.11.8.9.zip',asset:'tModLoader.Linux.v0.11.8.9.zip'},
 {tag:'v2023.06.25.36',kind:'modern',file:directory+'/net6-2023.06.25.36.zip',asset:'tModLoader.zip'},
 {tag:'v2026.08.3.0',kind:'modern',file:'.local/tmodloader/server.zip',asset:'tModLoader.zip'},
];
export function official(url,source=false){
 const u=new URL(url),hosts=source?['api.github.com','raw.githubusercontent.com']:['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'];
 if(u.protocol!=='https:'||!hosts.includes(u.hostname)||u.username||u.password||(u.port&&u.port!=='443'))throw Error('Nonofficial HTTPS endpoint');
 return url;
}
export function selectAsset(release,tag,kind){
 if(release.tag_name!==tag||release.draft||release.prerelease)throw Error('Exact stable release required');
 if(!/^v(?:0\.11\.\d+(?:\.\d+)?|20\d{2}(?:\.\d+){3})$/.test(tag))throw Error('Unsupported tag syntax');
 const name=kind==='legacy'?`tModLoader.Linux.${tag}.zip`:'tModLoader.zip';
 const matches=release.assets.filter(a=>a.name===name);if(matches.length!==1)throw Error('Missing/ambiguous exact Linux asset');
 const a=matches[0],expected=`https://github.com/tModLoader/tModLoader/releases/download/${tag}/${name}`;
 if(official(a.browser_download_url)!==expected)throw Error('Asset owner/tag/name mismatch');
 if(!Number.isSafeInteger(a.size)||a.size<1||a.size>100_000_000)throw Error('Asset exceeds audit bound');
 if(a.digest!==null&&a.digest!==undefined&&!/^sha256:[0-9a-f]{64}$/.test(a.digest))throw Error('Invalid publisher digest');
 return {name,url:expected,bytes:a.size,expected_sha256:a.digest?.slice(7)||null,
  assurance:a.digest?'publisher-checksum':'publisher-HTTPS',local_hash_is_independent_assurance:false};
}
export function runtimeFamily(configuration,actual=null){
 const found=[...configuration.matchAll(/^\+\s*<TargetFramework>(net\d+\.0)<\/TargetFramework>/gm)].map(m=>m[1]);
 if(found.length!==1||!['net6.0','net8.0'].includes(found[0]))throw Error('Unproven modern runtime family');
 const family=found[0];
 if(actual){const options=actual.runtimeOptions;if(options?.tfm!==family||options.framework?.name!=='Microsoft.NETCore.App'||!options.framework.version?.startsWith(family.slice(3)+'.'))throw Error('Actual archive/source runtime mismatch');}
 return family;
}
export function verifySources(index,read){
 for(const item of index){
  official(item.url,true);
  if(!item.url.startsWith(`https://raw.githubusercontent.com/tModLoader/tModLoader/${item.tag}/`)||item.local.includes('/')||item.local.includes('\\')||item.local.includes('..'))throw Error('Source provenance path mismatch');
  const bytes=read(item.local);
  if(bytes.length!==item.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Source snapshot hash mismatch');
 }
}
export function inspectArchive(file){
 const program=String.raw`import hashlib,json,stat,struct,sys,zipfile
from pathlib import PurePosixPath
p=sys.argv[1];h=hashlib.sha256()
with open(p,'rb') as f:
 for b in iter(lambda:f.read(1048576),b''):h.update(b)
with zipfile.ZipFile(p) as z:
 seen=set();total=0
 for e in z.infolist():
  n=PurePosixPath(e.filename);mode=e.external_attr>>16
  if n.is_absolute() or '..' in n.parts or '\\' in e.filename or ':' in e.filename or e.filename.casefold() in seen:raise ValueError('Unsafe/duplicate archive path')
  if stat.S_IFMT(mode) not in (0,stat.S_IFDIR,stat.S_IFREG):raise ValueError('Archive link/special entry rejected')
  seen.add(e.filename.casefold());total+=e.file_size
  if len(seen)>50000 or total>4*1024**3:raise ValueError('Archive inspection budget exceeded')
 names=z.namelist();files=[];runtime=None;scripts={};legacy_native=None
 wanted={'tModLoader.dll','tModLoader.runtimeconfig.json','tModLoader.deps.json','tModLoaderServer','tModLoaderServer.exe','tModLoaderServer.bin.x86_64','tModLoaderServer.bin.x86','libmonosgen-2.0.so','libmonosgen-2.0.so.1','libSDL2-2.0.so.0'}
 for name in names:
  if PurePosixPath(name).name not in wanted:continue
  e=z.getinfo(name)
  with z.open(e) as f:b=f.read(65537 if name.endswith('runtimeconfig.json') or PurePosixPath(name).name=='tModLoaderServer' else 20)
  kind='ELF' if b[:4]==b'\x7fELF' else 'PE' if b[:2]==b'MZ' else 'script' if b[:2]==b'#!' else 'data'
  row={'path':name,'bytes':e.file_size,'format':kind}
  if kind=='ELF':row.update(elf_class=b[4],elf_endian=b[5],machine=int.from_bytes(b[18:20],'little'))
  files.append(row)
  if name=='tModLoader.runtimeconfig.json':
   if len(b)>65536:raise ValueError('Runtime config oversized')
   runtime=json.loads(b)
  if PurePosixPath(name).name=='tModLoaderServer' and kind=='script':scripts[name]=b.decode('utf-8')
  if name=='tModLoaderServer.bin.x86_64':
   with z.open(e) as f:binary=f.read(32*1024*1024+1)
   if len(binary)>32*1024*1024 or binary[:6]!=b'\x7fELF\x02\x01':raise ValueError('Unsupported legacy native executable')
   phoff=struct.unpack_from('<Q',binary,32)[0];phsize,phcount=struct.unpack_from('<HH',binary,54)
   segments=[struct.unpack_from('<IIQQQQQQ',binary,phoff+i*phsize) for i in range(phcount)]
   needed=[];strtab=None;interpreter=None
   for s in segments:
    if s[0]==3:interpreter=binary[s[2]:s[2]+s[5]].rstrip(b'\0').decode()
    if s[0]!=2:continue
    for off in range(s[2],s[2]+s[5],16):
     tag,value=struct.unpack_from('<QQ',binary,off)
     if tag==0:break
     if tag==1:needed.append(value)
     if tag==5:strtab=value
   libraries=[]
   if strtab is not None:
    segment=next(s for s in segments if s[0]==1 and s[3]<=strtab<s[3]+s[5]);base=segment[2]+strtab-segment[3]
    for offset in needed:libraries.append(binary[base+offset:binary.index(b'\0',base+offset)].decode())
   legacy_native={'interpreter':interpreter,'needed_shared_libraries':libraries,'inspection':'ELF metadata only; not ldd, no execution'}
 print(json.dumps({'archive_sha256':h.hexdigest(),'archive_bytes':__import__('os').path.getsize(p),'entries':len(names),'unpacked_bytes':total,'files':files,'runtimeconfig':runtime,'server_launcher_sources':scripts,'legacy_native_dependencies':legacy_native,'legacy_mono_files':[n for n in names if n in ['monoconfig','monomachineconfig','mscorlib.dll','Mono.Security.dll','System.dll','FNA.dll','FNA.dll.config']],'native_libraries':[n for n in names if n.endswith(('.so','.so.0','.so.1')) or '/lib64/' in n or n.startswith('lib64/')]}))
`;
 const r=spawnSync(process.env.PYTHON||'python',['-c',program,file],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
 if(r.status!==0)throw Error('Archive inspection rejected: '+r.stderr.slice(-1200));
 return JSON.parse(r.stdout);
}
async function acquireApproved(){
 for(const c of cases.slice(0,2)){
  const release=JSON.parse(fs.readFileSync(`${directory}/${c.tag}-release.json`));const a=selectAsset(release,c.tag,c.kind);
  if(fs.existsSync(c.file)||fs.existsSync(c.file+'.partial'))throw Error('Owned acquisition already exists; no automatic retry');
  fs.writeFileSync(c.file+'.admission.json',JSON.stringify({at:new Date().toISOString(),asset:a,scope:'root-approved archive inspection only, no execution'},null,2),{flag:'wx'});
  let url=a.url,response;
  for(let redirects=0;redirects<=4;redirects++){
   official(url);response=await fetch(url,{redirect:'manual',headers:{'User-Agent':'Voltra-tModLoader-source-audit'},signal:AbortSignal.timeout(60000)});
   if([301,302,303,307,308].includes(response.status)){await response.body?.cancel();url=new URL(response.headers.get('location'),url).href;continue;}
   break;
  }
  if(!response?.ok||response.status!==200)throw Error('Official archive denied/unavailable; no fallback');
  const fd=fs.openSync(c.file+'.partial','wx',0o600);let size=0;
  try{for await(const chunk of response.body){size+=chunk.length;if(size>a.bytes||size>100_000_000)throw Error('Archive transfer exceeds exact approved bound');fs.writeSync(fd,chunk);}fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  if(size!==a.bytes)throw Error('Archive size mismatch');
  const observed=inspectArchive(c.file+'.partial');
  if(a.expected_sha256&&observed.archive_sha256!==a.expected_sha256)throw Error('Publisher checksum mismatch');
  fs.renameSync(c.file+'.partial',c.file);
  fs.writeFileSync(c.file+'.inspection.json',JSON.stringify({at:new Date().toISOString(),assurance:a.assurance,...observed},null,2));
  console.log(JSON.stringify({tag:c.tag,bytes:size,assurance:a.assurance,entries:observed.entries}));
 }
}
export function audit(){
 const index=JSON.parse(fs.readFileSync(directory+'/source-index.json'));
 verifySources(index,name=>fs.readFileSync(directory+'/'+name));
 const source=(tag,p)=>fs.readFileSync(directory+'/'+index.find(i=>i.tag===tag&&i.path===p).local,'utf8');
 const families=cases.map(c=>{
  const release=JSON.parse(fs.readFileSync(`${directory}/${c.tag}-release.json`));const asset=selectAsset(release,c.tag,c.kind);
  const actual=fs.existsSync(c.file)?inspectArchive(c.file):null;
  if(actual&&asset.expected_sha256&&actual.archive_sha256!==asset.expected_sha256)throw Error('Cached archive/publisher digest mismatch');
  if(actual&&actual.archive_bytes!==asset.bytes)throw Error('Cached archive size mismatch');
  const family=c.kind==='legacy'?'legacy-native-Mono':runtimeFamily(source(c.tag,'patches/TerrariaNetCore/Configuration.targets.patch'),actual?.runtimeconfig);
  return {tag:c.tag,release_name:release.name,asset,family,archive_inspected:!!actual,actual,
   archive_path:c.file,
   platforms_proven:actual?actual.files.filter(f=>f.format==='ELF').map(f=>({path:f.path,machine:f.machine,class:f.elf_class})):[],
   runtime_execution_proven:false,world_or_mod_migration_proven:false};
 });
 return {at:new Date().toISOString(),kind:'tModLoader-runtime-family-source-and-archive-audit',network_game_execution:false,installation_or_profile_changed:false,
  approved_archive_acquisition:{count:2,total_bytes:88_139_836,per_artifact_cap_bytes:100_000_000,execution:false,vanilla_acquisition:false},
  families,source_index:index,
  integration:{owner:'private_steam_node_bridge',shared_files_edited:false,net6_runtime_interface:'ensure_runtime(root,arch,opener) / verify_runtime(root,arch,archive=None)',net6_version:'6.0.36',scope:'Reuse isolated Microsoft SHA512 runtime concept only; TShock apphost launch plan is not a tModLoader launch plan',end_of_support:'NET6 is end-of-life; retain explicit assurance/limitation'},
  preservation_contract:['Keep .wld and corresponding .twld plus backups together; do not drop mod sidecars','Keep enabled.json, installed .tmod packages, ModConfigs and saves; no automatic mod update/workshop acquisition','Use explicit existing -tmlsavedirectory and -modpath with validated literal argv to prevent default-folder migration','Refuse unapproved world/runtime-family downgrade; use a version-matched separate server/backup','Changing .NET runtime major does not establish tML API/mod/world compatibility'],
  proposed_startup_contract:{
   net6:{host:'verified isolated Microsoft.NETCore.App6.0.36 dotnet',assembly:'tModLoader.dll',server_argument:'-server',environment:{DOTNET_MULTILEVEL_LOOKUP:'0',DOTNET_ROOT:'verified private runtime directory',LD_LIBRARY_PATH:'verified Libraries/Native/Linux'},runtime_config:'actual net6.0/6.0.0 default patch roll-forward, no major override',not_implemented:true},
   net8:{host:'verified selected NET8 dotnet, never assume NET6/NET9 major compatibility',assembly:'tModLoader.dll',server_argument:'-server',environment:{LD_LIBRARY_PATH:'verified Libraries/Native/Linux'},not_implemented:true},
   legacy:{host:'tModLoaderServer.bin.x86_64',managed_server:'tModLoaderServer.exe',environment:{MONO_IOMAP:'all'},bundled_mono_metadata:['monoconfig','monomachineconfig','mscorlib.dll','System.dll'],external_system_mono_declared_in_DT_NEEDED:false,dynamic_loading_or_runtime_completeness_proven:false,prerequisite:'Publisher tag README requires version-matched vanilla Terraria1.3.5.3 server first; completeness/boot effect remains unproved',not_implemented:true}
  },
  unsupported_until_implemented:['Installer resolver/layout dispatch for exact legacy Linux ZIP/native dependencies','Runtime plan consumes actual archive/runtimeconfig, not a version-prefix-only claim','NET6 isolated launcher and NET8 selected runtime verification before publication/start','Legacy vanilla1.3.5.3 prerequisite and native/bundled-Mono vs system-Mono dependency proof','Native startup, shutdown, socket/protocol, real old-world/mod compatibility all remain untested']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(process.argv.includes('--acquire-approved'))await acquireApproved();
 const result=audit();fs.writeFileSync('artifacts/tmodloader-runtime-family-audit.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result.families.map(f=>({tag:f.tag,family:f.family,bytes:f.asset.bytes,assurance:f.asset.assurance,archive_inspected:f.archive_inspected})),null,2));
}
