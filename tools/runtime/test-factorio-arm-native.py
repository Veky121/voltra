#!/usr/bin/env python3
"""Offline emitted-module subprocess tests, no SSH/game/downloads."""
from pathlib import Path
import hashlib
import io
import json
import runpy
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / 'artifacts/game-parity-20261029/factorio-arm-routing-followup'


def child():
    packet = json.loads((OUT/'profile-proposal.json').read_text())
    routed = packet['proposed_profile']['egg']['scripts']['installation']['script']
    canonical = json.loads((REPO/'internal/panel/game_library/overrides.json').read_text())[packet['recipe']]
    default = routed.split('\n*)\n', 1)[1].removesuffix('\n;;\nesac\n')
    assert default == canonical['egg']['scripts']['installation']['script']
    candidate = json.loads(json.dumps(packet['proposed_profile']))
    candidate['egg']['scripts']['installation']['script'] = default
    assert candidate == canonical, 'Controls/defaults/permissions/startup/images drifted'
    script = routed.split('\n1)\n', 1)[1].split('\n*)\n', 1)[0]
    assert script.index('exit 2') < script.index('set -eu'), 'Native must refuse before mutation'
    assert packet['native_deployable'] is False
    assert 'case "${VOLTRA_FACTORIO_NATIVE_ARM64:-}"' in routed
    import re
    emitted = re.search(r"FACTORIO_INSTALL_PY'\n(.*?)\nFACTORIO_INSTALL_PY", script, re.S)[1]
    assert emitted.rstrip() == (OUT/'factorio-arm-install.py').read_text().rstrip()
    assert '--architecture arm64' in script and 'box64 ./bin' not in script
    assert 'exec python3 .voltra/factorio-arm-runtime.py --' in script
    assert 'mv "$temp" data/server-settings.json' not in script
    with tempfile.TemporaryDirectory() as emitted_dir:
        module = Path(emitted_dir)/'installer.py'; module.write_text(emitted)
        m = runpy.run_path(str(module))
    install = m['install']
    g = install.__globals__
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary) / 'server'
        with patch.object(g['platform'], 'system', return_value='Linux'), patch.object(g['platform'], 'machine', return_value='aarch64'):
            calls = []
            def no_fetch(*args):
                calls.append(args)
                raise AssertionError('No acquisition permitted')
            for version in ('2.0.77', '../bad'):
                try:
                    install(root, version, transport=no_fetch)
                    raise AssertionError('Expected preflight rejection')
                except m['InstallError']:
                    assert not root.exists() and not calls
            def payload(machine=183, version='2.1.24'):
                elf = bytearray(64); elf[:6] = b'\x7fELF\x02\x01'; elf[18:20] = machine.to_bytes(2, 'little')
                result = io.BytesIO()
                with tarfile.open(fileobj=result, mode='w:xz') as tar:
                    for name, data in {'bin/arm64/factorio': bytes(elf), 'data/base/info.json': json.dumps({'name':'base','version':version}).encode(), 'saves/world.zip':b'publisher-save', 'mods/mod-list.json':b'publisher-mod'}.items():
                        row = tarfile.TarInfo('factorio/' + name); row.size = len(data); row.mode = 0o755 if name.startswith('bin/') else 0o644
                        tar.addfile(row, io.BytesIO(data))
                return result.getvalue()
            body = payload()
            def transport(url, destination, limit):
                if url == m['SUMS']:
                    value = (hashlib.sha256(body).hexdigest() + '  factorio-headless_linux-arm64_2.1.24.tar.xz\n').encode()
                else:
                    assert url == 'https://factorio.com/get-download/2.1.24/headless/linux-arm64'
                    value = body
                destination.write_bytes(value)
            receipt = install(root, '2.1.24', transport=transport)
            helpers = re.findall(r"cat > .voltra/([^ ]+) <<'VOLTRA_ARM_HELPER'\n(.*?)\nVOLTRA_ARM_HELPER", script, re.S)
            assert len(helpers) == 2
            for name, body_source in helpers:
                target = root/'.voltra'/name; target.write_text(body_source)
                loaded = runpy.run_path(str(target))
                if name == 'factorio-arm-runtime.py':
                    assert loaded['executable'](root) == root/'bin/arm64/factorio'
                    with patch.dict('os.environ', {'VOLTRA_FACTORIO_NATIVE_ARM64':'0'}):
                        try: loaded['native_ready'](root); raise AssertionError('Opt-out accepted')
                        except ValueError as error: assert 'opt-in' in str(error)
                    # Synthetic emitted runtime, never execute the synthetic ELF.
                    binary = root/'bin/arm64/factorio'
                    original_binary = binary.read_bytes()
                    for interpreter, present in [('/missing/ld-linux-aarch64.so.1', False), ('/synthetic/ld-linux-aarch64.so.1', True)]:
                        import struct
                        elf = bytearray(120)
                        elf[:6] = b'\x7fELF\x02\x01'; elf[18:20] = (183).to_bytes(2,'little')
                        struct.pack_into('<Q', elf, 32, 64); struct.pack_into('<HH', elf, 54, 56, 1)
                        raw = interpreter.encode()+b'\0'
                        struct.pack_into('<I', elf, 64, 3); struct.pack_into('<Q', elf, 72, 120)
                        struct.pack_into('<Q', elf, 96, len(raw)); elf.extend(raw)
                        binary.write_bytes(elf)
                        receipt_path = root/'.voltra/factorio-installed.json'
                        receipt_bytes = receipt_path.read_bytes()
                        record = json.loads(receipt_bytes)
                        record['files']['bin/arm64/factorio'].update(size=len(elf), sha256=hashlib.sha256(elf).hexdigest())
                        receipt_path.write_text(json.dumps(record))
                        with patch.dict('os.environ', {'VOLTRA_FACTORIO_NATIVE_ARM64':'1'}), patch.object(loaded['os'], 'access', return_value=present):
                            try: loaded['native_ready'](root); raise AssertionError('Unproved image accepted')
                            except ValueError as error:
                                assert ('image/ABI proof' if present else 'interpreter missing') in str(error)
                        receipt_path.write_bytes(receipt_bytes)
                    binary.write_bytes(original_binary)
            bad = root/'bin/arm64/factorio'; original = bad.read_bytes(); bad.write_bytes(b'wrong')
            try:
                loaded['executable'](root)
                raise AssertionError('Tampered executable accepted')
            except ValueError: pass
            bad.write_bytes(original)
            assert receipt['payload_architecture'] == 'linux-arm64'
            for name, value in {'saves/operator.zip':b'world', 'mods/operator.zip':b'mod', 'data/server-settings.json':b'{"unknown":9007199254740993}'}.items():
                p = root / name; p.parent.mkdir(exist_ok=True, parents=True); p.write_bytes(value)
            def snapshot():
                return {p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
            before = snapshot()
            install(root, '2.1.24', transport=transport)
            assert before == snapshot()
            def failure(point):
                if point.startswith('published:'): raise OSError('simulated publication failure')
            try:
                install(root, '2.1.24', transport=transport, hook=failure)
                raise AssertionError('Expected rollback')
            except OSError:
                assert snapshot() == before
            def unavailable(url, destination, limit):
                assert url == m['SUMS']
                destination.write_text('')
            try:
                install(root, '2.0.76', transport=unavailable)
                raise AssertionError('Unsupported version accepted')
            except m['InstallError']: assert snapshot() == before
            saved_body = body
            def corrupt(url, destination, limit):
                if url == m['SUMS']: transport(url, destination, limit)
                else: destination.write_bytes(b'corrupt')
            try:
                install(root, '2.1.24', transport=corrupt)
                raise AssertionError('Bad checksum accepted')
            except m['InstallError']: assert snapshot() == before
            body = payload(62)
            try:
                install(root, '2.1.24', transport=transport)
                raise AssertionError('x64 must be rejected')
            except m['InstallError']:
                assert snapshot() == before
        with patch.object(g['platform'], 'machine', return_value='x86_64'):
            try:
                install(Path(temporary)/'wrong-host', '2.1.24', transport=no_fetch)
                raise AssertionError('Wrong host accepted')
            except m['InstallError']:
                assert not (Path(temporary)/'wrong-host').exists()
    print('PASS: emitted ARM installer preflight, checksum/ELF, update preservation and rollback; synthetic only')


if __name__ == '__main__':
    if '--child' in sys.argv:
        child()
    else:
        subprocess.run([sys.executable, str(REPO/'tools/runtime/stage-factorio-arm-native.py')], check=True, cwd=REPO)
        first = (OUT/'profile-proposal.json').read_bytes()
        subprocess.run([sys.executable, str(REPO/'tools/runtime/stage-factorio-arm-native.py')], check=True, cwd=REPO)
        assert first == (OUT/'profile-proposal.json').read_bytes(), 'Stager not repeatable'
        subprocess.run([sys.executable, '-I' , str(Path(__file__).resolve()), '--child'], check=True, cwd=OUT)
