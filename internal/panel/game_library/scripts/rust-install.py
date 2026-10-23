#!/usr/bin/env python3
"""MIT. Rust Steam update, confined optional wipe and framework overlays."""
import fnmatch
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import stat
import tarfile
import tempfile
import time
import urllib.request
import zipfile
from steam_template import update


def confined(root, relative):
    path = PurePosixPath(relative)
    if path.is_absolute() or '..' in path.parts or '\\' in relative or not path.parts:
        raise ValueError('Rust operation must stay inside this server volume')
    target = root.joinpath(*path.parts)
    if not target.resolve().is_relative_to(root):raise ValueError('Rust path follows a link outside this server volume')
    return target


WIPE_PROTECTED = frozenset(('.voltra', '.steam', 'steamapps'))


def mount_points():
    # Device numbers alone miss bind mounts of the same filesystem.
    table = Path('/proc/self/mountinfo')
    if not table.is_file():raise ValueError('Rust wipe requires Linux mount information')
    return {Path(re.sub(r'\\([0-7]{3})', lambda match:chr(int(match[1],8)), line.split()[4]))
            for line in table.read_text().splitlines() if len(line.split()) >= 5}


def volume_directory_fd(root,path,mounts):
    descriptor = os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    current = root;device = os.fstat(descriptor).st_dev
    try:
        for part in path.relative_to(root).parts:
            current /= part
            if current in mounts:raise ValueError('Wipe cannot cross a mounted filesystem')
            info = os.stat(part,dir_fd=descriptor,follow_symlinks=False)
            if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):raise ValueError('Wipe path contains a symbolic link or non-directory parent')
            if current in mounts or info.st_dev != device:raise ValueError('Wipe cannot cross a mounted filesystem')
            following = os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=descriptor)
            observed = os.fstat(following)
            if (observed.st_dev,observed.st_ino) != (info.st_dev,info.st_ino):
                os.close(following);raise ValueError('Wipe directory changed during validation')
            os.close(descriptor);descriptor = following
        return descriptor
    except BaseException:
        os.close(descriptor);raise


def wipe_children(root,path,mounts):
    descriptor = volume_directory_fd(root,path,mounts)
    try:
        with os.scandir(descriptor) as entries:return [path/entry.name for entry in entries]
    finally:os.close(descriptor)


def wipe_path(root, path, mounts):
    relative = path.relative_to(root)
    if not relative.parts or relative.parts[0] in WIPE_PROTECTED:
        raise ValueError('Wipe cannot target the server root, updater state or quarantine')
    if path in mounts:raise ValueError('Wipe cannot cross a mounted filesystem: '+str(relative))
    descriptor = volume_directory_fd(root,path.parent,mounts)
    try:info = os.stat(path.name,dir_fd=descriptor,follow_symlinks=False)
    finally:os.close(descriptor)
    if stat.S_ISLNK(info.st_mode):raise ValueError('Wipe rejects symbolic links instead of following them: '+str(relative))
    if path in mounts or info.st_dev != root.stat().st_dev:
        raise ValueError('Wipe cannot cross a mounted filesystem: '+str(relative))
    if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
        raise ValueError('Wipe supports ordinary files and directories, not devices or sockets')
    return info


def wipe_matches(root, parts, mounts):
    def expand(base, index):
        if index == len(parts):
            wipe_path(root, base, mounts);yield base;return
        if base != root:
            info = wipe_path(root, base, mounts)
            if not stat.S_ISDIR(info.st_mode):return
        component = parts[index]
        if component == '**':
            if base != root:yield from expand(base,index+1)
            elif index+1 < len(parts):yield from expand(base,index+1)
            for path in wipe_children(root,base,mounts):
                info = wipe_path(root,path,mounts)
                if stat.S_ISDIR(info.st_mode):yield from expand(path,index)
                elif index == len(parts)-1:yield path
        else:
            for path in wipe_children(root,base,mounts):
                if fnmatch.fnmatchcase(path.name,component):
                    wipe_path(root,path,mounts)
                    yield from expand(path,index+1)
    yield from expand(root,0)


def validate_wipe(root, env):
    if env.get('REGEN_SERVER', '0') != '1':return []
    root = root.resolve();mounts = mount_points();patterns = env.get('REMOVE_FILES', '').split()
    parsed = []
    for pattern in patterns:
        if any(ord(c)<32 or ord(c)==127 for c in pattern):raise ValueError('Wipe patterns cannot contain control characters')
        path = PurePosixPath(pattern)
        if path.is_absolute() or '..' in path.parts or '\\' in pattern or not path.parts or path.parts[0] in WIPE_PROTECTED:
            raise ValueError('Wipe patterns must target game saves or plugins inside this volume')
        parsed.append(path.parts)
    matches = set()
    for parts in parsed:matches.update(wipe_matches(root,parts,mounts))
    seed = root/'seed.txt'
    if env.get('WORLD_SEED','0') == '0' and (seed.exists() or seed.is_symlink()):
        wipe_path(root,seed,mounts);matches.add(seed)
    # An ancestor directory already contains its descendants. Rename it once,
    # even when redundant or overlapping patterns select children first.
    selected = []
    for path in sorted(matches,key=lambda p:(len(p.parts),str(p))):
        if not any(parent == path or parent in path.parents for parent in selected):selected.append(path)
    for path in selected:
        pending = [path]
        while pending:
            entry = pending.pop();info = wipe_path(root,entry,mounts)
            if stat.S_ISDIR(info.st_mode):
                pending.extend(wipe_children(root,entry,mounts))
    current = root
    for part in ('.voltra','rust','wipe-backups'):
        current /= part
        try:descriptor = volume_directory_fd(root,current,mounts)
        except FileNotFoundError:break
        else:os.close(descriptor)
    return selected


def private_wipe_directory(root, path):
    relative = path.relative_to(root);current = root;owner = root.stat();mounts = mount_points()
    for part in relative.parts:
        descriptor = volume_directory_fd(root,current,mounts);current /= part
        try:
            try:os.mkdir(part,mode=0o700,dir_fd=descriptor)
            except FileExistsError:pass
            else:os.chown(part,owner.st_uid,owner.st_gid,dir_fd=descriptor,follow_symlinks=False)
        finally:os.close(descriptor)
        descriptor = volume_directory_fd(root,current,mounts);os.close(descriptor)


def wipe_files(root, env):
    root = root.resolve();matches = validate_wipe(root,env)
    if not matches:return []
    # All data trees have been validated before creating a recovery transaction.
    base = root/'.voltra/rust/wipe-backups';private_wipe_directory(root,base)
    mounts = mount_points();base_fd = volume_directory_fd(root,base,mounts);owner = root.stat()
    name = 'wipe-'+secrets.token_hex(16)
    try:
        os.mkdir(name,mode=0o700,dir_fd=base_fd);os.chown(name,owner.st_uid,owner.st_gid,dir_fd=base_fd,follow_symlinks=False)
        destination_fd = os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=base_fd)
    finally:os.close(base_fd)
    destination = base/name
    records = []
    descriptors = []
    moved = []
    journal = {'version':1,'created_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'phase':'preparing','paths':[str(p.relative_to(root)) for p in matches],'moved':[]}
    def save_journal():
        temporary = '.journal-'+secrets.token_hex(16)
        descriptor = os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=destination_fd)
        try:
            with os.fdopen(descriptor,'w',encoding='utf-8') as stream:
                json.dump(journal,stream,indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
            os.chown(temporary,owner.st_uid,owner.st_gid,dir_fd=destination_fd,follow_symlinks=False)
            os.replace(temporary,'recovery.json',src_dir_fd=destination_fd,dst_dir_fd=destination_fd)
        finally:
            try:os.unlink(temporary,dir_fd=destination_fd)
            except FileNotFoundError:pass
    def directory_fd(path):
        descriptor = volume_directory_fd(root,path,mounts)
        descriptors.append(descriptor);return descriptor
    try:
        for path in matches:
            backup = destination/path.relative_to(root);private_wipe_directory(root,backup.parent)
            source_fd,target_fd = directory_fd(path.parent),directory_fd(backup.parent)
            info = os.stat(path.name,dir_fd=source_fd,follow_symlinks=False)
            records.append((path,backup,source_fd,target_fd,(info.st_dev,info.st_ino)))
        journal['phase']='moving';save_journal()
        for path,backup,source_fd,target_fd,identity in records:
            current = os.stat(path.name,dir_fd=source_fd,follow_symlinks=False)
            if (current.st_dev,current.st_ino) != identity or stat.S_ISLNK(current.st_mode):
                raise ValueError('Wipe target changed after validation; no replacement will be followed')
            os.rename(path.name,backup.name,src_dir_fd=source_fd,dst_dir_fd=target_fd)
            moved.append((path,backup,source_fd,target_fd,identity));journal['moved'].append(str(path.relative_to(root)));save_journal()
        journal['phase']='committed';save_journal()
    except BaseException as error:
        failures = []
        for path,backup,source_fd,target_fd,identity in reversed(moved):
            try:
                try:os.stat(path.name,dir_fd=source_fd,follow_symlinks=False)
                except FileNotFoundError:pass
                else:raise ValueError('Original path was recreated during quarantine')
                os.rename(backup.name,path.name,src_dir_fd=target_fd,dst_dir_fd=source_fd)
            except BaseException:failures.append(str(path.relative_to(root)))
        journal.update({'phase':'rollback_failed' if failures else 'rolled_back','rollback_failures':failures,'error_type':type(error).__name__})
        save_journal()
        if failures:raise RuntimeError('Quarantine rollback needs recovery from '+str(destination.relative_to(root))) from error
        raise
    finally:
        for descriptor in descriptors:os.close(descriptor)
        os.close(destination_fd)
    return [str(path.relative_to(root)) for path in matches]


def download(url, target, limit=512*1024*1024):
    request = urllib.request.Request(url, headers={'User-Agent':'Voltra-Rust-Setup/1'})
    digest = hashlib.sha256();total = 0
    with urllib.request.urlopen(request, timeout=120) as response, target.open('wb') as output:
        if not response.url.startswith('https://'):raise ValueError('Framework download requires HTTPS')
        while True:
            block = response.read(1024*1024)
            if not block:break
            total += len(block)
            if total > limit:raise ValueError('Rust framework archive exceeds size limit')
            digest.update(block);output.write(block)
    return digest.hexdigest()


def overlay(root, archive, framework):
    # Framework archives contain executable patches; retain operator plugins,
    # configuration and data on updates, and reject archive links/devices.
    protected = ('oxide/config/', 'oxide/data/', 'oxide/plugins/', 'carbon/configs/', 'carbon/data/', 'carbon/plugins/')
    with tempfile.TemporaryDirectory(prefix='framework-', dir=root/'.voltra/rust') as directory:
        stage = Path(directory)
        if zipfile.is_zipfile(archive):
            with zipfile.ZipFile(archive) as source:
                total = 0
                for info in source.infolist():
                    target = confined(stage, info.filename.rstrip('/'))
                    if info.is_dir():target.mkdir(parents=True, exist_ok=True);continue
                    if ((info.external_attr >> 16) & 0o170000) == 0o120000:raise ValueError('Framework archive contains symlink')
                    total += info.file_size
                    if total > 1024*1024*1024:raise ValueError('Framework expands beyond limit')
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with source.open(info) as inp, target.open('wb') as out:shutil.copyfileobj(inp, out)
                    target.chmod((info.external_attr >> 16) & 0o777 or 0o644)
        else:
            with tarfile.open(archive, 'r:*') as source:
                total = 0
                for info in source:
                    relative = info.name
                    while relative.startswith('./'):relative = relative[2:]
                    if not relative:continue
                    target = confined(stage, relative)
                    if info.isdir():target.mkdir(parents=True, exist_ok=True);continue
                    if not info.isfile():raise ValueError('Framework archive contains non-regular entry')
                    total += info.size
                    if total > 1024*1024*1024:raise ValueError('Framework expands beyond limit')
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with source.extractfile(info) as inp, target.open('wb') as out:shutil.copyfileobj(inp, out)
                    target.chmod(info.mode & 0o777)
        publications = []
        # Validate the complete plan before copying any publisher file into the
        # live game tree, even if a malicious entry appears last in the archive.
        for item in stage.rglob('*'):
            if not item.is_file():continue
            relative = item.relative_to(stage).as_posix()
            target = confined(root, relative)
            if target.exists() and relative.startswith(protected):continue
            if relative.startswith(('server/', '.voltra/', '.steam/', 'steamapps/')) or relative == 'seed.txt':
                raise ValueError('Framework archive unexpectedly contains operator data')
            publications.append((item, target, relative))
        backups = confined(root, '.voltra/rust/framework-backups/'+str(time.time_ns()))
        for item, target, relative in publications:
            if target.exists():
                if not target.is_file():raise ValueError('Framework destination is not a regular file')
                backup = backups/relative;backup.parent.mkdir(parents=True, exist_ok=True);shutil.copy2(target, backup)
        for item, target, relative in publications:
            target.parent.mkdir(parents=True, exist_ok=True)
            descriptor, temporary = tempfile.mkstemp(prefix='.voltra-framework-', dir=target.parent)
            os.close(descriptor)
            try:
                shutil.copy2(item, temporary);os.replace(temporary, target)
            finally:
                if os.path.exists(temporary):os.unlink(temporary)


def install(root, env, wipe=True):
    root = root.resolve()
    framework = env.get('FRAMEWORK', 'vanilla')
    if framework not in ('vanilla', 'oxide', 'carbon'):raise ValueError('Choose vanilla, oxide or carbon')
    # Validate all wipe paths before the Steam update mutates publisher files.
    if env.get('REGEN_SERVER', '0') not in ('0', '1'):raise ValueError('REGEN_SERVER must be 0 or 1')
    if wipe:validate_wipe(root, env)
    state = confined(root, '.voltra/rust');state.mkdir(parents=True, exist_ok=True)
    update(root, 258550, env=env, required=('RustDedicated',))
    receipt = {'framework':framework}
    if framework != 'vanilla':
        if framework == 'carbon':
            url = 'https://github.com/CarbonCommunity/Carbon/releases/download/production_build/Carbon.Linux.Release.tar.gz'
        else:
            request = urllib.request.Request('https://api.github.com/repos/OxideMod/Oxide.Rust/releases/latest', headers={'User-Agent':'Voltra-Rust-Setup/1'})
            with urllib.request.urlopen(request, timeout=45) as response:release = json.load(response)
            assets = [asset for asset in release['assets'] if asset['name'] == 'Oxide.Rust-linux.zip']
            if len(assets) != 1:raise ValueError('Publisher release has no unique Linux Oxide archive')
            url = assets[0]['browser_download_url']
        with tempfile.TemporaryDirectory(prefix='download-', dir=state) as directory:
            archive = Path(directory)/'framework.archive'
            receipt.update({'url':url, 'sha256':download(url, archive)})
            overlay(root, archive, framework)
    if wipe:receipt['wiped_files'] = wipe_files(root, env)
    metadata = confined(root, '.voltra/rust/framework.json')
    descriptor, temporary = tempfile.mkstemp(prefix='.framework-', dir=state)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:stream.write(json.dumps(receipt, indent=2)+'\n')
        owner = root.stat()
        os.chown(temporary, owner.st_uid, owner.st_gid)
        os.replace(temporary, metadata)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)
    return receipt


if __name__ == '__main__':install(Path.cwd(), dict(os.environ))
