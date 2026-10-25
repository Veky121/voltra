#!/usr/bin/env python3
"""MIT. Read-only inspection of the already cached official UE4SS ZIP; never load it."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[3]
ARCHIVE = ROOT / '.local/palworld-proton-dependencies/UE4SS_v3.0.1.zip'
EXPECTED = '4b47d4bceddd2f561a4e395bfa00924ccfc945af576a2d0c613e6537846c57ec'


def pe(body):
    if body[:2] != b'MZ': raise ValueError('Not a PE image')
    offset = struct.unpack_from('<I', body, 60)[0]
    if body[offset:offset + 4] != b'PE\0\0': raise ValueError('Invalid PE signature')
    machine, sections = struct.unpack_from('<HH', body, offset + 4)
    optional = offset + 24
    if machine != 0x8664 or struct.unpack_from('<H', body, optional)[0] != 0x20b:
        raise ValueError('Expected Windows x64 PE32+')
    table = optional + struct.unpack_from('<H', body, offset + 20)[0]

    def physical(rva):
        for index in range(sections):
            size, start, raw_size, raw = struct.unpack_from('<IIII', body, table + index * 40 + 8)
            if start <= rva < start + max(size, raw_size):
                result = raw + rva - start
                if result >= len(body): break
                return result
        raise ValueError('Invalid PE RVA')

    def cstring(rva):
        start = physical(rva)
        return body[start:body.index(b'\0', start)].decode('ascii')

    imports = []
    rva = struct.unpack_from('<I', body, optional + 120)[0]
    if rva:
        cursor = physical(rva)
        while any(body[cursor:cursor + 20]):
            imports.append(cstring(struct.unpack_from('<I', body, cursor + 12)[0]))
            cursor += 20
    return {'machine': 'AMD64', 'pe_format': 'PE32+', 'imports': imports}


def main():
    raw = ARCHIVE.read_bytes()
    if len(raw) != 5523402 or hashlib.sha256(raw).hexdigest() != EXPECTED:
        raise ValueError('Official cached archive pin mismatch')
    files, binaries = [], {}
    with zipfile.ZipFile(ARCHIVE) as archive:
        if archive.testzip() is not None: raise ValueError('ZIP CRC failure')
        names = set()
        for info in archive.infolist():
            name = PurePosixPath(info.filename.replace('\\', '/'))
            if name.is_absolute() or '..' in name.parts or str(name).casefold() in names:
                raise ValueError('Unsafe or duplicate archive member')
            names.add(str(name).casefold())
            if info.file_size > 32 * 1024**2: raise ValueError('Unexpected member size')
            body = archive.read(info)
            row = {'path': info.filename, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}
            if info.filename in ('UE4SS.dll', 'dwmapi.dll'):
                row['pe'] = pe(body)
                binaries[info.filename] = row
                if info.filename == 'UE4SS.dll':
                    row['required_api_name_strings'] = {name: name.encode() in body for name in (
                        'CallFunction', 'FindAllOf', 'ExecuteInGameThread', 'ExecuteWithDelay', 'IsValid', 'UFunction')}
                    if not all(row['required_api_name_strings'].values()):
                        raise ValueError('Required API name missing from pinned binary')
            files.append(row)
    notice = ROOT / 'tools/runtime/star-password-bootstrap/LICENSES/UE4SS-MIT.txt'
    digest = hashlib.sha256(notice.read_bytes()).hexdigest()
    if digest != 'ddc030e25d0ea87aca4ae84c0ed3f868d69273c00c0c12ea1e26f1c6130f5d2e':
        raise ValueError('Pinned MIT notice mismatch')
    result = {'phase': 'cached_binary_static_inspection_only', 'archive': str(ARCHIVE.relative_to(ROOT)),
              'url': 'https://github.com/UE4SS-RE/RE-UE4SS/releases/download/v3.0.1/UE4SS_v3.0.1.zip',
              'bytes': len(raw), 'sha256': EXPECTED, 'source_commit': 'd935b5b23bac03b65c14ae38382b02007204cc2e',
              'members': files, 'zip_crc_valid': True, 'license': {'name': 'MIT', 'notice_sha256': digest,
              'archive_contains_license_file': any('license' in row['path'].casefold() for row in files),
              'notice_source': 'https://raw.githubusercontent.com/UE4SS-RE/RE-UE4SS/d935b5b23bac03b65c14ae38382b02007204cc2e/LICENSE'},
              'readme_supported_engine_range': 'UE4.12 through UE5.3; not a StarRupture compatibility claim',
              'binary_executed': False, 'new_acquisition': False, 'game_engine_compatibility_verified': False,
              'api_name_presence_is_binding_execution_proof': False}
    target = ROOT / 'artifacts/star-password-bootstrap-loader-inspection.json'
    target.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'sha256': EXPECTED, 'members': len(files), 'binaries': binaries,
                      'native_compatibility_verified': False}, indent=2))


if __name__ == '__main__': main()
