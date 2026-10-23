#!/usr/bin/env python3
"""Public-program-only updated SteamCMD bundle, never a Steam home snapshot."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tarfile
import time
import zlib

PROGRAMS = frozenset(['steamcmd.sh', 'linux32/libstdc++.so.6'] + [
    architecture + '/' + name
    for architecture in ('linux32', 'linux64')
    for name in ('crashhandler.so', 'libtier0_s.so', 'libvstdlib_s.so', 'steamclient.so',
                 'steamcmd', 'steamconsole.so', 'steamerrorreporter')])
PACKAGE_METADATA = frozenset('package/steam_cmd_' + platform + suffix
                             for platform in ('linux', 'steamrt64')
                             for suffix in ('.installed', '.manifest'))
PUBLIC_FILES = PROGRAMS | PACKAGE_METADATA
EXCLUDED_PREFIXES = ('config/', 'appcache/', 'logs/',
                     'userdata/', 'steamapps/', '.steam/', 'linux32/logs/', 'linux64/logs/')


def digest(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def excluded(name):
    return (name.startswith(EXCLUDED_PREFIXES) or name == 'package/steam_cmd_metrics.bin'
            or re.fullmatch(r'package/steamcmd_[A-Za-z0-9_]+\.zip(?:\.vz)?\.[a-f0-9]{40}(?:_[0-9]+)?', name) is not None)


def installed_resources(content):
    result = {}
    for line in content.splitlines():
        if re.fullmatch(r'(?:OSVER=-?[0-9]+|VERSION=[0-9]+|SHA1=[A-F0-9]{40})', line):
            continue
        match = re.fullmatch(r'([^,]+),(-?[0-9]+);([0-9]+);([0-9]+)', line)
        if not match:
            raise ValueError('Unexpected public installed-list format')
        item = PurePosixPath(match[1])
        if item.is_absolute() or '..' in item.parts or '\\' in match[1] or item.parts[0] not in ('linux32', 'linux64', 'public', 'siteserverui') and str(item) != 'steamcmd.sh':
            raise ValueError('Installed-list contains an unexpected private path')
        if any(part.lower() in ('config', 'userdata', 'logs', 'appcache', 'steamapps', '.steam') for part in item.parts):
            raise ValueError('Public resource must not contain a private state path')
        if item.parts[0] in ('public', 'siteserverui') and int(match[2]) >= 0:
            result[item.as_posix()] = {'bytes': int(match[2]), 'crc32': int(match[4])}
    return result


def validate_metadata(content, name, version):
    if len(content) > 128 * 1024 or re.search(r'password|loginusers|cachedaccount|userdata|refresh.?token|access.?token', content, re.I):
        raise ValueError('Package metadata contains unexpected private state')
    if name.endswith('.manifest'):
        if re.findall(r'"version"\s+"([0-9]+)"', content) != [version] or '"kvsign' not in content:
            raise ValueError('Package manifest version/signature metadata is missing')
        return {}
    return installed_resources(content)


def validate_public_file(path, name, version):
    if name not in PUBLIC_FILES or path.is_symlink() or not path.is_file():
        raise ValueError('Non-public or linked SteamCMD program file')
    if path.stat().st_size > 64 * 1024**2 or path.stat().st_mode & 0o777 not in (0o555, 0o644, 0o755):
        raise ValueError('Unexpected public SteamCMD file size or permissions')
    if name in PROGRAMS:
        with path.open('rb') as source:
            prefix = source.read(64)
        if name == 'steamcmd.sh':
            if not prefix.startswith((b'#!/bin/bash\n', b'#!/usr/bin/env bash\n')):
                raise ValueError('Unexpected SteamCMD launcher format')
        elif not prefix.startswith(b'\x7fELF'):
            raise ValueError('Expected a public ELF program/library')
        return
    validate_metadata(path.read_text(encoding='utf-8'), name, version)


def build(source, archive, manifest_path, version):
    source, archive = Path(source), Path(archive)
    if not re.fullmatch('[0-9]{8,16}', version) or source.is_symlink():
        raise ValueError('Expected a reviewed fresh utility tree and native version')
    resources = {}
    for name in sorted(PACKAGE_METADATA):
        validate_public_file(source / name, name, version)
        resources.update(validate_metadata((source / name).read_text(), name, version))
    selected = PUBLIC_FILES | set(resources)
    present, ignored = set(), []
    for path in sorted(source.rglob('*')):
        if path.is_dir() and not path.is_symlink():
            continue
        name = path.relative_to(source).as_posix()
        if name in PUBLIC_FILES:
            validate_public_file(path, name, version)
            present.add(name)
        elif name in resources:
            if path.is_symlink() or not path.is_file() or path.stat().st_size != resources[name]['bytes'] or path.stat().st_mode & 0o777 not in (0o644, 0o755):
                raise ValueError('Unexpected public package resource')
            checksum = 0
            with path.open('rb') as incoming:
                for chunk in iter(lambda: incoming.read(1024 * 1024), b''):
                    checksum = zlib.crc32(chunk, checksum)
            if checksum != resources[name]['crc32']:
                raise ValueError('Public resource differs from publisher installed catalog')
            present.add(name)
        elif excluded(name):
            ignored.append(name)
        else:
            raise ValueError('Unknown SteamCMD file requires review: ' + name)
    if present != selected:
        raise ValueError('Fresh utility is missing required public programs/metadata')
    files = {}
    with tarfile.open(archive, 'w:gz', compresslevel=6) as output:
        for name in sorted(selected):
            path = source / name
            entry = output.gettarinfo(str(path), arcname=name)
            entry.uid = entry.gid = 0
            entry.uname = entry.gname = ''
            with path.open('rb') as incoming:
                output.addfile(entry, incoming)
            files[name] = {'sha256': digest(path), 'bytes': path.stat().st_size,
                           'mode': path.stat().st_mode & 0o777, 'mtime': int(path.stat().st_mtime)}
    record = {'schema_version': 1, 'kind': 'public-steamcmd-updated', 'steamcmd_version': version,
              'prepared_unix': int(time.time()), 'archive_sha256': digest(archive), 'archive_bytes': archive.stat().st_size,
              'files': files, 'excluded_files': ignored, 'source_scope': 'Fresh official launcher +quit only; no login, game or user data',
              'resources': resources, 'resource_catalogs': sorted(name for name in PACKAGE_METADATA if name.endswith('.installed')),
              'steamcmd_self_updates_enabled': True}
    Path(manifest_path).write_text(json.dumps(record, indent=2) + '\n')
    return record


def validate_archive(archive, manifest):
    resources = manifest.get('resources', {})
    if manifest.get('kind') != 'public-steamcmd-updated' or set(manifest.get('files', {})) != PUBLIC_FILES | set(resources):
        raise ValueError('Unexpected updated SteamCMD public manifest')
    if manifest.get('steamcmd_self_updates_enabled') is not True or not 0 <= time.time() - manifest.get('prepared_unix', 0) <= 7 * 86400:
        raise ValueError('Updated SteamCMD cache needs a fresh reviewed preparation')
    total = 0
    for expected in manifest['files'].values():
        if not re.fullmatch('[a-f0-9]{64}', expected.get('sha256', '')) or not 0 < expected.get('bytes', 0) <= 64 * 1024**2 or expected.get('mode') not in (0o555, 0o644, 0o755):
            raise ValueError('Invalid public program metadata')
        total += expected['bytes']
    if total > 512 * 1024**2 or Path(archive).stat().st_size > 128 * 1024**2:
        raise ValueError('Public bootstrap exceeds its size limit')
    if digest(archive) != manifest['archive_sha256'] or Path(archive).stat().st_size != manifest['archive_bytes']:
        raise ValueError('Updated SteamCMD archive identity differs from reviewed manifest')
    seen, declared_resources = set(), {}
    with tarfile.open(archive, 'r:gz') as source:
        for member in source:
            if member.name not in manifest['files'] or member.name in seen or not member.isfile():
                raise ValueError('Updated SteamCMD archive has an unknown, duplicate or linked member')
            seen.add(member.name)
            expected = manifest['files'][member.name]
            if member.name in PACKAGE_METADATA and member.size > 128 * 1024:
                raise ValueError('Package metadata exceeds its size limit')
            if member.size != expected['bytes'] or member.mode != expected['mode'] or int(member.mtime) != expected['mtime']:
                raise ValueError('Updated public program metadata differs')
            checksum, crc, metadata = hashlib.sha256(), 0, bytearray()
            with source.extractfile(member) as incoming:
                for chunk in iter(lambda: incoming.read(1024 * 1024), b''):
                    checksum.update(chunk)
                    crc = zlib.crc32(chunk, crc)
                    if member.name in PACKAGE_METADATA: metadata.extend(chunk)
            if checksum.hexdigest() != expected['sha256']:
                raise ValueError('Updated public program checksum differs')
            if member.name in resources and (member.size != resources[member.name]['bytes'] or crc != resources[member.name]['crc32']):
                raise ValueError('Public package resource CRC differs')
            if member.name in PACKAGE_METADATA:
                declared_resources.update(validate_metadata(metadata.decode('utf-8'), member.name, manifest['steamcmd_version']))
    if seen != PUBLIC_FILES | set(resources) or resources != declared_resources:
        raise ValueError('Updated SteamCMD archive is incomplete')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    record = build(args.source, args.archive, args.manifest, args.version)
    print(json.dumps({'files': len(record['files']), 'archive_sha256': record['archive_sha256'], 'archive_bytes': record['archive_bytes'], 'excluded_files': len(record['excluded_files'])}))
