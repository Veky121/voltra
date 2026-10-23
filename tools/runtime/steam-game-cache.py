"""MIT. Pristine anonymous Steam payload cache; native Steam verifies publisher data."""
import argparse, contextlib, fcntl, hashlib, json, os, re, shutil, stat, sys, tempfile, time
from pathlib import Path, PurePosixPath
sys.path.insert(0,str(Path(__file__).parent/'steam-game-cache-vendor'))
import vdf
CAPACITY=20*1024**3
HEX=re.compile(r'[a-f0-9]{64}')

def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def digest(path):
    result=hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda:source.read(1024*1024),b''):result.update(block)
    return result.hexdigest()
def safe(name):
    p=PurePosixPath(name)
    if not name or p.is_absolute() or str(p)!=name or any(part in ('.','..','') or len(part.encode())>255 or part.endswith((' ','.')) for part in p.parts) or len(name.encode())>4096 or '\\' in name or ':' in name or any(ord(c)<32 or ord(c)==127 for c in name):raise ValueError('Unsafe payload path')
    return p
def plain(path):
    mode=path.lstat().st_mode
    if not stat.S_ISREG(mode) or path.stat().st_nlink!=1:raise ValueError('Only independent ordinary files are supported')
def usage(root):
    total=0
    for directory,dirs,files in os.walk(root,followlinks=False):
        for name in files:
            try:total+=(Path(directory)/name).lstat().st_size
            except FileNotFoundError:pass # Native Steam atomically rotates temporary files.
        for name in dirs:
            p=Path(directory)/name
            if p.is_symlink():total+=p.lstat().st_size
    return total
@contextlib.contextmanager
def locked(cache):
    cache.mkdir(parents=True,exist_ok=True)
    lock=cache/'.capacity.lock'
    if lock.is_symlink():raise ValueError('Unsafe capacity lock')
    with lock.open('a+b') as stream:
        fcntl.flock(stream,fcntl.LOCK_EX)
        yield
def atomic(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(prefix='.publish-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as out:out.write(data);out.flush();os.fsync(out.fileno())
        os.replace(temp,path)
    finally:
        if os.path.exists(temp):os.unlink(temp)
class StrictDict(dict):
    def __setitem__(self,key,value):
        if any(old.casefold()==key.casefold() for old in self):raise ValueError('Ambiguous duplicate VDF key')
        super().__setitem__(key,value)
def metadata(path,request,fresh_anonymous=False,shared=False):
    plain(path)
    if path.stat().st_size>4*1024**2:raise ValueError('Appmanifest too large')
    parsed=vdf.loads(path.read_text(),mapper=StrictDict,merge_duplicate_keys=False)
    if set(parsed)!= {'AppState'}:raise ValueError('Unexpected appmanifest root')
    state=parsed['AppState']
    allowed={'appid','Universe','name','StateFlags','installdir','LastUpdated','SizeOnDisk','buildid','LastOwner','UpdateResult','BytesToDownload','BytesDownloaded','BytesToStage','BytesStaged','TargetBuildID','AutoUpdateBehavior','AllowOtherDownloads','AllowOtherDownloadsWhileRunning','ScheduledAutoUpdate','InstalledDepots','UserConfig','MountedConfig','SharedDepots','StagingSize','FullValidateAfterNextUpdate','DownloadType','LastPlayed'}
    if set(state)-allowed:raise ValueError('Unreviewed appmanifest fields: '+','.join(sorted(set(state)-allowed)))
    owner=state.get('LastOwner','0' if shared else '')
    if (owner!='0' and not (fresh_anonymous and owner.isdecimal() and int(owner)<2**64)) or state.get('LastPlayed','0')!='0' or state.get('appid')!=str(request['appid']) or state.get('StateFlags')!=('68' if shared else '4') or state.get('UpdateResult','0')!='0':raise ValueError('Nonanonymous or incomplete native appmanifest')
    for section in ['UserConfig','MountedConfig']:
        value=state.get(section,{})
        if not isinstance(value,dict) or set(value)-{'language','betakey','mod'}:raise ValueError('Private/unreviewed native configuration')
        if value.get('betakey','public')!=request['branch']:raise ValueError('Unexpected Steam branch')
        if value.get('mod',request['mod'])!=request['mod']:raise ValueError('Unexpected app90 mod')
    depots=state.get('InstalledDepots')
    if not isinstance(depots,dict) or not depots:raise ValueError('Native installed depots are required')
    selected={}
    for depot,entry in depots.items():
        if not depot.isdecimal() or not isinstance(entry,dict) or set(entry)-{'manifest','size','dlcappid'} or not entry.get('manifest','').isdecimal():raise ValueError('Unsupported installed depot metadata')
        selected[depot]=entry['manifest']
    build=state.get('buildid','')
    if not build.isdecimal() or int(build)<=0:raise ValueError('Native Steam build is missing')
    key={**request,'buildid':build,'depots':dict(sorted(selected.items()))}
    # Reconstruct public-only native state. Account/client state is never copied.
    public={key:state[key] for key in ['appid','Universe','name','StateFlags','installdir','buildid','SizeOnDisk','InstalledDepots'] if key in state}
    public['LastOwner']='0';public['UpdateResult']='0'
    shared=state.get('SharedDepots',{})
    if not isinstance(shared,dict) or any(not k.isdecimal() or not isinstance(v,str) or not v.isdecimal() for k,v in shared.items()):raise ValueError('Unsupported shared depot selection')
    if shared:public['SharedDepots']=shared
    public['UserConfig']={key:value for key,value in state.get('UserConfig',{}).items() if key in ['language','betakey','mod']}
    return key,vdf.dumps({'AppState':public},pretty=True).encode()
def metadata_tree(path,request):
    if not isinstance(request.get('appid'),int) or isinstance(request['appid'],bool) or not 1<=request['appid']<2**31 or request.get('branch')!='public' or request.get('platform') not in ('linux','windows') or (request['appid']==90 and not re.fullmatch('[a-z0-9_]{1,32}',request.get('mod',''))) or (request['appid']!=90 and request.get('mod')!=''):raise ValueError('Only reviewed public anonymous application selections are supported')
    key,primary=metadata(path,request,True);acfs={path.name:primary};pending=[(key,primary)];shared_apps={};depots=dict(key['depots']);visited={str(request['appid'])}
    while pending:
        current,raw=pending.pop();state=vdf.loads(raw.decode())['AppState']
        for appid in sorted(set(state.get('SharedDepots',{}).values())):
            if appid in visited:continue
            if len(visited)>=64:raise ValueError('Shared depot dependency bound exceeded')
            visited.add(appid);dependency=path.parent/('appmanifest_'+appid+'.acf')
            selected,public=metadata(dependency,{**request,'appid':int(appid),'mod':''},True,True)
            shared_apps[appid]={'buildid':selected['buildid'],'depots':selected['depots']};acfs[dependency.name]=public;pending.append((selected,public))
            for depot,manifest in selected['depots'].items():
                if depot in depots and depots[depot]!=manifest:raise ValueError('Ambiguous shared depot manifest')
                depots[depot]=manifest
        for depot,appid in state.get('SharedDepots',{}).items():
            dependency=path.parent/('appmanifest_'+appid+'.acf')
            selected,_=metadata(dependency,{**request,'appid':int(appid),'mod':''},True,True)
            if depot not in selected['depots']:raise ValueError('Missing referenced shared depot manifest')
    key['depots']=dict(sorted(depots.items()));key['shared_apps']=dict(sorted(shared_apps.items()));return key,acfs
def inventory(root):
    files={};seen=set();excluded=[]
    for directory,dirs,names in os.walk(root,followlinks=False):
        for name in dirs+names:
            path=Path(directory)/name;relative=str(path.relative_to(root));safe(relative)
            mode=path.lstat().st_mode
            if stat.S_ISLNK(mode) or not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):raise ValueError('Linked/special publisher payload unsupported')
            folded=relative.casefold()
            if folded in seen:raise ValueError('Case-conflicting publisher paths unsupported')
            seen.add(folded)
        for name in names:
            path=Path(directory)/name;relative=str(path.relative_to(root));parts=PurePosixPath(relative).parts
            if parts[0].lower()=='steamapps' or any(p.lower() in {'.steam','.voltra','userdata','logs','log','crashdumps'} for p in parts) or name.lower().endswith(('.log','.mdmp','.dmp')):
                excluded.append(relative);continue
            plain(path);s=path.stat();files[relative]={'sha256':digest(path),'bytes':s.st_size,'mode':stat.S_IMODE(s.st_mode)&0o777}
    if not files:raise ValueError('No cacheable pristine payload')
    return dict(sorted(files.items())),excluded
def verify(object_dir,identity=None):
    if object_dir.is_symlink() or {p.name for p in object_dir.iterdir()}!={'manifest.json','appmanifest.acf','appmanifests','payload'}:raise ValueError('Unknown immutable object members')
    plain(object_dir/'manifest.json');raw=(object_dir/'manifest.json').read_bytes()
    if len(raw)>32*1024**2 or hashlib.sha256(raw).hexdigest()!=(identity or object_dir.name):raise ValueError('Immutable manifest identity mismatch')
    manifest=json.loads(raw);actual,excluded=inventory(object_dir/'payload')
    expected=manifest['files']
    # Immutable storage mode differs from the original writable deployment mode.
    if excluded or set(actual)!=set(expected) or any(actual[p]['sha256']!=f['sha256'] or actual[p]['bytes']!=f['bytes'] for p,f in expected.items()):raise ValueError('Immutable payload mismatch')
    plain(object_dir/'appmanifest.acf')
    if digest(object_dir/'appmanifest.acf')!=manifest['appmanifest_sha256']:raise ValueError('Public appmanifest mismatch')
    for name,expected in manifest['appmanifest_files'].items():
        if not re.fullmatch(r'appmanifest_[0-9]+\.acf',name):raise ValueError('Invalid public appmanifest name')
        plain(object_dir/'appmanifests'/name)
        if digest(object_dir/'appmanifests'/name)!=expected:raise ValueError('Shared public appmanifest mismatch')
    if {p.name for p in (object_dir/'appmanifests').iterdir()}!=set(manifest['appmanifest_files']):raise ValueError('Unexpected public appmanifest files')
    return manifest
def gc(cache,keep=None,age=7*86400):
    games=cache/'steam-games';keys=games/'keys';now=time.time();removed=[]
    if keys.exists():
        for index in keys.iterdir():
            if not HEX.fullmatch(index.name) or index.is_symlink():raise ValueError('Unsafe cache key index')
            if now-index.stat().st_mtime>age:index.unlink()
    referenced={json.loads(p.read_text())['object'] for p in keys.iterdir()} if keys.exists() else set()
    objects=games/'objects'
    if objects.exists():
        for obj in objects.iterdir():
            if not HEX.fullmatch(obj.name) or obj.is_symlink():raise ValueError('Unsafe cache object')
            if obj.name in referenced or obj.name==keep:continue
            for directory,dirs,files in os.walk(obj):os.chmod(directory,0o700)
            shutil.rmtree(obj);removed.append(obj.name)
    return removed
def publish(cache,request_id):
    if not re.fullmatch(r'[a-f0-9-]{36}',request_id):raise ValueError('Invalid acquisition identity')
    work=cache/'steam-games/work'/request_id;proof=json.loads((work/'proof.json').read_text())
    if proof.get('pristine') is not True or proof.get('anonymous') is not True or proof.get('game_booted') is not False or proof.get('exit_code')!=0:raise ValueError('Fresh native pristine proof required')
    safe(proof['appmanifest']);key,acfs=metadata_tree(work/proof['appmanifest'],proof['request']);acf=acfs[Path(proof['appmanifest']).name];files,excluded=inventory(work/'payload')
    manifest={'schema':1,'key':key,'files':files,'excluded':excluded,'appmanifest_sha256':hashlib.sha256(acf).hexdigest(),'appmanifest_files':{name:hashlib.sha256(raw).hexdigest() for name,raw in acfs.items()},'provenance':proof,'publisher_verification':'Native SteamCMD app_info refresh and app_update validate; no independent binary depot cryptography'}
    raw=canonical(manifest);identity=hashlib.sha256(raw).hexdigest();games=cache/'steam-games';target=games/'objects'/identity
    projected=sum(file['bytes'] for file in files.values())+len(raw)+len(acf)+sum(len(content) for content in acfs.values())+4096
    gc(cache,keep=identity)
    if usage(cache)+projected>CAPACITY:raise ValueError('Total shared cache capacity exhausted; normal uncached download remains available')
    stage=games/'.staging'/request_id
    if stage.exists():raise ValueError('Incomplete publication exists; operator inspection required')
    (stage/'payload').mkdir(parents=True)
    try:
        for name,meta in files.items():
            destination=stage/'payload'/name;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(work/'payload'/name,destination)
            if digest(destination)!=meta['sha256']:raise ValueError('Pristine source changed during publication')
            destination.chmod(0o555 if meta['mode']&0o111 else 0o444)
        (stage/'manifest.json').write_bytes(raw);(stage/'appmanifest.acf').write_bytes(acf)
        (stage/'appmanifests').mkdir()
        for name,content in acfs.items():(stage/'appmanifests'/name).write_bytes(content)
        target.parent.mkdir(parents=True,exist_ok=True)
        if target.exists():raise ValueError('Object already exists; inspect existing publication')
        verify(stage,identity);os.rename(stage,target)
        for directory,dirs,names in os.walk(target):
            for name in names:os.chmod(Path(directory)/name,0o555 if name in files and files[name]['mode']&0o111 else 0o444)
            os.chmod(directory,0o555)
        atomic(games/'keys'/hashlib.sha256(canonical(key)).hexdigest(),canonical({'key':key,'object':identity}))
        return {'object':identity,'key':key,'files':len(files),'payload_bytes':sum(f['bytes'] for f in files.values()),'shared_cache_bytes':usage(cache)}
    except BaseException:
        if stage.exists():shutil.rmtree(stage)
        raise
def seed(cache,identity,destination,uid=None,gid=None):
    if not HEX.fullmatch(identity):raise ValueError('Invalid immutable object identity')
    if destination.is_symlink() or not destination.is_dir() or any(destination.iterdir()):raise ValueError('Seed only a stopped empty independent volume')
    source=cache/'steam-games/objects'/identity;manifest=verify(source)
    if usage(cache)+sum(f['bytes'] for f in manifest['files'].values())>CAPACITY:raise ValueError('Shared cache capacity leaves insufficient staging headroom')
    stage=destination/'.steam-game-cache-stage';stage.mkdir();committed=[]
    try:
        for name,meta in manifest['files'].items():
            safe(name);target=stage/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source/'payload'/name,target);target.chmod(meta['mode'])
            if uid is not None:os.chown(target,uid,gid)
            if digest(target)!=meta['sha256'] or target.stat().st_ino==(source/'payload'/name).stat().st_ino:raise ValueError('Private copy is not independent/identical')
        # Never deploy cached Steam client/application ownership state. Native
        # Steam reconstructs appmanifests while validating these existing files.
        if uid is not None:
            for directory,dirs,files in os.walk(stage):os.chown(directory,uid,gid)
        for item in stage.iterdir():
            target=destination/item.name
            if target.exists() or target.is_symlink():raise ValueError('Volume changed during private staging')
            item.rename(target);committed.append(target)
        stage.rmdir()
    except BaseException:
        for item in committed:
            if item.is_dir():shutil.rmtree(item)
            else:item.unlink()
        if stage.exists():shutil.rmtree(stage)
        raise
    return {'object':identity,'key':manifest['key'],'files':len(manifest['files']),'warm_game_payload':True,'steam_appstate_deployed':False,'publisher_update_validate_required':True}
def main():
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['init','publish','verify','gc','seed','compare','clean-work']);parser.add_argument('--cache',type=Path,required=True);parser.add_argument('--id');parser.add_argument('--destination',type=Path);parser.add_argument('--uid',type=int);parser.add_argument('--gid',type=int);parser.add_argument('--empty-payload',action='store_true');args=parser.parse_args()
    with locked(args.cache):
        if args.command=='init':
            if not re.fullmatch(r'[a-f0-9-]{36}',args.id or ''):raise ValueError('Invalid utility identity')
            work=args.cache/'steam-games/work'/args.id;work.mkdir(parents=True,mode=0o700);result={'work':str(work)}
            if args.empty_payload:(work/'payload').mkdir()
        elif args.command=='publish':result=publish(args.cache,args.id)
        elif args.command=='verify':result={'key':verify(args.cache/'steam-games/objects'/args.id)['key'],'valid':True}
        elif args.command=='gc':result={'removed_own_unreferenced_objects':gc(args.cache),'total_shared_bytes':usage(args.cache)}
        elif args.command=='compare':
            expected=verify(args.cache/'steam-games/objects'/args.id)['files'];actual,_=inventory(args.destination)
            result={'missing':sorted(set(expected)-set(actual)),'added':sorted(set(actual)-set(expected)),'changed':sorted(name for name in actual.keys()&expected.keys() if actual[name]['sha256']!=expected[name]['sha256'])}
        elif args.command=='clean-work':
            if not re.fullmatch(r'[a-f0-9-]{36}',args.id or ''):raise ValueError('Invalid private utility identity')
            work=args.cache/'steam-games/work'/args.id
            if work.is_symlink() or work.resolve().parent!=(args.cache/'steam-games/work').resolve():raise ValueError('Unsafe private utility cleanup')
            if work.exists():shutil.rmtree(work)
            result={'owned_work_removed':args.id,'total_shared_bytes':usage(args.cache)}
        else:result=seed(args.cache,args.id,args.destination,args.uid,args.gid)
        print(json.dumps(result))
if __name__=='__main__':main()
