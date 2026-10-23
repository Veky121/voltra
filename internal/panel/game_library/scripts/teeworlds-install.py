#!/usr/bin/env python3
"""MIT. Pinned native Teeworlds build with a marked stdin console adapter."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

VERSION = '0.7.5'
SOURCE = 'https://codeload.github.com/teeworlds/teeworlds/tar.gz/refs/tags/0.7.5'
SOURCE_SHA = '6e67846b38750d2a372d7835fa3775db016458a20a85aa52f1c758102ddd4abe'
RELEASE = 'https://github.com/teeworlds/teeworlds/releases/download/0.7.5/teeworlds-0.7.5-linux_x86_64.tar.gz'
RELEASE_SHA = '20ff9664cb6de612278e697cfac6a9426ec4065a4f0a3fefaa5185df03e58b4c'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def download(url, expected, path):
    with urllib.request.urlopen(url, timeout=120) as source, path.open('xb') as out:
        shutil.copyfileobj(source, out)
    if digest(path) != expected:
        raise ValueError('Pinned archive checksum mismatch')


def extract(archive, target, prefix):
    seen = set()
    with tarfile.open(archive, 'r:gz') as source:
        for member in source:
            parts = PurePosixPath(member.name).parts
            if not parts or parts[0] != prefix or '..' in parts or '\\' in member.name:
                raise ValueError('Unexpected archive path')
            if len(parts) == 1:
                continue
            relative = PurePosixPath(*parts[1:])
            if not (member.isfile() or member.isdir()) or str(relative) in seen:
                raise ValueError('Archive links, special files or duplicate paths are unsupported')
            seen.add(str(relative))
            path = target.joinpath(*relative.parts)
            if member.isdir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as inp, path.open('xb') as out:
                    shutil.copyfileobj(inp, out)
                path.chmod(member.mode & 0o777)


def patch_console(source, adapter):
    text = source.read_text()
    if 'class CVoltraInput' in text:
        raise ValueError('Console adapter already applied')
    anchors = [('#include <base/math.h>', '#include <poll.h>\n#include <unistd.h>\n#include <errno.h>\n#include <base/math.h>'),
               ('int CServer::Run()\n{', adapter + '\nint CServer::Run()\n{\n\tCVoltraInput VoltraInput;'),
               ('\tm_pConsole->StoreCommands(false);', '\tm_pConsole->StoreCommands(false);\n\tdbg_msg("server", "Voltra native console ready");'),
               ('\t\twhile(m_RunServer)\n\t\t{', '\t\twhile(m_RunServer)\n\t\t{\n\t\t\tVoltraInput.Poll(Console());')]
    for before, after in anchors:
        if text.count(before) != 1:
            raise ValueError('Pinned native console patch anchor changed')
        text = text.replace(before, after)
    source.write_text(text)


def build(source, output):
    subprocess.run(['cmake', '-S', str(source), '-B', str(output), '-G', 'Ninja',
                    '-DCLIENT=OFF', '-DDOWNLOAD_GTEST=OFF', '-DCMAKE_BUILD_TYPE=Release'], check=True)
    subprocess.run(['cmake', '--build', str(output), '--target', 'teeworlds_srv', '-j', '2'], check=True)


def install(root):
    state = root / '.voltra'
    state.mkdir(exist_ok=True)
    adapter = (state / 'teeworlds-console.cpp.inc').read_text()
    build_id = hashlib.sha256((SOURCE_SHA + RELEASE_SHA + adapter).encode()).hexdigest()
    receipt = state / 'teeworlds-release.json'
    binary = root / 'teeworlds_srv'
    if receipt.is_file() and binary.is_file():
        old = json.loads(receipt.read_text())
        if old.get('build_id') == build_id and old.get('binary_sha256') == digest(binary) and all((root / p).is_file() for p in old.get('stock_files', [])):
            print('Native Teeworlds engine and operator files retained.', flush=True)
            return
    with tempfile.TemporaryDirectory(prefix='.teeworlds-', dir=state) as temp:
        stage = Path(temp)
        download(SOURCE, SOURCE_SHA, stage / 'source.tar.gz')
        download(RELEASE, RELEASE_SHA, stage / 'release.tar.gz')
        source, release = stage / 'source', stage / 'release'
        source.mkdir()
        release.mkdir()
        extract(stage / 'source.tar.gz', source, 'teeworlds-0.7.5')
        extract(stage / 'release.tar.gz', release, 'teeworlds-0.7.5-linux_x86_64')
        patch_console(source / 'src/engine/server/server.cpp', adapter)
        build(source, stage / 'build')
        stock_files = []
        # Existing maps/assets are operator-owned. Install only absent files.
        for path in (release / 'data').rglob('*'):
            if not path.is_file():
                continue
            relative = path.relative_to(release)
            destination = root / relative
            stock_files.append(relative.as_posix())
            destination.parent.mkdir(parents=True, exist_ok=True)
            if not destination.exists():
                shutil.copy2(path, destination)
        source_target = state / 'teeworlds-source'
        if not source_target.exists():
            source.rename(source_target)
        if binary.exists():
            shutil.copy2(binary, state / 'teeworlds_srv.previous')
        # Publish the completed binary atomically, after download/extract/build.
        staged_binary = stage / 'build/teeworlds_srv'
        staged_binary.chmod(0o755)
        os.replace(staged_binary, binary)
        staged_receipt = stage / 'receipt.json'
        staged_receipt.write_text(json.dumps({'version': VERSION, 'build_id': build_id,
            'source_sha256': SOURCE_SHA, 'release_sha256': RELEASE_SHA,
            'binary_sha256': digest(binary), 'stock_files': stock_files}, indent=2) + '\n')
        os.replace(staged_receipt, receipt)
    for path, content in [(root / 'storage.cfg', 'add_path $CURRENTDIR\nadd_path $DATADIR\nadd_path $APPDIR\n'),
                          (root / 'autoexec.cfg', '# Operator Teeworlds configuration; managed fields are supplied after this file.\n')]:
        if not path.exists():
            path.write_text(content)
    print('Teeworlds 0.7.5 installed with native stdin console support.', flush=True)


if __name__ == '__main__':
    if os.uname().machine not in ('x86_64', 'amd64'):
        raise SystemExit('This Teeworlds release is reviewed for Linux x64')
    install(Path.cwd())
