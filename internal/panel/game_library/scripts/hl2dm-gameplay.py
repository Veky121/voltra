#!/usr/bin/env python3
"""HL2DM-only measured scalar authority. Never rewrite legacy configuration."""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import struct
from decimal import Decimal
from steam_template import _publication_parent, _publication_leaf, _publish

DOCUMENT = 'hl2mp/cfg/voltra-gameplay.cfg'
RECEIPT = '.voltra/hl2dm-gameplay-seed.json'
DEFAULTS = dict(zip(('mp_timelimit', 'mp_fraglimit', 'mp_teamplay', 'mp_weaponstay',
    'mp_friendlyfire', 'mp_flashlight', 'mp_forcerespawn', 'sv_alltalk',
    'sv_voiceenable', 'sv_gravity', 'mp_chattime',
    'sv_hl2mp_weapon_respawn_time', 'sv_hl2mp_item_respawn_time'),
    ('0', '0', '0', '0', '0', '0', '0', '0', '1', '600', '10', '20', '30')))
BOOLEANS = set(tuple(DEFAULTS)[2:9])
GENERATED = {'voltra-gameplay.cfg', 'voltra-managed.cfg', 'voltra-server.cfg', 'voltra-login.cfg'}
WRAPPER = 'exec server.cfg\nexec voltra-gameplay.cfg\nexec voltra-managed.cfg\n'
GAMEINFO_SHA256 = '7d992e113f97ee4e371238fd77d82da5dae48c17284f08e878f04a32129a2d94'
# Fresh app232370 build24600426 payload, captured read-only before BSP edits.
# Gameinfo mounts a map's embedded pack first; unknown/changed maps therefore
# require review rather than claiming this loose gameplay document is active.
MAP_SHA256 = {
    'dm_lockdown.bsp':'9bfc6f06d847fdff1c28b9a651a427422c6ae96f923462ad695296cc2a722261',
    'dm_overwatch.bsp':'0d3b150396718fee1adfd94803dec12d76be500abe14f2295c73407ec0360439',
    'dm_powerhouse.bsp':'7536e1cabac281ee5ccb50d8cf4b2e737c69f8460b80a33fca3c33e1010cc9ab',
    'dm_resistance.bsp':'b9d29fac90bdb306b650fbedd0ee335b00a80e69a8630df6e9e40ada1eb378ef',
    'dm_runoff.bsp':'61f7dfd4fbbfec721083a9ee71bd6c2e031f9b69ca356b4eeec8a34648f29c1c',
    'dm_steamlab.bsp':'0fae15dbfc1c65a2aa3e9a794a436ab2bdc3d06de17a4ea793160e2fc740c823',
    'dm_underpass.bsp':'d47d5683596649f0905f398a3dcc1d50ed5d3da679ead9f76adc8c12f3e78775',
    'halls3.bsp':'123291a97597a53481da4097460439b380ae9219f371aec8d00d87634f6166b7',
}


def read(root, relative, limit=1024*1024):
    with _publication_parent(root, relative) as (parent, name, _):
        if parent is None or _publication_leaf(parent, name) is None: return None
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
        try:
            data = os.read(fd, limit+1)
            if len(data) > limit: raise ValueError('HL2DM configuration exceeds its size limit')
            return data
        finally: os.close(fd)


def text_checked(data):
    text = data.decode('utf-8')
    if any(ord(c) < 32 and c not in '\t\r\n' or ord(c) == 127 or c in '\x85\u2028\u2029' for c in text) or '\r' in text.replace('\r\n', ''):
        raise ValueError('Unsupported HL2DM configuration line separator')
    return text


def values_checked(values, complete=True):
    if not isinstance(values, dict) or not set(values) <= set(DEFAULTS) or complete and set(values) != set(DEFAULTS):
        raise ValueError('HL2DM requires the exact reviewed gameplay schema')
    for key, value in values.items():
        if not isinstance(value, str) or len(value) > 32 or not re.fullmatch(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)', value):
            raise ValueError('HL2DM gameplay values must be finite plain numeric scalars')
        number = Decimal(value)
        if number < 0 or number > Decimal('3.4028234e38'):
            raise ValueError('HL2DM gameplay value is outside the native float range')
        if number != 0 and struct.unpack('f', struct.pack('f', float(number)))[0] == 0:
            raise ValueError('HL2DM gameplay value underflows the native float range')
        if key in BOOLEANS and value not in ('0', '1'): raise ValueError('Expected literal native boolean')
        if key == 'mp_chattime' and not 1 <= number <= 120:
            raise ValueError('Postgame chat duration must be between1 and120')
        if key in ('mp_timelimit', 'mp_fraglimit') and number > 2147483520:
            raise ValueError('HL2DM limit exceeds the conservative native integer-conversion guard')
        if key == 'mp_fraglimit' and number != number.to_integral_value():
            raise ValueError('Choose a whole-number kill limit')
    return values


def parse_document(data):
    if len(data) > 65536: raise ValueError('HL2DM gameplay document exceeds its size limit')
    values = {}
    for line in text_checked(data).split('\n'):
        line = line.strip(' \t\r')
        if not line or line.startswith('//'): continue
        match = re.fullmatch(r'([a-z_][a-z0-9_]*)[ \t]+(?:([+\-0-9.]+)|"([+\-0-9.]+)")[ \t]*(?://[^\x00-\x08\x0a-\x1f\x7f]*)?', line, re.I)
        if not match or match[1].lower() not in DEFAULTS or match[1].lower() in values:
            raise ValueError('HL2DM gameplay file permits only unique reviewed scalar controls')
        values[match[1].lower()] = match[2] or match[3]
    return values_checked(values, complete=False)


def legacy_safe(root):
    """Fail closed for unknown executable chains that could redefine our commands."""
    info = read(root, 'hl2mp/gameinfo.txt')
    if info is None or hashlib.sha256(info).hexdigest() != GAMEINFO_SHA256:
        raise ValueError('Custom or changed HL2DM search paths require manual authority review')
    map_hashes(root)
    # Actual publisher gameinfo mounts custom/* ahead of the normal CFG path.
    # Its stock readme is inert; directories/VPKs can shadow this editor's file.
    for relative in ('hl2mp/custom', 'hl2mp/download'):
        folder = root / relative
        if folder.is_symlink() or folder.exists() and not folder.is_dir():
            raise ValueError('HL2DM custom content paths require manual authority review')
        if folder.exists() and any(p.name != 'readme.txt' or p.is_symlink() or not p.is_file() for p in folder.iterdir()):
            raise ValueError('Custom HL2DM content can shadow gameplay configuration; manual authority review required')
    for relative in ('hl2/cfg', 'hl2_complete/cfg', 'platform/cfg'):
        folder = root / relative
        if folder.is_symlink() or folder.exists() and (not folder.is_dir() or any(folder.iterdir())):
            raise ValueError('Loose HL2DM fallback configuration requires manual authority review')
    seen, active = set(), set()
    allowed = set(DEFAULTS) | {'hostname', 'sv_password', 'rcon_password', 'sv_lan', 'tv_enable', 'tv_port', 'sv_cheats', 'sv_region', 'sv_pausable', 'sv_logfile'}
    def inspect(name, optional=False):
        if name in active: raise ValueError('Recursive HL2DM legacy includes require manual review')
        if name in seen: return
        if len(seen) >= 128: raise ValueError('HL2DM legacy execution chain is too large')
        seen.add(name); active.add(name)
        raw = read(root, 'hl2mp/cfg/'+name)
        if raw is None:
            if optional: active.remove(name); return
            raise ValueError('Missing HL2DM included configuration: '+name)
        for line in text_checked(raw).split('\n'):
            line = line.strip(' \t\r')
            if not line or line.startswith('//'): continue
            include = re.fullmatch(r'exec[ \t]+(?:"([A-Za-z0-9_./-]+\.cfg)"|([A-Za-z0-9_./-]+\.cfg))[ \t]*(?://.*)?', line, re.I)
            if include:
                target = include[1] or include[2]
                if target.startswith('/') or any(p in ('', '.', '..') for p in target.split('/')) or Path(target).name in GENERATED:
                    raise ValueError('Unsafe or generated HL2DM legacy include')
                inspect(target); continue
            scalar = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*)[ \t]+("[^"\\;]*"|[^ \t"\\;]+)[ \t]*(?://.*)?', line)
            if scalar and scalar[1].lower() in allowed: continue
            if re.fullmatch(r'(?:addip|removeip)[ \t]+[0-9.]+[ \t]+[0-9.]+', line, re.I): continue
            if re.fullmatch(r'(?:banid|removeid)[ \t]+[0-9.]+[ \t]+STEAM_[0-9]+:[0-9]+:[0-9]+(?:[ \t]+kick)?', line, re.I): continue
            raise ValueError('Complex HL2DM legacy commands require manual authority review')
        active.remove(name)
    # The measured packed cfg/valve.rc explicitly executes joystick.cfg and
    # autoexec.cfg before stuffcmds. Include both optional loose entry points.
    for name in ('server.cfg', 'autoexec.cfg', 'joystick.cfg', 'config.cfg'): inspect(name, optional=True)
    for folder in ('hl2mp', 'hl2mp/cfg'):
        raw = read(root, folder+'/valve.rc')
        if raw and any(line.strip() and not line.lstrip().startswith('//') for line in text_checked(raw).split('\n')):
            raise ValueError('Custom HL2DM startup RC requires manual authority review')
    for path in (root/'hl2mp/cfg').glob('dm_*.cfg'):
        if path.is_symlink() or path.is_file() and path.read_bytes().strip():
            raise ValueError('Custom HL2DM map configuration requires manual authority review')


def map_hashes(root):
    folder = root / 'hl2mp/maps'
    if folder.is_symlink() or not folder.is_dir(): raise ValueError('Missing reviewed HL2DM map directory')
    result = {}
    for path in folder.rglob('*'):
        if path.is_symlink(): raise ValueError('HL2DM map paths cannot traverse symlinks')
        if not path.is_file() or path.suffix.lower() != '.bsp': continue
        name = path.relative_to(folder).as_posix()
        if name not in MAP_SHA256 or path.stat().st_size > 64*1024*1024:
            raise ValueError('Custom HL2DM maps require manual packed-configuration authority review')
        relative = path.relative_to(root).as_posix()
        with _publication_parent(root, relative) as (parent, leaf, _):
            if parent is None or _publication_leaf(parent, leaf) is None: raise ValueError('Missing reviewed HL2DM map')
            fd = os.open(leaf, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
            try:
                digest = hashlib.sha256()
                while data := os.read(fd, 1024*1024): digest.update(data)
                actual = digest.hexdigest()
            finally: os.close(fd)
        if actual != MAP_SHA256[name]: raise ValueError('Changed HL2DM map requires manual packed-configuration authority review')
        result[relative] = actual
    if not result: raise ValueError('No reviewed stock HL2DM maps found; reinstall the publisher payload')
    return result


def legacy_hashes(root):
    info = read(root, 'hl2mp/gameinfo.txt')
    if info is None: raise ValueError('Missing HL2DM search-path configuration')
    hashes = {'hl2mp/gameinfo.txt':hashlib.sha256(info).hexdigest(), **map_hashes(root)}; total = len(info)
    for path in sorted((root/'hl2mp/cfg').rglob('*')):
        if path.is_symlink(): raise ValueError('HL2DM legacy configuration cannot traverse symlinks')
        if not path.is_file() or path.suffix.lower() not in ('.cfg', '.rc') or path.parent == root/'hl2mp/cfg' and path.name in GENERATED: continue
        relative = path.relative_to(root).as_posix(); data = read(root, relative)
        total += len(data)
        if len(hashes) >= 4096 or total > 8*1024*1024: raise ValueError('HL2DM legacy snapshot is too large')
        hashes[relative] = hashlib.sha256(data).hexdigest()
    for relative in ('hl2mp/valve.rc',):
        raw = read(root, relative)
        if raw is not None: hashes[relative] = hashlib.sha256(raw).hexdigest()
    return hashes


def build(root):
    raw = read(root, 'steamapps/appmanifest_232370.acf')
    matches = re.findall(rb'"buildid"\s+"([0-9]+)"', raw or b'')
    return matches[0].decode() if len(matches) == 1 else None


def snapshot(root, effective_values):
    root = Path(root).resolve(); legacy_safe(root)
    if build(root) is None: raise ValueError('Missing installed HL2DM publisher build identity')
    return {'version':1, 'app_id':232370, 'game':'hl2mp', 'build_id':build(root), 'legacy_sha256':legacy_hashes(root), 'effective_values':values_checked(effective_values)}


def plan(root):
    existing = read(root, DOCUMENT, 65536)
    if existing is not None:
        parse_document(existing); legacy_safe(root); return None
    raw = read(root, RECEIPT, 65536)
    if raw is None: return None
    def unique(pairs):
        result = {}
        for key,value in pairs:
            if key in result: raise ValueError('Duplicate HL2DM migration receipt key')
            result[key] = value
        return result
    receipt = json.loads(raw.decode('utf-8'), object_pairs_hook=unique)
    if receipt.get('version') != 1 or receipt.get('app_id') != 232370 or receipt.get('game') != 'hl2mp' or receipt.get('build_id') != build(root):
        raise ValueError('HL2DM effective snapshot does not match the installed publisher build')
    if receipt.get('legacy_sha256') != legacy_hashes(root): raise ValueError('HL2DM legacy configuration changed since snapshot')
    legacy_safe(root); values = values_checked(receipt.get('effective_values'))
    return ('// Native gameplay settings; setup identity and ports remain managed separately.\n'+''.join(key+' '+values[key]+'\n' for key in DEFAULTS)).encode()


def seed_absent(root, data):
    if data is None: return False
    with _publication_parent(root, DOCUMENT) as (parent, name, volume):
        if parent is None: raise ValueError('Missing HL2DM configuration directory')
        if _publication_leaf(parent, name) is not None: raise ValueError('HL2DM gameplay file appeared during preparation')
        temporary = '.voltra-hl2dm-'+secrets.token_hex(16)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        try:
            with os.fdopen(os.dup(fd), 'wb') as out: out.write(data); out.flush(); os.fsync(out.fileno())
            if os.geteuid() == 0: os.fchown(fd, volume.st_uid, volume.st_gid)
            os.link(temporary, name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False); os.fsync(parent)
        finally:
            os.close(fd); os.unlink(temporary, dir_fd=parent)
    return True


def configure(root, env, launch):
    root = Path(root).resolve(); candidate = plan(root)
    argv, child = launch(root, env)
    seed_absent(root, candidate)
    if read(root, DOCUMENT, 65536) is not None:
        _publish(root, 'hl2mp/cfg/voltra-server.cfg', lambda out: out.write(WRAPPER.encode()), 0o600)
        # Teamplay is sampled by HL2MPRules during map construction. Apply before
        # the initial +map as well as through servercfgfile on later maps.
        position = argv.index('+map')
        argv[position:position] = ['+exec', 'voltra-gameplay.cfg', '+exec', 'voltra-managed.cfg']
    else:
        print('[WARN] HL2DM gameplay stays in native legacy files; enabling the editor requires an explicit effective-value snapshot.', flush=True)
    return argv, child
