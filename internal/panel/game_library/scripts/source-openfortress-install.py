#!/usr/bin/env python3
"""MIT. Reviewed Open Fortress alpha with the publisher's compatible SDK branch."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
import shutil
from source_install import update
from source_next_install import download, apply_payload

RELEASE={'url':'https://beans.adastral.net/open_fortress.7z','bytes':2617348367,
         'sha256':'4ac3451e099e8057af5e5ebe765c3b90fb5e6afdaeedaeb9d7a0ea47eb609b1e'}


def provision_tool(root,source=Path('/usr/lib/p7zip'),copyright=Path('/usr/share/doc/p7zip-full/copyright')):
    root=Path(root).resolve();target=root/'.voltra/7zip'
    if not target.resolve().is_relative_to(root):raise ValueError('Private archive tool escapes volume')
    expected={str(p.relative_to(source)):p.read_bytes() for p in source.rglob('*') if p.is_file()}
    expected['COPYRIGHT.p7zip-full']=copyright.read_bytes()
    if target.exists():
        actual={}
        for p in target.rglob('*'):
            if p.is_symlink() or not p.resolve().is_relative_to(root):raise ValueError('Unsafe private archive tool')
            if p.is_file():actual[str(p.relative_to(target))]=p.read_bytes()
        if actual!=expected:raise ValueError('Existing private archive tool differs; refusing to overwrite')
        return
    shutil.copytree(source,target)
    shutil.copy2(copyright,target/'COPYRIGHT.p7zip-full')


def listing(text):
    if len(text.encode())>16*1024**2 or '\n----------\n' not in text:raise ValueError('Invalid bounded Open Fortress archive listing')
    entries=[];seen=set();total=0
    for block in text.split('\n----------\n',1)[1].strip().split('\n\n'):
        fields={}
        for line in block.splitlines():
            if not line:continue
            if ' = ' not in line:raise ValueError('Invalid Open Fortress archive property')
            key,value=line.split(' = ',1)
            if key in fields:raise ValueError('Duplicate Open Fortress archive property')
            fields[key]=value
        name=fields.get('Path','');path=PurePosixPath(name);attributes=fields.get('Attributes','').split()
        if not name or len(name)>1024 or path.is_absolute() or '..' in path.parts or '\\' in name or path.parts[0]!='open_fortress' or name in seen:
            raise ValueError('Unsafe Open Fortress archive path')
        if fields.get('Encrypted')!='-' or any(key in fields for key in ('Symbolic Link','Hard Link')) or not attributes or attributes[-1][:1] not in ('d','-'):
            raise ValueError('Unsupported Open Fortress archive link or entry')
        size=int(fields.get('Size','-1'))
        if size<0:raise ValueError('Invalid Open Fortress member size')
        total+=size;seen.add(name);entries.append(name)
        if len(entries)>50000 or total>8*1024**3:raise ValueError('Open Fortress archive expansion exceeds limit')
    return entries


def unpack(archive,destination):
    # The only accepted 7z payload is the inspected official alpha identity.
    digest=hashlib.sha256()
    with archive.open('rb') as stream:
        for block in iter(lambda:stream.read(1048576),b''):digest.update(block)
    if digest.hexdigest()!=RELEASE['sha256']:raise ValueError('Open Fortress archive identity mismatch')
    root=next((p.parent for p in archive.parents if p.name=='.voltra'),None)
    executable=root/'.voltra/7zip/7z' if root else Path('/usr/bin/7z')
    if root and not executable.resolve().is_relative_to(root):raise ValueError('Private archive tool escapes volume')
    result=subprocess.run([str(executable),'l','-slt',str(archive)],check=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180)
    entries=listing(result.stdout.decode('utf-8','strict').replace('\r\n','\n'))
    subprocess.run([str(executable),'x','-y','-o'+str(destination),str(archive)],check=True,stdout=subprocess.DEVNULL,timeout=600)
    root=destination.resolve()
    for path in destination.rglob('*'):
        if path.is_symlink() or not path.resolve().is_relative_to(root) or not(path.is_file()or path.is_dir()):raise ValueError('Unexpected extracted Open Fortress entry')
    if not (destination/'open_fortress/bin/server.so').is_file():raise ValueError('Open Fortress native server payload missing')
    return entries


def mount_paths(gameinfo):
    content=gameinfo.read_text(encoding='utf-8-sig');lines=[];replaced=0
    for line in content.splitlines(keepends=True):
        if re.match(r'\s*game\s+"',line):
            if '|all_source_engine_paths|..\\Team Fortress 2\\' in line:
                line=line.replace('|all_source_engine_paths|..\\Team Fortress 2\\','|gameinfo_path|../tf2/');replaced+=1
            line=line.replace('\\','/')
        lines.append(line)
    if replaced!=8:raise ValueError('Reviewed Open Fortress TF2 mount layout changed')
    gameinfo.write_text(''.join(lines),encoding='utf-8')


def install(root,env,validate=True):
    root=Path(root).resolve();state=root/'.voltra/source-next'
    if not state.resolve().is_relative_to(root):raise ValueError('Open Fortress state escapes server volume')
    if env.get('SRCDS_APPID','244310')!='244310' or env.get('SRCDS_GAME','open_fortress')!='open_fortress':raise ValueError('Open Fortress requires its reviewed SDK application and game')
    branch=env.get('SRCDS_BETAID','previous2021')
    if branch!='previous2021':raise ValueError('Reviewed Open Fortress alpha requires the publisher previous2021 SDK branch')
    state.mkdir(parents=True,exist_ok=True);manifest=state/'openfortress.json'
    if not manifest.resolve().is_relative_to(root):raise ValueError('Open Fortress receipt escapes volume')
    old=json.loads(manifest.read_text()) if manifest.exists() else {}
    with tempfile.TemporaryDirectory(prefix='of-',dir=state) as temporary:
        stage=Path(temporary);archive=stage/'openfortress.7z';asset=download(RELEASE,archive,maximum=3*1024**3);ready=stage/'ready';ready.mkdir()
        unpack(archive,ready);mount_paths(ready/'open_fortress/gameinfo.txt')
        update(root,244310,env={**env,'SRCDS_BETAID':'previous2021'},validate=validate,required=('srcds_run',))
        tf2=root/'tf2'
        if not tf2.resolve().is_relative_to(root):raise ValueError('TF2 mount escapes server volume')
        tf2.mkdir(exist_ok=True)
        update(tf2,232250,env={**env,'SRCDS_APPID':'232250','SRCDS_BETAID':'public','SRCDS_BETAPASS':''},validate=validate,required=('tf/tf2_misc_dir.vpk',))
        files,preserved=apply_payload(root,'open_fortress',ready/'open_fortress',old)
        # This 2013 SDK exposes dedicated *_srv names; the alpha also requests
        # their unsuffixed aliases. Add only missing, confined relative links.
        for folder,pairs in [(root/'bin',[(name+'.so',name+'_srv.so') for name in ('datacache','dedicated','engine','materialsystem','replay','scenefilecache','shaderapiempty','soundemittersystem','studiorender','vphysics')]),(root/'open_fortress/bin',[('server_srv.so','server.so')])]:
            for destination,source in pairs:
                target=folder/destination;publisher=folder/source
                if not target.resolve().is_relative_to(root) or not publisher.resolve().is_relative_to(root):raise ValueError('Open Fortress native library path escapes volume')
                if not target.exists() and not target.is_symlink() and publisher.is_file():target.symlink_to(source)
        descriptor,name=tempfile.mkstemp(prefix='.of-receipt-',dir=state)
        try:
            with os.fdopen(descriptor,'w') as output:json.dump({'asset':asset,'sdk_branch':'previous2021','tf2_branch':'public','files':files,'preserved_operator_files':preserved,'source':'https://openfortress.fun/download/','identity_provenance':'Computed byte identity from the official linked alpha archive, not independent publisher checksum'},output,indent=2)
            os.chown(name,root.stat().st_uid,root.stat().st_gid);os.replace(name,manifest)
        finally:
            if os.path.exists(name):os.unlink(name)


if __name__=='__main__':install(Path.cwd(),dict(os.environ))
