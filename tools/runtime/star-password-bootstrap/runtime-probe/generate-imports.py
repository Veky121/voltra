#!/usr/bin/env python3
"""MIT. Generate fixed public imports from the reviewed PE files as data only."""
import hashlib
import json
from pathlib import Path
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[4]
ARCHIVE_SHA = 'b9a166a756605b21058a64cde93bcaab1a855dba3553e5c7e6ce0fa8fdfad7b9'
FILES = {'dwmapi.dll': '93b9431a5a4f32c675d269c5da1c9b3ec6f88552ec20c282ab435f411e9271fb',
         'ue4ss/UE4SS.dll': 'ce5e3c46a920cc00b2817ac61e438c9162830290379d0b5b9c4dfc2b29459290'}


def imports(body):
    if body[:2] != b'MZ': raise ValueError('Not PE')
    offset = struct.unpack_from('<I', body, 60)[0]
    if body[offset:offset + 4] != b'PE\0\0': raise ValueError('Invalid PE')
    machine, sections = struct.unpack_from('<HH', body, offset + 4)
    optional = offset + 24
    if machine != 0x8664 or struct.unpack_from('<H', body, optional)[0] != 0x20b: raise ValueError('Not AMD64 PE32+')
    table = optional + struct.unpack_from('<H', body, offset + 20)[0]

    def physical(rva):
        for index in range(sections):
            size, start, raw_size, raw = struct.unpack_from('<IIII', body, table + index * 40 + 8)
            if start <= rva < start + min(size or raw_size, raw_size):
                p = raw + rva - start
                if p < len(body): return p
        raise ValueError('Unmapped RVA')

    def string(rva):
        p = physical(rva)
        end = body.index(b'\0', p, min(p + 4096, len(body)))
        return body[p:end].decode('ascii')

    def thunks(rva):
        p, symbols = physical(rva), []
        for index in range(65536):
            value = struct.unpack_from('<Q', body, p + index * 8)[0]
            if not value: return symbols
            symbols.append('#' + str(value & 0xffff) if value & (1 << 63) else string(value + 2))
        raise ValueError('Unterminated import thunk list')

    result, delayed = {}, {}
    rva = struct.unpack_from('<I', body, optional + 112 + 8)[0]
    if rva:
        p = physical(rva)
        for index in range(4096):
            descriptor = struct.unpack_from('<5I', body, p + index * 20)
            if not any(descriptor): break
            original, _, _, name, first = descriptor
            result[string(name).lower()] = thunks(original or first)
        else: raise ValueError('Unterminated descriptors')
    delay_rva = struct.unpack_from('<I', body, optional + 112 + 13 * 8)[0]
    if delay_rva:
        p = physical(delay_rva)
        for index in range(4096):
            descriptor = struct.unpack_from('<8I', body, p + index * 32)
            if not any(descriptor): break
            attrs, name, _, iat, names, _, _, _ = descriptor
            if attrs != 1: raise ValueError('Unsupported non-RVA delay descriptor; no guessing')
            delayed[string(name).lower()] = thunks(names or iat)
        else: raise ValueError('Unterminated delay descriptors')
    return result, delayed


def main():
    archive = ROOT / '.local/star-password-bootstrap/public-cache/sha256' / ARCHIVE_SHA
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA: raise ValueError('Archive pin mismatch')
    combined, provenance = {}, []
    with zipfile.ZipFile(archive) as source:
        for name, expected in FILES.items():
            body = source.read(name)
            if hashlib.sha256(body).hexdigest() != expected: raise ValueError('Reviewed PE pin mismatch')
            normal, delayed = imports(body)
            for subset in (normal, delayed):
                for library, symbols in subset.items(): combined.setdefault(library, set()).update(symbols)
            provenance.append({'path': name, 'sha256': expected, 'imports': normal, 'delay_imports': delayed})
    if any(name in combined for name in ('ue4ss.dll', 'starruptureservereos-win64-shipping.exe')):
        raise ValueError('Manifest attempts to load game/UE4SS')
    result = {'schema': 1, 'source_commit': '8333063595fa3c49ad307f3b0f732accbb760d25',
              'archive_sha256': ARCHIVE_SHA, 'inspected_pe_files': provenance,
              'imports': {name: sorted(symbols) for name, symbols in sorted(combined.items())},
              'native_compatibility_verified': False}
    output = Path(__file__).with_name('imports.json')
    output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'libraries': len(combined), 'unique_exports': sum(map(len, combined.values())),
                      'delay_libraries': sum(len(row['delay_imports']) for row in provenance)}))


if __name__ == '__main__': main()
