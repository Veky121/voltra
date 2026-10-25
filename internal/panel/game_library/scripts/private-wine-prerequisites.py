#!/usr/bin/env python3
"""MIT. Shared typed prerequisites for a private server Wine prefix.

No global Wine installation, raw shell verbs or implicit Microsoft license acceptance.
"""
import importlib.util,json,os,subprocess,sys,tempfile
from pathlib import Path

def helper(name):
    path=Path(__file__).with_name(name+'.py')
    if not path.exists():path=path.with_name(name.replace('-','_')+'.py')
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules[name.replace('-','_')]=module;spec.loader.exec_module(module);return module

shared=sys.modules.get('steam_native_next') or helper('steam-native-next')
native,release=shared.native,shared.release

def prepare(root, env, default_verbs, pins, allowed_verbs):
    supplied = env.get('WINEPREFIX', str(root / '.wine'))
    prefix = shared.confined(root, Path(supplied))
    if not prefix.is_absolute():
        raise ValueError('Wine prefix must be an absolute private path')
    if env.get('WINEARCH', 'win64') != 'win64':
        raise ValueError('Private Wine runtime requires win64')
    registry = shared.confined(root, prefix / 'system.reg')
    if registry.exists() and '#arch=win32' in registry.read_text(errors='replace')[:1024]:
        raise ValueError('Existing win32 prefix preserved, requires win64')
    original = env.get('VOLTRA_WINETRICKS_RUN', env.get('WINETRICKS_RUN', default_verbs))
    verbs = original.split()
    if not verbs or len(verbs) != len(set(verbs)) or any(v not in allowed_verbs for v in verbs):
        raise ValueError('Unsupported Wine prerequisite; no shell fragments accepted')
    if env.get('ACCEPT_WINDOWS_RUNTIME_LICENSES', 'false') != 'true':
        raise ValueError('Review and explicitly accept Microsoft/font runtime licenses before installing prerequisites')
    environment = dict(os.environ)
    for key in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'STEAM_USERNAME', 'STEAM_PASSWORD', 'STEAM_GUARDCODE', 'PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH'):
        environment.pop(key, None)
    environment.update(HOME=str(root), WINEPREFIX=str(prefix), WINEARCH='win64', WINEDEBUG=shared.text(env, 'WINEDEBUG', '-all', 32), WINEDLLOVERRIDES='mscoree,mshtml=')
    winepath = Path(env.get('WINEPATH', str(root)))
    shared.confined(root, winepath)
    environment['WINEPATH'] = str(winepath)
    marker = shared.confined(root, prefix / '.voltra-prerequisites.json')
    identity = {'verbs': verbs, 'mono_sha256': pins['mono']['sha256'], 'runtime_image': pins['wine_runtime']}
    if marker.exists() and json.loads(marker.read_text()) == identity:
        environment['WINEDLLOVERRIDES'] = 'mscoree=n,b;mshtml=n,b'
        return environment
    prefix.mkdir(parents=True, exist_ok=True)
    subprocess.run(['xvfb-run', '-a', 'wineboot', '-u'], env=environment, cwd=root, check=True, timeout=300)
    for verb in verbs:
        if verb == 'mono':
            state = shared.confined(root, root / '.voltra/engineering/runtime-downloads'); state.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix='mono-', dir=state) as folder:
                msi = Path(folder) / 'mono.msi'
                release.download(pins['mono'], msi)
                subprocess.run(['xvfb-run', '-a', 'wine', 'msiexec', '/i', str(msi), '/qn', '/norestart'], env=environment, cwd=root, check=True, timeout=600)
        else:
            subprocess.run(['xvfb-run', '-a', 'winetricks', '-q', verb], env=environment, cwd=root, check=True, timeout=1800)
    native.private_write(marker, json.dumps(identity, sort_keys=True) + '\n')
    environment['WINEDLLOVERRIDES'] = 'mscoree=n,b;mshtml=n,b'
    return environment

