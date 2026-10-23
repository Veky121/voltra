#!/usr/bin/env python3
"""MIT. Typed tactical server acquisition with operator state retention."""
import os
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from steam_template import update, arguments, Redactor, _publish
from source_next_install import apply_payload

GAMES = {
 'sandstorm': (581330, 'Insurgency', 'Insurgency/Binaries/Linux/InsurgencyServer-Linux-Shipping'),
 'squad': (403240, 'SquadGame', 'SquadGame/Binaries/Linux/SquadGameServer'),
 'postscriptum': (746200, 'PostScriptum', 'PostScriptum/Binaries/Linux/PostScriptumServer')}


def confined(root, name):
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root): raise ValueError('Tactical server path escapes volume')
    return path


def selection(env):
    kind = env.get('VOLTRA_TACTICAL', '')
    if kind not in GAMES: raise ValueError('Choose a reviewed tactical recipe')
    app, game, executable = GAMES[kind]
    selected = env.get('SRCDS_APPID', str(app))
    if selected not in (str(app), '') or not selected and kind != 'sandstorm': raise ValueError('Tactical dedicated application does not match recipe')
    if env.get('WINDOWS_INSTALL', '0') != '0': raise ValueError('These tactical recipes require native Linux packages')
    return kind, app, game, executable


def workshop_ids(value):
    if not value: return []
    if len(value) > 4096 or not re.fullmatch(r'[1-9][0-9]{0,19}(?:,[1-9][0-9]{0,19}){0,63}', value): raise ValueError('Workshop items must be comma-separated numeric IDs, at most64')
    ids = value.split(',')
    if len(set(ids)) != len(ids): raise ValueError('Workshop IDs must be unique')
    return ids


def workshops(root, env, ids):
    if not ids: return
    # Retain the original anonymous workshop393380 path. Entitlement/login
    # failures remain failures, never replaced with client content or mirrors.
    args = arguments(root, 403240, env)
    args = args[:args.index('+app_update')]
    for identifier in ids: args += ['+workshop_download_item', '393380', identifier, 'validate']
    args += ['+quit']
    child_env = {**os.environ, 'HOME': str(root)}
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH'): child_env.pop(key, None)
    child = subprocess.Popen(['timeout', '--signal=TERM', '--kill-after=30s', '7200s', *args], cwd=root, env=child_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    redactor = Redactor([env.get(key, '') for key in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')])
    successes = set(); tail = b''
    try:
        for block in iter(lambda: child.stdout.read1(16384), b''):
            tail = (tail + block)[-65536:]
            successes.update(match.decode() for match in re.findall(rb'Success\. Downloaded item ([0-9]+)', tail))
            sys.stdout.buffer.write(redactor.feed(block)); sys.stdout.buffer.flush()
        sys.stdout.buffer.write(redactor.feed(b'', final=True)); sys.stdout.buffer.flush()
        if child.wait() != 0 or not set(ids).issubset(successes): raise RuntimeError('Squad workshop acquisition failed; inspect redacted publisher output')
    except BaseException:
        if child.poll() is None:
            child.terminate()
            try: child.wait(timeout=30)
            except subprocess.TimeoutExpired: child.kill(); child.wait()
        raise RuntimeError('Squad workshop acquisition did not complete; inspect redacted publisher output') from None
    for identifier in ids:
        source = confined(root, 'steamapps/workshop/content/393380/' + identifier)
        target = confined(root, 'SquadGame/Plugins/Mods/' + identifier)
        if not source.is_dir() or not any(source.iterdir()): raise ValueError('Publisher workshop payload is missing')
        for path in source.rglob('*'):
            confined(root, path.relative_to(root))
            if not path.is_file() and not path.is_dir(): raise ValueError('Workshop payload contains an unsupported entry')
        receipt_name = '.voltra/tactical/workshop-' + identifier + '.json'
        receipt = confined(root, receipt_name); previous = json.loads(receipt.read_text()) if receipt.exists() else {}
        files, preserved = apply_payload(root, 'SquadGame/Plugins/Mods/' + identifier, source, previous)
        payload = json.dumps({'workshop_app':393380, 'item':identifier, 'files':files, 'preserved_operator_files':preserved}).encode()
        _publish(root, receipt_name, lambda output: output.write(payload), 0o600)


def install(root, env, validate=True):
    root = Path(root).resolve(); kind, app, game, executable = selection(env)
    # Fail closed for private Steam before snapshots or network side effects.
    arguments(root, app, env, validate)
    ids = workshop_ids(env.get('WORKSHOP_ITEMS', '')) if kind == 'squad' else []
    protected = {}
    with tempfile.TemporaryDirectory(prefix='.tactical-retention-', dir=root) as temporary:
        for relative in (game + '/ServerConfig', game + '/Saved', game + '/Plugins/Mods'):
            folder = confined(root, relative)
            if not folder.exists(): continue
            for path in folder.rglob('*'):
                confined(root, path.relative_to(root))
                if path.is_file():
                    if relative.endswith('/Plugins/Mods') and path.suffix.lower() not in ('.ini', '.cfg') and not any(part.lower() in ('config','configs') for part in path.relative_to(folder).parts[:-1]): continue
                    metadata = path.stat()
                    if not stat.S_ISREG(metadata.st_mode): raise ValueError('Tactical operator state must be regular files')
                    name = str(path.relative_to(root)); backup = Path(temporary) / str(len(protected)); shutil.copyfile(path, backup)
                    protected[name] = (backup, metadata)
        try:
            result = update(root, app, env={**env, 'SRCDS_APPID': str(app)}, validate=validate, required=(executable,))
            binary = confined(root, executable); binary.chmod(binary.stat().st_mode | 0o100)
            workshops(root, env, ids)
            return result
        finally:
            for name, (backup, metadata) in protected.items():
                confined(root, name)
                def write(output, backup=backup):
                    with backup.open('rb') as source: shutil.copyfileobj(source, output)
                _publish(root, name, write, stat.S_IMODE(metadata.st_mode))
                target = root / name
                if os.geteuid() == 0: os.chown(target, metadata.st_uid, metadata.st_gid)
                target.chmod(stat.S_IMODE(metadata.st_mode)); os.utime(target, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))


if __name__ == '__main__': install(Path.cwd(), dict(os.environ))
