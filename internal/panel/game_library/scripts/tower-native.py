"""Tower-only adapter. Existing native files win over seed environment values."""
from pathlib import Path
import os
import re
import shutil
import sys
import tempfile
import signal
import importlib.util

p = Path(__file__).with_name('vr_tower_ohd.py')
if not p.exists(): p = p.with_name('vr-tower-ohd.py')
spec = importlib.util.spec_from_file_location('tower_common', p)
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
CONFIG = 'Tower/Saved/Config/TowerServer.ini'
FIELDS = {base.TOWER_SECTION: {'ServerTitle': 'SERVER_TITLE', 'MaxPlayers': 'SERVER_MAX_PLAYER', 'SteamLoginToken': 'STEAM_LOGIN_TOKEN', 'TowerLoginToken': 'TOWER_LOGIN_TOKEN'}, 'DedicatedCondoOptions': {'CondoFile': 'CONDO_FILE', 'CondoAutoSave': 'CONDO_AUTO_SAVE', 'CondoBackupsEnabled': 'CONDO_BACKUPS'}, 'Administration': {'AdminSteamID': 'STEAM_ADMIN_ID'}}

def prepare(root, env):
    path = base.confined(root, CONFIG)
    before = path.read_bytes().decode('utf-8') if path.exists() else ''
    effective = dict(env); section = ''; seen = set(); present = set()
    for line in before.lstrip('\ufeff').splitlines():
        header = re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:[;#].*)?', line)
        if header:
            section = header[1].casefold()
            if section in [s.casefold() for s in FIELDS]:
                if section in seen: raise ValueError('Ambiguous Tower section')
                seen.add(section)
            continue
        if line.lstrip().startswith((';', '#')) or '=' not in line: continue
        key, value = line.split('=', 1)
        for group, fields in FIELDS.items():
            for native, variable in fields.items():
                if section == group.casefold() and key.strip().casefold() == native.casefold():
                    identity = (group, native)
                    if identity in present:
                        if native == 'AdminSteamID': continue
                        raise ValueError('Ambiguous Tower setting')
                    present.add(identity)
                    effective[variable] = value.strip().strip('"')
    selected = base.plan(root, 'tower', effective)
    base.steam_options(root, 'tower', env)
    # Prefer the operator preference preserved by the managed image bridge.
    toggle = 'VOLTRA_STEAM_AUTO_UPDATE' if 'VOLTRA_STEAM_AUTO_UPDATE' in env else 'AUTO_UPDATE'
    selected['update'] = base.boolean(env, toggle, True)
    sections = {s: {k:v for k,v in values.items() if (s,k) not in present} for s,values in selected['configs'][CONFIG].items()}
    if ('Administration', 'AdminSteamID') not in present:
        sections['Administration'] = {'AdminSteamID': selected['admin']}
    sections = {s:v for s,v in sections.items() if v}
    after = base.native.patch_ini(before, sections, case_insensitive=True) if sections else before
    # Redact native secrets even when unchanged and absent from the environment.
    selected['credentials'] += [effective.get(k, '') for k in ('STEAM_LOGIN_TOKEN','TOWER_LOGIN_TOKEN')]
    return selected, before, after

def configure(root, env):
    selected, before, after = prepare(root, env)
    if after != before:
        path = base.confined(root, CONFIG)
        base.native.private_write(path, after); path.chmod(0o600)
    return selected

def install(root, env):
    prepare(root, env)  # no acquisition or snapshot mutation before full validation
    names = ('Tower/Saved', 'Tower/Condos', 'Tower/Mods', 'Tower/Plugins', 'Tower/TowerServer_Chat.txt')
    with tempfile.TemporaryDirectory(prefix='tower-retention-') as directory:
        backups = []
        for name in names:
            path = base.confined(root, name)
            if not path.exists(): continue
            paths = list(path.rglob('*')) if path.is_dir() else [path]
            for child in paths:
                if child.is_symlink(): raise ValueError('Tower retention refuses symlinks before acquisition')
                if child.is_file():
                    relative = child.relative_to(root)
                    base.confined(root, str(relative))
                    backup = Path(directory) / str(len(backups))
                    shutil.copy2(child, backup); backups.append((relative, backup))
        try: base.install(root, 'tower', env)
        finally:
            for name, backup in backups:
                target = base.confined(root, str(name)); target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(backup, target)

def main():
    action = sys.argv[1]; root = Path.cwd().resolve(); env = dict(os.environ)
    selected, _, _ = prepare(root, env)
    if action == 'validate': return 0
    if action == 'install': install(root, env); return 0
    if action != 'run': raise ValueError('Unknown Tower action')
    if selected['update']: install(root, env)
    selected = configure(root, env)
    child = {k:v for k,v in env.items() if k not in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH') and not any(s in k for s in ('PASSWORD','TOKEN','API_KEY','STEAM_PASS','STEAM_AUTH','BETAPASS'))}
    child['HOME'] = str(root)
    return base.console.run(root, [str(selected['binary']), *selected['args']], child, '', credentials=selected['credentials'], ready_marker=selected['ready'], stop_signal=signal.SIGINT)

if __name__ == '__main__':
    try: sys.exit(main())
    except Exception as error:
        print('Tower validation/operation refused: ' + type(error).__name__, file=sys.stderr); sys.exit(1)

