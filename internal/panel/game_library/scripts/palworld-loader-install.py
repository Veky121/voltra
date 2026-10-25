#!/usr/bin/env python3
"""MIT. Reviewed Palworld UE4SS files only. No runtime acquisition or gate change."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path,PurePosixPath
import re
import secrets
import stat
import struct
import sys
import zipfile


def helper():
    path=Path(__file__).with_name('steam_template.py')
    if not path.exists():path=path.with_name('steam-template.py')
    spec=importlib.util.spec_from_file_location('palworld_loader_publication',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


publication=helper()
PINS_PATH=Path(__file__).with_name('palworld-loader-pins.json')
BASE='Pal/Binaries/Win64/'
STATE='.voltra/palworld-loader/'
RECEIPT=STATE+'receipt.json'
JOURNAL=STATE+'journal.json'
PROXIES={'winmm.dll','xinput1_3.dll','version.dll','dsound.dll','dinput8.dll','dxgi.dll'}


def digest(data):return hashlib.sha256(data).hexdigest()


def pins():
    data=PINS_PATH.read_bytes();record=json.loads(data)
    if record.get('schema')!=1:raise ValueError('Unsupported Palworld loader manifest')
    return record,digest(data)


def relative(name):
    if not isinstance(name,str) or not name or any(c in name for c in '\\:<>"|?*') or any(ord(c)<32 for c in name) or name.startswith('/'):
        raise ValueError('Invalid Palworld loader path')
    path=PurePosixPath(name)
    if name not in (str(path),str(path)+'/') or any(part in ('.','..') for part in name.rstrip('/').split('/')):
        raise ValueError('Palworld loader path traversal/alias')
    for part in path.parts:
        if part.endswith((' ','.')) or re.fullmatch(r'(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?',part,re.I):
            raise ValueError('Reserved Windows loader path')
    return path


def location(root,name):
    relative(name)
    path=root/name
    for node in (path,*path.parents):
        if node==root:break
        if node.is_symlink():raise ValueError('Palworld loader refuses symbolic paths: '+name)
    if not path.resolve().is_relative_to(root):raise ValueError('Palworld loader path leaves the volume')
    return path


def read(root,name):
    location(root,name)
    with publication._publication_parent(root,name) as (parent,leaf,_):
        if parent is None:return None
        metadata=publication._publication_leaf(parent,leaf)
        if metadata is None:return None
        descriptor=os.open(leaf,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent)
        with os.fdopen(descriptor,'rb') as stream:
            current=os.fstat(stream.fileno())
            if (current.st_dev,current.st_ino)!=(metadata.st_dev,metadata.st_ino):raise ValueError('Loader file changed during preflight')
            if metadata.st_size>64*1024**2:raise ValueError('Unexpected loader state file size')
            data=stream.read(64*1024**2+1)
        return data,metadata


def pe64(data):
    if len(data)<64 or data[:2]!=b'MZ':raise ValueError('Loader core must be an actual Windows PE library')
    offset=struct.unpack_from('<I',data,60)[0]
    if offset+24>len(data) or data[offset:offset+4]!=b'PE\0\0' or struct.unpack_from('<H',data,offset+4)[0]!=0x8664:
        raise ValueError('Loader core must target AMD64')


def archive_files(archive,manifest):
    archive=Path(archive)
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size!=manifest['archive']['bytes']:
        raise ValueError('Reviewed Palworld loader archive size/type mismatch')
    raw=archive.read_bytes()
    if digest(raw)!=manifest['archive']['sha256']:raise ValueError('Reviewed Palworld loader archive SHA256 mismatch')
    approved={row['path']:row for row in manifest['files']};seen=set();payloads={};total=0
    with zipfile.ZipFile(archive) as source:
        if len(source.infolist())>512:raise ValueError('Too many loader archive members')
        for entry in source.infolist():
            path=relative(entry.filename);key=str(path).casefold()
            if key in seen:raise ValueError('Duplicate/case-colliding loader archive member')
            seen.add(key)
            mode=entry.external_attr>>16
            if entry.flag_bits&1 or stat.S_IFMT(mode) not in (0,stat.S_IFREG,stat.S_IFDIR):raise ValueError('Encrypted/link/nonregular loader archive member')
            if entry.is_dir():
                if not any(name.startswith(str(path)+'/') for name in approved):raise ValueError('Unexpected loader archive directory')
                continue
            name=str(path);row=approved.get(name);total+=entry.file_size
            if row is None or entry.file_size!=row['bytes'] or entry.file_size>32*1024**2 or total>64*1024**2:
                raise ValueError('Unexpected or oversized loader archive member')
            data=source.read(entry)
            if digest(data)!=row['sha256']:raise ValueError('Loader member checksum mismatch')
            if name.lower().endswith('.dll'):pe64(data)
            payloads[name]=data
    if set(payloads)!=set(approved):raise ValueError('Incomplete reviewed Palworld loader archive')
    return payloads


def inventory(root):
    """Read-only conflict detection, before journal/directory/publication writes."""
    executable=location(root,BASE.rstrip('/'))
    if executable.exists():
        names={}
        for path in executable.iterdir():
            folded=path.name.casefold()
            if folded in names:raise ValueError('Case-colliding Windows native files: '+path.name)
            names[folded]=path
            if folded in PROXIES or folded in ('ue4ss.dll','ue4ss-settings.ini','ue4ss_signatures'):
                raise ValueError('Legacy/competing loader requires explicit operator migration before install: '+str(path.relative_to(root)))
            if folded=='ue4ss' and path.name!='ue4ss':raise ValueError('Ambiguous UE4SS directory case')
            if folded=='dwmapi.dll' and path.name!='dwmapi.dll':raise ValueError('Ambiguous active proxy case')
    for folder in ('Mods/ManagedMods','Pal/Mods/ManagedMods','Pal/Binaries/Win64/Mods/ManagedMods'):
        path=location(root,folder)
        if path.exists() and any('ue4ss' in p.name.casefold() for p in path.rglob('*')):
            raise ValueError('Workshop-managed UE4SS conflicts with manual loader: '+folder)
    if os.environ.get('UE4SS_MODS_PATHS'):
        raise ValueError('Clear inherited UE4SS_MODS_PATHS; loader mod roots must be volume-confined and preflighted')
    folders=[BASE+'Mods',BASE+'ue4ss/Mods'];orders=[folder+'/mods.txt' for folder in folders]
    settings=read(root,BASE+'ue4ss/UE4SS-settings.ini')
    if settings:
        section=''
        for line in settings[0].decode('utf-8-sig').splitlines():
            header=re.match(r'^\s*\[([^\]]+)\]',line)
            if header:section=header[1].casefold();continue
            match=re.match(r'^\s*([+\-]?[A-Za-z]+)\s*=\s*(.*?)\s*$',line)
            if section!='overrides' or not match or not match[2] or match[1].startswith('-'):continue
            key=match[1].lstrip('+').casefold()
            if key not in ('modsfolderpath','modsfolderpaths','controllingmodstxt'):continue
            value=match[2].strip('"').replace('\\','/')
            if value.startswith('/') or ':' in value:raise ValueError('Use a volume-relative reviewed UE4SS mod/order path')
            cursor=root/(BASE+'ue4ss')
            for component in value.split('/'):
                if component in ('','.'):continue
                cursor=cursor.parent if component=='..' else cursor/component
                if not cursor.is_relative_to(root) or cursor.is_symlink():raise ValueError('UE4SS mod/order override escapes or uses a symbolic path')
            name=str(cursor.relative_to(root));location(root,name)
            if key!='controllingmodstxt':folders.append(name);orders.append(name+'/mods.txt')
            else:read(root,name);orders.append(name)
    for folder in dict.fromkeys(folders):
        path=location(root,folder)
        if not path.exists():continue
        if folder==BASE+'Mods' and any(path.iterdir()):
            raise ValueError('Legacy root Mods require explicit reviewed relocation; files are preserved: '+folder)
        for child in path.rglob('*'):
            location(root,str(child.relative_to(root)))
            if child.suffix.casefold()=='.dll':raise ValueError('Existing DLL mod needs matching modern UE4SS ABI review before writes: '+str(child.relative_to(root)))
    for name in orders:location(root,name)
    return {'mod_roots':list(dict.fromkeys(folders)),'order_files':list(dict.fromkeys(orders))}


def preflight(root,manifest,manifest_hash):
    if root.absolute()!=root.resolve() or root.is_symlink():raise ValueError('Use the actual server volume without aliases')
    inventory(root)
    # Inspect every state/target parent even when its leaf is absent.
    for name in (RECEIPT,JOURNAL,*[BASE+row['path'] for row in manifest['files']]):
        read(root,name)
    try:publication._publication_check(root)
    except OSError:raise ValueError('Unsafe existing Steam publication state; no loader writes permitted') from None
    journal=read(root,JOURNAL)
    if journal and json.loads(journal[0]).get('state') not in ('committed','rolled_back'):
        raise ValueError('Interrupted loader transaction requires recovery; no native launch or writes permitted')
    previous=read(root,RECEIPT)
    receipt=json.loads(previous[0]) if previous else None
    if receipt:
        if receipt.get('schema')!=1 or receipt.get('manifest_sha256')!=manifest_hash or not isinstance(receipt.get('managed'),dict):
            raise ValueError('Unknown loader receipt/revision; explicit reviewed update required')
        expected={BASE+row['path']:row['sha256'] for row in manifest['files'] if row['kind']=='core'}
        if receipt['managed']!=expected:raise ValueError('Incomplete/altered loader ownership receipt')
        for name,wanted in expected.items():
            existing=read(root,name)
            if not existing or digest(existing[0])!=wanted:raise ValueError('Owned loader core changed/missing; retain it for operator review: '+name)
    else:
        for row in manifest['files']:
            if row['kind']=='core' and read(root,BASE+row['path']):raise ValueError('Unreceipted active loader core; refusing adoption: '+BASE+row['path'])
    return receipt


def publish(root,name,data,mode=0o644):
    publication._publish(root,name,lambda output:output.write(data),mode)
    if name.startswith(STATE):metadata(root,name,None,private=True)


def metadata(root,name,original,private=False):
    with publication._publication_parent(root,name) as (parent,leaf,_):
        descriptor=os.open(leaf,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent)
        try:
            if original:
                if os.geteuid()==0:os.fchown(descriptor,original.st_uid,original.st_gid)
                os.fchmod(descriptor,stat.S_IMODE(original.st_mode))
                os.utime(descriptor,ns=(original.st_atime_ns,original.st_mtime_ns))
            elif private:os.fchmod(descriptor,0o600)
        finally:os.close(descriptor)


def remove_owned(root,name,wanted):
    with publication._publication_parent(root,name) as (parent,leaf,_):
        if parent is None:return
        original=publication._publication_leaf(parent,leaf)
        if original is None:raise ValueError('Rollback loader leaf disappeared')
        descriptor=os.open(leaf,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent)
        with os.fdopen(descriptor,'rb') as stream:
            opened=os.fstat(stream.fileno());data=stream.read(64*1024**2+1)
        if digest(data)!=wanted or (opened.st_dev,opened.st_ino)!=(original.st_dev,original.st_ino):raise ValueError('Rollback refuses an externally changed loader leaf: '+name)
        latest=publication._publication_leaf(parent,leaf)
        if latest is None or (latest.st_dev,latest.st_ino)!=(opened.st_dev,opened.st_ino):raise ValueError('Rollback target changed')
        with publication._publication_parent(root,name) as (current,_,_):
            if current is None or (os.fstat(current).st_dev,os.fstat(current).st_ino)!=(os.fstat(parent).st_dev,os.fstat(parent).st_ino):raise ValueError('Rollback parent changed')
        os.unlink(leaf,dir_fd=parent);os.fsync(parent)


def install(root,archive):
    root=Path(root).absolute();manifest,manifest_hash=pins()
    previous=preflight(root,manifest,manifest_hash)
    payloads=archive_files(archive,manifest)
    writes={}
    for row in manifest['files']:
        name=BASE+row['path'];existing=read(root,name)
        if existing:continue # Settings, scripts, mods.txt and core stay exact on reinstall.
        writes[name]=(payloads[row['path']],0o600 if row['kind']=='seed' else 0o644)
    if previous and not writes:return previous
    transaction=secrets.token_hex(16);backup_base=STATE+'backups/'+transaction+'/'
    receipt={'schema':1,'manifest_sha256':manifest_hash,'revision':manifest['revision'],
             'archive':manifest['archive'],'source':manifest['source'],'transaction':transaction,
             'managed':{BASE+row['path']:row['sha256'] for row in manifest['files'] if row['kind']=='core'},
             'seeded':sorted(set((previous or {}).get('seeded',[]))|{name for name in writes if name not in {BASE+row['path'] for row in manifest['files'] if row['kind']=='core'}}),
             'native_verified':False,'dll_override':'dwmapi=n,b'}
    writes[RECEIPT]=((json.dumps(receipt,sort_keys=True)+'\n').encode(),0o600)
    before={name:read(root,name) for name in writes}
    journal={'schema':1,'transaction':transaction,'state':'prepared','files':{}}
    for index,(name,old) in enumerate(before.items()):
        row={'proposed_sha256':digest(writes[name][0]),'absent':old is None}
        if old:
            data,info=old;backup=backup_base+str(index);publish(root,backup,data,0o600)
            row.update(backup=backup,sha256=digest(data),mode=stat.S_IMODE(info.st_mode),uid=info.st_uid,gid=info.st_gid,atime_ns=info.st_atime_ns,mtime_ns=info.st_mtime_ns)
        journal['files'][name]=row
    publish(root,JOURNAL,(json.dumps(journal,sort_keys=True)+'\n').encode(),0o600)
    published=[]
    try:
        for name,(data,mode) in writes.items():
            # Recheck full inventory on each leaf and refuse target races.
            inventory(root)
            current=read(root,name);old=before[name]
            if (current is None)!=(old is None) or current and digest(current[0])!=digest(old[0]):raise ValueError('Loader publication target changed concurrently')
            published.append(name);publish(root,name,data,mode)
            if name==RECEIPT:metadata(root,name,None,private=True)
        journal['state']='committed';publish(root,JOURNAL,(json.dumps(journal,sort_keys=True)+'\n').encode(),0o600)
        return receipt
    except BaseException:
        try:
            for name in reversed(published):
                current=read(root,name)
                old=before[name]
                if current is None and old is None:continue
                if old and current and digest(current[0])==digest(old[0]):continue
                if not current or digest(current[0])!=digest(writes[name][0]):raise ValueError('Rollback conflict; preserve interrupted transaction for recovery')
                if old is None:remove_owned(root,name,digest(writes[name][0]))
                else:publish(root,name,old[0]);metadata(root,name,old[1])
            journal['state']='rolled_back';publish(root,JOURNAL,(json.dumps(journal,sort_keys=True)+'\n').encode(),0o600)
        except BaseException:
            raise ValueError('Loader transaction interrupted; private journal/backups retained, native launch forbidden') from None
        raise


def verify(root):
    root=Path(root).absolute();manifest,manifest_hash=pins();receipt=preflight(root,manifest,manifest_hash)
    if not receipt:raise ValueError('Reviewed UE4SS loader is not installed; refusing vanilla fallback')
    return {'revision':receipt['revision'],'dll_override':'dwmapi=n,b','native_verified':False,
            'runtime_prerequisites':['MSVCP140','MSVCP140_ATOMIC_WAIT','MSVCP140_CODECVT_IDS','VCRUNTIME140','VCRUNTIME140_1','UCRT','reviewed private Proton']}


if __name__=='__main__':
    try:
        if len(sys.argv)==3 and sys.argv[1]=='install':result=install(Path.cwd(),Path(sys.argv[2]))
        elif sys.argv[1:]==['verify']:result=verify(Path.cwd())
        else:raise ValueError('Usage: palworld-loader-install.py install LOCAL_ARCHIVE | verify (no URLs/credentials)')
        print(json.dumps({'revision':result['revision'],'native_verified':False}))
    except Exception as error:
        print(str(error) if isinstance(error,ValueError) else 'Palworld loader operation failed: '+type(error).__name__,file=sys.stderr);sys.exit(1)
