#!/usr/bin/env python3
"""CS1.6-only seed-once gameplay authority; legacy files remain operator-owned."""
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import secrets
import struct
import sys
from decimal import Decimal, InvalidOperation
import goldsrc_runtime as base
from steam_template import _publication_parent, _publication_leaf, _publish

DOCUMENT = 'cstrike/voltra_gameplay.cfg'
RECEIPT = '.voltra/cs16-gameplay-seed.json'
WRAPPER = 'exec server.cfg\nexec voltra_gameplay.cfg\nexec voltra_managed.cfg\nservercfgfile voltra_server.cfg\n'
# Actual app90 build15961496 cvar output, not settings.scr's saved GUI values.
DEFAULTS = dict(zip(('mp_timelimit','mp_winlimit','mp_maxrounds','mp_roundtime',
    'mp_freezetime','mp_buytime','mp_startmoney','mp_footsteps','mp_forcecamera',
    'mp_fadetoblack','mp_friendlyfire','mp_tkpunish','mp_autokick',
    'mp_hostagepenalty','mp_flashlight'),
    ('20','0','0','5','6','1.5','800','1','0','0','0','0','1','13','0')))
BOOLEANS = {'mp_footsteps','mp_fadetoblack','mp_friendlyfire','mp_tkpunish','mp_autokick','mp_flashlight'}
GENERATED = {'voltra_gameplay.cfg','voltra_managed.cfg','voltra_server.cfg','voltra_bootstrap.cfg'}


def read(root, relative, limit=1024*1024):
    with _publication_parent(root, relative) as (parent, name, _):
        if parent is None or _publication_leaf(parent, name) is None:
            return None
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
        try:
            data = os.read(fd, limit + 1)
            if len(data) > limit: raise ValueError('CS16 configuration exceeds its size limit')
            return data
        finally:
            os.close(fd)


def values_checked(values):
    if not isinstance(values, dict) or set(values) != set(DEFAULTS):
        raise ValueError('CS16 snapshot requires the exact fifteen measured gameplay values')
    result = {}
    for key in DEFAULTS:
        value = values[key]
        if not isinstance(value, str) or not re.fullmatch(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)', value) or len(value) > 32:
            raise ValueError('CS16 gameplay values must be finite plain numeric scalars')
        try: number = Decimal(value)
        except InvalidOperation: raise ValueError('Invalid CS16 numeric setting') from None
        if not number.is_finite() or number < 0 or number > Decimal('3.4028234e38'):
            raise ValueError('CS16 gameplay value is outside native float range')
        if number != 0 and struct.unpack('f', struct.pack('f', float(number)))[0] == 0:
            raise ValueError('CS16 gameplay value underflows native float range')
        if key in BOOLEANS and value not in ('0', '1'): raise ValueError('Expected literal native boolean')
        if key == 'mp_forcecamera' and number not in (0, 1, 2): raise ValueError('Invalid camera option')
        # Actual public15961496 map transitions clamp the stale GUI0..15 to1..9.
        if key == 'mp_roundtime' and not 1 <= number <= 9: raise ValueError('Round duration must stay within the measured native range1..9')
        if key == 'mp_freezetime' and number > 60: raise ValueError('Freeze duration exceeds publisher limit')
        if key == 'mp_buytime' and number < Decimal('.25'): raise ValueError('Buy time is below publisher limit')
        if key == 'mp_startmoney' and not 800 <= number <= 16000: raise ValueError('Invalid starting money')
        result[key] = value
    return result


def parse_document(data):
    if len(data) > 65536: raise ValueError('CS16 gameplay document exceeds its size limit')
    text = data.decode('utf-8')
    if any(ord(c) < 32 and c not in '\t\r\n' or ord(c) == 127 or c in '\x85\u2028\u2029' for c in text) or '\r' in text.replace('\r\n', ''):
        raise ValueError('Unsupported CS16 line separator')
    values = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith('//'): continue
        match = re.fullmatch(r'(mp_[a-z]+)[ \t]+(?:([+\-0-9.]+)|"([+\-0-9.]+)")[ \t]*(?://[^\x00-\x08\x0a-\x1f\x7f]*)?', stripped, re.IGNORECASE)
        if not match or match[1].lower() not in DEFAULTS or match[1].lower() in values:
            raise ValueError('CS16 gameplay document must contain only unique reviewed scalar controls')
        values[match[1].lower()] = match[2] or match[3]
    values_checked({**DEFAULTS, **values})
    return values


def legacy_hashes(root):
    folder = root / 'cstrike'
    if folder.is_symlink(): raise ValueError('CS16 game directory must not be a symlink')
    result, total = {}, 0
    for path in sorted(folder.rglob('*')):
        if path.is_symlink(): raise ValueError('CS16 effective snapshot cannot traverse symlinks')
        if not path.is_file() or path.suffix.lower() != '.cfg' or path.parent == folder and path.name in GENERATED: continue
        relative = path.relative_to(root).as_posix()
        data = read(root, relative)
        total += len(data)
        if len(result) >= 4096 or total > 8*1024*1024: raise ValueError('CS16 legacy configuration snapshot is too large')
        result[relative] = hashlib.sha256(data).hexdigest()
    return result


def build(root):
    data = read(root, 'steamapps/appmanifest_90.acf')
    if data is None: return None
    matches = re.findall(rb'"buildid"\s+"([0-9]+)"', data)
    return matches[0].decode() if len(matches) == 1 else None


def snapshot(root, effective_values):
    """Explicit operator migration: caller supplies values measured from this server."""
    root = Path(root).resolve()
    if build(root) is None: raise ValueError('Missing installed app90 build identity')
    legacy_execution_safe(root)
    return {'version': 1, 'app_id': 90, 'mod': 'cstrike', 'build_id': build(root),
            'legacy_sha256': legacy_hashes(root), 'effective_values': values_checked(effective_values)}


def legacy_execution_safe(root):
    """Conservative execution-chain proof; complex rules require explicit review."""
    known = set(DEFAULTS) | {'sv_aim','pausable','hostname','sv_maxspeed','sv_cheats',
        'sv_password','rcon_password','sv_lan','sys_ticrate','mp_autoteambalance',
        'mp_limitteams','mp_c4timer','allow_spectators','mp_logdetail','mp_logmessages'}
    seen, active = set(), set()
    def inspect(relative):
        if relative in active: raise ValueError('CS16 recursive config includes require manual review')
        if relative in seen: return
        if len(seen) >= 128: raise ValueError('CS16 config execution chain is too large')
        seen.add(relative)
        active.add(relative)
        raw = read(root, 'cstrike/' + relative)
        if raw is None:
            raise ValueError('Missing CS16 included configuration: '+relative)
        text = raw.decode('utf-8')
        if any(ord(c) < 32 and c not in '\t\r\n' or ord(c) == 127 or c in '\x85\u2028\u2029' for c in text) or '\r' in text.replace('\r\n',''):
            raise ValueError('Unsupported CS16 legacy configuration line separator')
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith('//'): continue
            include = re.fullmatch(r'exec[ \t]+(?:"([A-Za-z0-9_./-]+\.cfg)"|([A-Za-z0-9_./-]+\.cfg))[ \t]*(?://.*)?', line, re.IGNORECASE)
            if include:
                name = include[1] or include[2]
                if name.startswith('/') or any(p in ('.','..','') for p in name.split('/')) or name in GENERATED:
                    raise ValueError('Unsafe or generated CS16 legacy config include')
                inspect(name)
                continue
            scalar = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*)[ \t]+("[^"\\;]*"|[^ \t"\\;]+)[ \t]*(?://.*)?', line)
            if scalar and scalar[1].lower() in known: continue
            if re.fullmatch(r'(?:addip|removeip)[ \t]+[0-9.]+[ \t]+[0-9.]+', line, re.IGNORECASE): continue
            if re.fullmatch(r'(?:banid|removeid)[ \t]+[0-9.]+[ \t]+STEAM_[0-9]+:[0-9]+:[0-9]+(?:[ \t]+kick)?', line, re.IGNORECASE): continue
            raise ValueError('Complex CS16 legacy commands require manual review before enabling gameplay authority')
        active.remove(relative)
    inspect('server.cfg')
    # Publisher headless boot probes maps/<map>_load.cfg. Custom startup RC/map
    # scripts have unproven ordering, so keep them untouched and refuse authority.
    optional = root / 'cstrike/autoexec.cfg'
    if optional.exists() or optional.is_symlink(): inspect('autoexec.cfg')
    entrypoints = [root / 'cstrike/valve.rc', *(root / 'cstrike/maps').glob('*_load.cfg'), *(root / 'cstrike/maps').glob('*_unload.cfg')]
    for path in entrypoints:
        relative = path.relative_to(root).as_posix()
        raw = read(root, relative)
        if raw is not None and any(line.strip() and not line.lstrip().startswith('//') for line in raw.decode('utf-8').splitlines()):
            raise ValueError('Custom CS16 startup/map scripts require manual authority review')


def plan(root):
    existing = read(root, DOCUMENT, 65536)
    if existing is not None:
        parse_document(existing)
        legacy_execution_safe(root)
        return None
    raw = read(root, RECEIPT, 65536)
    if raw is None: return None
    def unique(pairs):
        out = {}
        for key, value in pairs:
            if key in out: raise ValueError('Duplicate CS16 snapshot key')
            out[key] = value
        return out
    receipt = json.loads(raw.decode('utf-8'), object_pairs_hook=unique)
    if receipt.get('version') != 1 or receipt.get('app_id') != 90 or receipt.get('mod') != 'cstrike' or receipt.get('build_id') != build(root):
        raise ValueError('CS16 effective snapshot does not match the installed publisher build')
    if receipt.get('legacy_sha256') != legacy_hashes(root):
        raise ValueError('Legacy CS16 configuration changed since the effective snapshot')
    values = values_checked(receipt.get('effective_values'))
    legacy_execution_safe(root)
    return ('// Native gameplay settings. Setup identity and credentials remain separately managed.\n' + ''.join(key+' '+values[key]+'\n' for key in DEFAULTS)).encode()


def seed_absent(root, data):
    if data is None: return False
    # Hard-link publication is create-only: concurrent operator creation is never replaced.
    with _publication_parent(root, DOCUMENT) as (parent, name, volume):
        if parent is None: raise ValueError('Missing native CS16 directory')
        if _publication_leaf(parent, name) is not None: raise ValueError('CS16 gameplay file appeared during preparation')
        temporary = '.voltra-cs16-' + secrets.token_hex(16)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        try:
            with os.fdopen(os.dup(fd), 'wb') as output: output.write(data); output.flush(); os.fsync(output.fileno())
            if os.geteuid() == 0: os.fchown(fd, volume.st_uid, volume.st_gid)
            os.link(temporary, name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
            os.fsync(parent)
        finally:
            os.close(fd)
            os.unlink(temporary, dir_fd=parent)
    return True


def configure(root, env):
    root = Path(root).resolve()
    if base.selection(env) != ('cs16', 'cstrike'): raise ValueError('This gameplay adapter supports only vanilla CS16')
    candidate = plan(root)  # Validate operator authority before shared configuration writes.
    argv, child = base.configure(root, env)
    seed_absent(root, candidate)
    if read(root, DOCUMENT, 65536) is not None:
        _publish(root, 'cstrike/voltra_server.cfg', lambda out: out.write(WRAPPER.encode()), 0o600)
    else:
        print('[WARN] Existing CS16 settings remain in server.cfg; gameplay migration requires an explicit effective-value snapshot.', flush=True)
    return argv, child


def __getattr__(name):
    return getattr(base, name)


def main():
    plan(Path.cwd().resolve())  # Refuse invalid authority before automatic acquisition.
    preflight = importlib.import_module('counterstrike_preflight')
    return preflight.main('cs16', runtime=sys.modules[__name__])


if __name__ == '__main__':
    raise SystemExit(main())
