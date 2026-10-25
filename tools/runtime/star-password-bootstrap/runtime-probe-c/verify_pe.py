#!/usr/bin/env python3
"""MIT. Static PE import/TLS/entrypoint/map verification. Never load the PE."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OUT = ROOT / '.local/star-password-bootstrap/runtime-probe-c'
spec = importlib.util.spec_from_file_location('star_pe_parser', HERE.parent / 'runtime-probe/generate-imports.py')
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)
ALLOWED = {'ExitProcess', 'FreeLibrary', 'GetCommandLineW', 'GetProcAddress',
           'GetStdHandle', 'LoadLibraryExW', 'OutputDebugStringW', 'WriteFile'}


def verify():
    build = json.loads((OUT / 'build.json').read_text())
    binary = OUT / 'star-c-runtime-probe.exe'
    body = binary.read_bytes()
    digest = hashlib.sha256(body).hexdigest()
    assert all(row['sha256'] == digest for row in build['builds'])
    normal, delayed = parser.imports(body)
    assert set(normal) == {'kernel32.dll'}, normal
    assert set(normal['kernel32.dll']) == ALLOWED, normal
    assert not delayed
    pe = struct.unpack_from('<I', body, 60)[0]
    optional = pe + 24
    entry = struct.unpack_from('<I', body, optional + 16)[0]
    image_base = struct.unpack_from('<Q', body, optional + 24)[0]
    tls_rva, tls_bytes = struct.unpack_from('<II', body, optional + 112 + 9 * 8)
    assert tls_rva == tls_bytes == 0, 'Unexpected TLS initialization'
    assert struct.unpack_from('<H', body, pe + 4)[0] == 0x8664
    table = optional + struct.unpack_from('<H', body, pe + 20)[0]
    text = None
    for index in range(struct.unpack_from('<H', body, pe + 6)[0]):
        p = table + index * 40
        if body[p:p + 8].rstrip(b'\0') == b'.text':
            size, start, raw_size, raw = struct.unpack_from('<IIII', body, p + 8)
            assert start <= entry < start + size
            text = body[raw:raw + raw_size]
    assert text is not None
    maps = []
    for row in build['builds']:
        mapping = Path(row['map']).read_text()
        matches = re.findall(r'^\s+[0-9a-fA-F]{4}:[0-9a-fA-F]{8}\s+probe_entry\s+([0-9a-fA-F]+)\s', mapping, re.MULTILINE)
        assert len(matches) == 1 and int(matches[0], 16) == image_base + entry
        maps.append({'path': row['map'], 'sha256': hashlib.sha256(mapping.encode()).hexdigest(),
                     'entrypoint_matches_probe_entry': True})
    manifest = json.loads((HERE / 'imports.json').read_text())['imports']
    for name, symbols in manifest.items():
        expected = name if name.startswith(('api-', 'ext-')) else 'C:\\windows\\system32\\' + name
        assert expected.encode('utf-16le') + b'\0\0' in body
        for symbol in symbols: assert symbol.encode() + b'\0' in body
    report = {'phase': 'source_offline_build_static_verified', **build, 'probe_sha256': digest,
              'probe_bytes': len(body), 'pe_machine': 'AMD64', 'pe_imports': normal,
              'delay_imports': delayed, 'crt_or_go_imports': False, 'tls_directory_rva': tls_rva,
              'tls_directory_bytes': tls_bytes, 'entrypoint_rva_hex': hex(entry),
              'preferred_entrypoint_hex': hex(image_base + entry), 'entrypoint_symbol': 'probe_entry',
              'text_sha256': hashlib.sha256(text).hexdigest(), 'maps': maps,
              'fixed_manifest_libraries': len(manifest), 'fixed_manifest_exports': sum(map(len, manifest.values())),
              'fixed_requests_and_all_export_literals_present': True, 'windows_binary_executed': False,
              'native_compatibility_verified': False, 'implementation_correctness_in_native_runtime_verified': False}
    (ROOT / 'artifacts/star-password-bootstrap-c-probe.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ('probe_sha256', 'probe_bytes', 'pe_imports', 'tls_directory_rva',
                                                 'entrypoint_symbol', 'deterministic_rebuild', 'windows_binary_executed')}))


if __name__ == '__main__': verify()
