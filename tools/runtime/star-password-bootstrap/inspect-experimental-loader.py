#!/usr/bin/env python3
"""MIT. Inspect approved exact official assets as data; never execute a DLL."""
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('legacy_static_pe', Path(__file__).with_name('inspect-cached-loader.py'))
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
PINS = [('b9a166a756605b21058a64cde93bcaab1a855dba3553e5c7e6ce0fa8fdfad7b9', 8748315),
        ('0d91b15a75a7787bd4a469d1b3338a27c3e19ca843b5f8778f69a4d13f63b5de', 423121)]


def safe_name(value, seen):
    raw = value.replace('\\', '/')
    path = PurePosixPath(raw)
    if path.is_absolute() or '..' in path.parts or any(':' in p or p != p.rstrip(' .') for p in path.parts):
        raise ValueError('Unsafe Windows archive path')
    normalized = str(path).casefold()
    if normalized in seen: raise ValueError('Duplicate Windows archive path')
    seen.add(normalized)
    return str(path)


def inspect():
    rows, binaries, snapshots = [], {}, {}
    for digest, size in PINS:
        source = ROOT / '.local/star-password-bootstrap/public-cache/sha256' / digest
        body = source.read_bytes()
        if len(body) != size or hashlib.sha256(body).hexdigest() != digest:
            raise ValueError('Approved immutable archive pin mismatch')
        with zipfile.ZipFile(source) as archive:
            if archive.testzip() is not None: raise ValueError('ZIP CRC failure')
            if sum(i.file_size for i in archive.infolist()) > 64 * 1024**2:
                raise ValueError('Unexpected expanded size')
            seen, members = set(), []
            for info in archive.infolist():
                name = safe_name(info.filename, seen)
                if stat.S_ISLNK(info.external_attr >> 16): raise ValueError('Archive symlink')
                if info.file_size > 32 * 1024**2: raise ValueError('Unexpected member size')
                data = archive.read(info)
                row = {'path': info.filename, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                if name.lower().endswith('.dll'):
                    row['pe'] = legacy.pe(data)
                    binaries[name] = row
                    if name == 'ue4ss/UE4SS.dll':
                        row['required_api_name_strings'] = {n: n.encode() in data for n in (
                            'CallFunction', 'FindAllOf', 'ExecuteInGameThread', 'ExecuteWithDelay', 'IsValid', 'UFunction')}
                        if not all(row['required_api_name_strings'].values()): raise ValueError('Missing compiled API name')
                if name in ('ue4ss/LICENSE', 'StarRupture/UE4SS-settings.ini', 'StarRupture/UE4SS_Signatures/StaticConstructObject.lua'):
                    snapshots[name] = data
                members.append(row)
            rows.append({'sha256': digest, 'bytes': size, 'members': members, 'zip_crc_valid': True})
    license_body = snapshots['ue4ss/LICENSE'].decode().replace('\r\n', '\n')
    pinned_source = ROOT / '.local/star-metadata/candidate-source'
    if license_body != (pinned_source / 'LICENSE').read_text(encoding='utf-8'):
        raise ValueError('Binary MIT license differs from exact candidate source')
    config = snapshots['StarRupture/UE4SS-settings.ini']
    signature = snapshots['StarRupture/UE4SS_Signatures/StaticConstructObject.lua']
    for native_path, body in [('assets/CustomGameConfigs/StarRupture/UE4SS-settings.ini', config),
                              ('assets/CustomGameConfigs/StarRupture/UE4SS_Signatures/StaticConstructObject.lua', signature)]:
        source_body = (pinned_source / native_path.replace('/', '__')).read_bytes()
        if body.replace(b'\r\n', b'\n') != source_body.replace(b'\r\n', b'\n'):
            raise ValueError('Approved config archive differs from exact candidate source')
    if not re.search(rb'MajorVersion\s*=\s*5', config) or not re.search(rb'MinorVersion\s*=\s*6', config):
        raise ValueError('Star config target differs')
    result = {'phase': 'approved_static_assets_inspected', 'source_commit': '8333063595fa3c49ad307f3b0f732accbb760d25',
              'archives': rows, 'license_matches_exact_source_after_crlf_normalization': True,
              'star_config_matches_exact_source_after_crlf_normalization': True,
              'star_signature_matches_exact_source_after_crlf_normalization': True,
              'star_engine_target': 'UE5.6', 'candidate_source_review': 'artifacts/star-password-bootstrap-candidate-source.json',
              'binary_api_name_presence_is_native_binding_proof': False, 'native_game_engine_verified': False,
              'dll_executed': False, 'wine_game_or_runtime_installer_executed': False,
              'native_compatibility_verified': False, 'production_gates_changed': False}
    target = ROOT / 'artifacts/star-password-bootstrap-experimental-inspection.json'
    target.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'archives': len(rows), 'members': [len(r['members']) for r in rows], 'binaries': binaries,
                      'license_and_star_config_exact_source_match': True, 'native_compatibility_verified': False}, indent=2))


if __name__ == '__main__': inspect()
