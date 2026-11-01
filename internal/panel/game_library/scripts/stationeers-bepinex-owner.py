"""Variant-only preservation adapter. Does not claim loader/build compatibility."""
import os
from pathlib import Path
import shutil
import tempfile
import xml.etree.ElementTree as ET
from stationeers_wurm_starbound_install import stationeers_framework, install as shared_install, validate_tree
from valheim_vrising_install import confined
import stationeers_wurm_starbound_runtime as runtime

PROTECTED = ('setting.xml', 'modconfig.xml', 'saves', 'mods', 'BepInEx/config')

def settings_file(root):
    path = confined(root, 'setting.xml')
    if path.exists():
        data = path.read_bytes()
        if len(data) > 8 * 1024**2 or b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
            raise ValueError('Unsupported Stationeers settings XML')
        # Match the editor's document identity and ambiguity refusal. Parse only;
        # the shared settings editor owns scalar span edits, never this launcher.
        data.decode('utf-8-sig')
        tree = ET.fromstring(data)
        if tree.tag != 'SettingData':
            raise ValueError('Expected Stationeers SettingData')
        seen = set()
        for node in tree:
            key = node.tag.rsplit('}', 1)[-1].lower()
            if key in seen:
                raise ValueError('Duplicate Stationeers setting')
            seen.add(key)
        pending = [(tree, 1)]
        while pending:
            node, depth = pending.pop()
            if depth > 128:
                raise ValueError('Stationeers settings exceeds depth bound')
            pending.extend((child, depth + 1) for child in node)
    return path

def preflight(root, env):
    root = Path(root).resolve()
    if env.get('VOLTRA_STATIONEERS_VARIANT') != 'bepinex':
        raise ValueError('This adapter only accepts the BepInEx variant')
    for key, default, low, high in (('MAX_PLAYERS','10',1,30), ('SAVE_INTERVAL','300',1,2147483647), ('UPDATE_PORT','27014',1,65535)):
        value = env.get(key, default)
        if not isinstance(value, str) or not value.isascii() or not value.isdigit() or not low <= int(value) <= high:
            raise ValueError('Invalid ' + key)
    for key, default in (('AUTOSAVE','true'), ('UPNP','false'), ('VALIDATE','false')):
        if env.get(key, default) not in ('true','false'): raise ValueError('Invalid ' + key)
    for key, default, maximum in (('SAVE_NAME','stationeers_1',128), ('SERVER_NAME','Pterodactyl Hosted Server',100), ('SERVER_PASSWD','',128)):
        value = env.get(key, default)
        if not isinstance(value, str) or len(value) > maximum or any(ord(c)<32 or ord(c)==127 for c in value): raise ValueError('Invalid ' + key)
        if key == 'SAVE_NAME' and (not value or value in ('.','..') or any(c in value for c in '/\\:')): raise ValueError('Invalid save name')
    world = env.get('WORLD_NAME','moon')
    if world.lower() not in ('','moon','lunar','mars','mars2','europa','europa2','europa3','mimas','mimasherschel','vulcan','vulcan2','venus'):
        raise ValueError('Unsupported world fallback')
    stationeers_framework(root, env)
    settings_file(root)
    for name in PROTECTED:
        path = confined(root, name)
        if path.exists():
            if path.is_dir(): validate_tree(root, path)
            elif not path.is_file(): raise ValueError('Unsupported protected native file')
    return root

def preserve(root, operation):
    # Complete path validation precedes creation of private recovery material.
    paths = [confined(root, name) for name in PROTECTED]
    for path in paths:
        if path.exists() and path.is_dir(): validate_tree(root, path)
    state = confined(root, '.voltra/stationeers-bepinex')
    state.mkdir(parents=True, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix='preserve-', dir=state))
    saved = []
    for index, path in enumerate(paths):
        if path.exists():
            copy = backup / str(index)
            if path.is_dir(): shutil.copytree(path, copy)
            else: shutil.copy2(path, copy)
            saved.append((path, copy))
    try:
        return operation()
    finally:
        # Retain recovery material if restoration fails. Not crash-atomic.
        for path, copy in saved:
            confined(root, path.relative_to(root).as_posix())
            if path.is_dir():
                validate_tree(root, path)
                shutil.rmtree(path)
            elif path.exists(): path.unlink()
            path.parent.mkdir(parents=True, exist_ok=True)
            if copy.is_dir(): shutil.copytree(copy, path)
            else: shutil.copy2(copy, path)
        shutil.rmtree(backup)

def install(root, env=None):
    env = dict(os.environ if env is None else env)
    root = preflight(root, env)
    return preserve(root, lambda: shared_install(root, 'stationeers', env))

_configure = runtime.configure
def configure(root, kind, env):
    if kind != 'stationeers': raise ValueError('Unexpected native family')
    root = preflight(root, env)
    result = _configure(root, kind, env)
    argv, environment, stop, credentials, options = result
    if settings_file(root).exists():
        # Include file-owned passwords in the shared streaming redactor.
        tree = ET.fromstring(settings_file(root).read_bytes())
        credentials = [*credentials, *(node.text for node in tree if node.tag in ('ServerPassword', 'ServerAuthSecret') and node.text)]
        index = argv.index('-settings')
        pairs = list(zip(argv[index+1::2], argv[index+2::2]))
        # Native file owns ordinary settings after first boot; allocations stay managed.
        argv[index+1:] = [part for key, value in pairs if key in ('GamePort', 'UpdatePort', 'StartLocalHost') for part in (key, value)]
    return argv, environment, stop, credentials, options

def main():
    root = Path.cwd()
    if os.environ.get('VOLTRA_STEAM_AUTO_UPDATE', '0') == '1': install(root)
    os.environ['VOLTRA_STEAM_AUTO_UPDATE'] = '0'
    runtime.configure = configure
    return runtime.main()

if __name__ == '__main__':
    import sys
    if sys.argv[1:] == ['install']: install(Path.cwd())
    else: sys.exit(main())
