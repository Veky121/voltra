#!/usr/bin/env python3
"""MIT. Deterministic fixed-table generation; no runtime paths or execution."""
import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
EXPECTED = 'e911e1824b3920133026103f05a8718e0884869ed60584251fcded775fd1df68'


def request(name):
    if not re.fullmatch(r'[a-z0-9._-]+\.dll', name) or name in ('ue4ss.dll', 'dwmapi.dll'):
        raise ValueError('Not an approved system dependency name')
    return name if name.startswith(('api-', 'ext-')) else 'C:\\windows\\system32\\' + name


def ordinal(symbol):
    if symbol.startswith('#'):
        if not re.fullmatch(r'#[1-9][0-9]*', symbol) or not 1 <= int(symbol[1:]) <= 65535:
            raise ValueError('Invalid ordinal')
        return int(symbol[1:])
    if not symbol or len(symbol) > 4096 or any(not 33 <= ord(c) <= 126 for c in symbol):
        raise ValueError('Invalid export')
    return 0


def generate():
    raw = (HERE / 'imports.json').read_bytes()
    if hashlib.sha256(raw).hexdigest() != EXPECTED: raise ValueError('Immutable reviewed manifest differs')
    manifest = json.loads(raw)['imports']
    if len(manifest) != 29 or sum(map(len, manifest.values())) != 655: raise ValueError('Coverage mismatch')
    rows = ['/* MIT. Generated only from pinned public PE import manifest. */']
    libraries = []
    for index, (name, symbols) in enumerate(sorted(manifest.items())):
        rows.append('static const ProbeExport exports_%d[] = {' % index)
        for symbol in symbols:
            if len('MISSING_RUNTIME_EXPORT ' + name + ':' + symbol + '\n') >= 512: raise ValueError('Output bound')
            rows.append('    {%s, %d},' % (json.dumps(symbol), ordinal(symbol)))
        rows.append('};')
        libraries.append('    {%s, L%s, exports_%d, %d},' % (json.dumps(name), json.dumps(request(name)), index, len(symbols)))
    rows.append('static const ProbeLibrary probe_libraries[] = {')
    rows.extend(libraries)
    rows.extend(['};', '#define PROBE_LIBRARY_COUNT 29', ''])
    body = '\n'.join(rows)
    (HERE / 'imports.h').write_text(body, encoding='ascii')
    return body


if __name__ == '__main__':
    body = generate()
    print(json.dumps({'libraries': 29, 'exports': 655, 'header_sha256': hashlib.sha256(body.encode()).hexdigest()}))
