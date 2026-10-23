#!/usr/bin/env python3
"""MIT. Typed installation of the imported CS1.6 community module bundle."""
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import stat
import tempfile
import zipfile
from goldsrc_install import install as publisher_install
from native_release import download, sha256

MODULES = ('rehlds', 'reunion', 'amxmodx', 'metamod-r', 'reapi', 'ReGameDLL_CS')


def owned_parents(folder, root):
    missing = []
    current = folder
    while not current.exists():
        if not current.resolve().is_relative_to(root): raise ValueError('Module directory escapes volume')
        missing.append(current);current = current.parent
    owner = root.stat()
    for path in reversed(missing):
        path.mkdir();os.chown(path, owner.st_uid, owner.st_gid)


def selection(env, release):
    if env.get('HLDS_GAME', 'cstrike') != 'cstrike' or env.get('SRCDS_BETAID', '') != 'steam_legacy':
        raise ValueError('CS1.6 modules require cstrike and the publisher steam_legacy branch')
    version = env.get('VERSION', 'latest')
    if version not in ('latest', release['tag'], release['commit']):
        raise ValueError('VERSION must select latest or the reviewed immutable bundle commit')
    chosen = env.get('INSTALL_MODULES', ','.join(MODULES)).split(',')
    if chosen == ['']: return []
    if len(chosen) != len(set(chosen)) or any(name not in MODULES for name in chosen):
        raise ValueError('INSTALL_MODULES must contain unique supported module names')
    for module, dependencies in {'reunion': ('rehlds', 'metamod-r'), 'reapi': ('rehlds', 'amxmodx'), 'amxmodx': ('metamod-r',)}.items():
        if module in chosen and any(name not in chosen for name in dependencies):
            raise ValueError(module + ' requires ' + ','.join(dependencies))
    return [name for name in MODULES if name in chosen]


def mapped(module, name):
    parts = PurePosixPath(name).parts
    if module in ('rehlds', 'ReGameDLL_CS'):
        return '/'.join(parts[2:]) if parts[:2] == ('bin', 'linux32') and len(parts) > 2 else None
    if module == 'reunion':
        if name == 'reunion.cfg': return 'cstrike/reunion.cfg'
        if parts[:2] == ('bin', 'Linux') and len(parts) > 2:
            return 'cstrike/addons/metamod/reunion/' + '/'.join(parts[2:])
        return None
    return 'cstrike/' + name if parts and parts[0] == 'addons' else None


def extract(archive, module, ready):
    seen, selected, total = set(), [], 0
    with zipfile.ZipFile(archive) as source:
        for member in source.infolist():
            path = PurePosixPath(member.filename)
            kind = stat.S_IFMT(member.external_attr >> 16)
            if path.is_absolute() or '..' in path.parts or '\\' in member.filename or member.filename in seen or kind not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ValueError('Unsafe module archive path/link')
            seen.add(member.filename);total += member.file_size
            if len(seen) > 20000 or total > 256 * 1024**2:
                raise ValueError('Module archive expansion exceeds limit')
            name = mapped(module, member.filename)
            if not name or member.is_dir() or path.suffix.lower() in ('.dll', '.exe'): continue
            target = ready / name
            if target.exists(): raise ValueError('Duplicate module target')
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.open(member) as incoming, target.open('xb') as output: shutil.copyfileobj(incoming, output)
            target.chmod(0o755 if target.name in ('hlds_linux', 'hltv', 'hlds_run') else 0o644)
            selected.append(name)
    if not selected: raise ValueError('Selected module has no Linux files')
    return selected


def register(root, modules):
    game = root / 'cstrike';plugins = game / 'addons/metamod/plugins.ini'
    lines = []
    if 'amxmodx' in modules: lines.append('linux addons/amxmodx/dlls/amxmodx_mm_i386.so')
    if 'reunion' in modules: lines.append('linux addons/metamod/reunion/reunion_mm_i386.so')
    if lines:
        if plugins.is_symlink(): raise ValueError('Plugin registration must not be a symlink')
        owned_parents(plugins.parent, root)
        existed = plugins.exists()
        previous = plugins.read_text() if existed else ''
        with plugins.open('a') as output:
            for line in lines:
                if line not in previous.splitlines(): output.write('\n' + line + '\n')
        if not existed: os.chown(plugins, root.stat().st_uid, root.stat().st_gid)
    if 'metamod-r' in modules:
        liblist = game / 'liblist.gam'
        if liblist.is_symlink(): raise ValueError('liblist.gam must not be a symlink')
        original = liblist.read_text();content = original;line = 'gamedll_linux "addons/metamod/metamod_i386.so"'
        content = re.sub(r'^gamedll_linux\s+.*$', line, content, flags=re.M) if re.search(r'^gamedll_linux\s+', content, re.M) else content + '\n' + line + '\n'
        if content != original: liblist.write_text(content)


def install(root, env, validate=True):
    root = root.resolve();owner = root.stat()
    release = json.loads((root / '.voltra/cs16-modules-release.json').read_text(encoding='utf-8-sig'))
    modules = selection(env, release)
    had_reunion_config = (root / 'cstrike/reunion.cfg').exists()
    records = {item['module']: item for item in release['modules']}
    # Validate/download/extract before mutating publisher files.
    with tempfile.TemporaryDirectory(prefix='.cs16-modules-', dir=root / '.voltra') as temporary:
        stage = Path(temporary);ready = stage / 'ready';ready.mkdir();files = {}
        for module in modules:
            archive = stage / (module + '.zip');download(records[module], archive)
            for name in extract(archive, module, ready): files[name] = module
        publisher_install(root, {**env, 'VOLTRA_GOLDSRC_RECIPE': 'generic'}, validate)
        for name in files:
            target = root / name
            if not target.resolve().is_relative_to(root) or target.is_symlink(): raise ValueError('Module target escapes volume')
            # Existing operator addons/configurations retain contents and metadata.
            if target.exists() and ('/addons/' in '/' + name or target.suffix.lower() in ('.cfg', '.ini') or target.name == 'liblist.gam'): continue
            owned_parents(target.parent, root)
            os.chown(ready / name, owner.st_uid, owner.st_gid);os.replace(ready / name, target)
        reunion = root / 'cstrike/reunion.cfg'
        marker = root / '.voltra/cs16-modules.json'
        if 'reunion' in modules and not had_reunion_config:
            content = reunion.read_text();content = re.sub(r'^SteamIdHashSalt\s*=.*$', 'SteamIdHashSalt = ' + secrets.token_hex(25), content, flags=re.M);reunion.write_text(content)
        register(root, modules)
        data = root / 'cstrike/addons/amxmodx/data'
        if 'amxmodx' in modules:
            owned_parents(data, root)
            if not (data / 'csstats.dat').exists():
                (data / 'csstats.dat').touch();os.chown(data / 'csstats.dat',owner.st_uid,owner.st_gid)
        record = {'commit':release['commit'], 'modules':modules, 'files':{name:sha256(root/name) for name in files}, 'source':release['repository']}
        marker.write_text(json.dumps(record, indent=2)+'\n');os.chown(marker,owner.st_uid,owner.st_gid)
    print('Reviewed CS1.6 modules applied: ' + ','.join(modules), flush=True)


if __name__ == '__main__': install(Path.cwd(), os.environ)
