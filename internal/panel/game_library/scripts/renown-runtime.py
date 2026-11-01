#!/usr/bin/env python3
"""Renown-only native-file authority over the shared transport and lifecycle."""
import os
from pathlib import Path
import re
import sys
import importlib.util
import shutil
import tempfile

path = Path(__file__).with_name('ghost_love_renown.py')
if not path.exists():
    path = path.with_name('ghost-love-renown.py')
spec = importlib.util.spec_from_file_location('renown_shared', path)
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)

FIELDS = {'ServerName':'SERVER_NAME', 'ServerPassword':'SERVER_PASSWORD',
          'AdminPassword':'ADMIN_PASSWORD', 'EnableRCON':'ENABLE_RCON',
          'RCONPassword':'RCON_PASSWORD', 'MaxPlayers':'MAX_PLAYERS',
          'MapRotation':'MAP_ROTATION', 'GameSaveName':'SAVE_NAME',
          'UseFirstMap':'USE_FIRST_MAP', 'Public':'PUBLIC', 'PrivateSession':'SERVER_LIST'}
PREFIX = 'Renown_Combat/Saved/Config/LinuxServer/'


def document(root, name):
    path = shared.confined(root, PREFIX + name)
    return path.read_bytes().decode('utf-8') if path.exists() else None


def scalars(content, section):
    values = {}; active = False; seen = False
    for line in (content or '').lstrip('\ufeff').splitlines():
        header = re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:[;#].*)?', line)
        if header:
            active = header[1].casefold() == section.casefold()
            if active and seen: raise ValueError('Duplicate Renown section')
            seen |= active
        elif active and not line.lstrip().startswith((';','#')) and '=' in line:
            key, value = line.split('=', 1); key = key.strip().casefold()
            managed = {k.casefold() for k in FIELDS} | {'rconport','firstpersononly'}
            if key in values and key in managed: raise ValueError('Duplicate Renown scalar; use Files to resolve')
            values[key] = value.strip()
    return values


def prepare(root, env):
    # Read and validate both files, allocation roles and installer arguments before writes/acquisition.
    game = document(root, 'Game.ini'); engine = document(root, 'Engine.ini')
    values = scalars(game, shared.RENOWN_SECTION); first = scalars(engine, 'Server')
    effective = dict(env)
    for key, variable in FIELDS.items():
        if key.casefold() in values: effective[variable] = values[key.casefold()]
    if 'firstpersononly' in first: effective['FIRST_PERSON_ONLY'] = first['firstpersononly']
    selected = shared.plan(root, 'renown', effective)
    shared.options(root, 'renown', effective)
    pending = []
    for name, before, existing in [('Game.ini', game, values), ('Engine.ini', engine, first)]:
        sections = selected['configs'][PREFIX + name]
        missing = {s:{k:v for k,v in fields.items() if k.casefold() not in existing or k == 'RCONPort' and existing[k.casefold()] != v} for s,fields in sections.items()}
        source = before if before is not None else shared.renown_seeds()['templates'][name]
        after = shared.native.patch_ini(source, missing, case_insensitive=True)
        # Leave an existing file byte-identical when no seeding or port reconciliation is needed.
        if before is None or any(missing.values()): pending.append((shared.confined(root, PREFIX+name), after))
    return effective, selected, pending


def configure(root, env):
    effective, selected, pending = prepare(root, env)
    for path, content in pending: shared.native.private_write(path, content)
    return selected


def install(root, env):
    effective, _, _ = prepare(root, env)
    saved = shared.confined(root, 'Renown_Combat/Saved')
    paths = list(saved.rglob('*')) if saved.exists() else []
    # Protect all native save formats, not only the shared helper's config suffixes.
    protected = [shared.confined(root,p.relative_to(root)) for p in paths if p.is_file() or p.is_symlink()]
    with tempfile.TemporaryDirectory(prefix='voltra-renown-retention-',dir=root) as directory:
        backups = []
        for i,p in enumerate(protected):
            backup = Path(directory)/str(i); shutil.copy2(p,backup); backups.append((p.relative_to(root),backup))
        try: shared.install(root, 'renown', effective)
        finally:
            for name,backup in backups:
                target=shared.confined(root,name);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(backup,target)


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ('install','run'): raise ValueError('Expected install or run')
    root = Path.cwd().resolve(); env = dict(os.environ)
    effective, selected, pending = prepare(root, env)
    if sys.argv[1] == 'install' or shared.boolean(env, 'VOLTRA_STEAM_AUTO_UPDATE', shared.boolean(env,'AUTO_UPDATE',True)):
        install(root, effective)
    if sys.argv[1] == 'install': return 0
    return shared.run(root, 'renown', configure(root, effective), shared.environment(root,'renown',effective))


if __name__ == '__main__':
    try: sys.exit(main())
    except Exception as error:
        print('Renown operation refused: '+type(error).__name__, file=sys.stderr); sys.exit(1)
