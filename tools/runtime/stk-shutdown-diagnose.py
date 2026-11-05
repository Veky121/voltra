"""Offline STK evidence review. Never starts games or sends packets.

--fetch-sources retrieves small primary-source text only, never game assets.
"""
import argparse
import hashlib
import json
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/stk-shutdown-sources'
BASE = 'https://raw.githubusercontent.com/supertuxkart/stk-code/1.5/'
SOURCES = {name: BASE + path for name, path in {
    'stk_host.cpp': 'src/network/stk_host.cpp',
    'network_console.cpp': 'src/network/network_console.cpp',
    'network_string.cpp': 'src/network/network_string.cpp',
    'main.cpp': 'src/main.cpp',
}.items()}


def discovery_request():
    return b'\x0astk-server'


def decode_command(packet):
    if not packet or packet[0] > len(packet) - 1:
        raise ValueError('getString out of range')
    return packet[1:1 + packet[0]].decode('ascii')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def inspect_archive(path):
    # Read publisher launcher and ELF metadata only. No extraction or execution.
    receipt = json.loads((ROOT / '.local/game-parity-20261029/stk/publisher-receipt.json').read_text())
    with path.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    if actual != receipt['sha256']:
        raise ValueError('archive hash differs from pinned publisher receipt')
    result = {'path': str(path.relative_to(ROOT)), 'sha256': actual, 'members': {}}
    with tarfile.open(path, 'r:*') as archive:
        for relative in ('run_game.sh', 'bin/supertuxkart', 'lib/libsqlite3.so.3'):
            name = receipt['prefix'] + '/' + relative
            member = archive.getmember(name)
            entry = {'size': member.size, 'type': member.type.decode('ascii'), 'linkname': member.linkname}
            if member.isfile():
                data = archive.extractfile(member).read()
                entry['sha256'] = digest(data)
                if relative in receipt['files'] and entry['sha256'] != receipt['files'][relative]:
                    raise ValueError('publisher member mismatch: ' + relative)
                if relative == 'run_game.sh':
                    (OUT / 'publisher-run_game.sh').write_bytes(data)
                    entry['text_receipt'] = str((OUT / 'publisher-run_game.sh').relative_to(ROOT))
                if relative == 'bin/supertuxkart':
                    entry['elf_magic'] = data[:4].hex()
                    entry['elf_class'] = data[4]
                    entry['elf_machine'] = int.from_bytes(data[18:20], 'little')
            result['members'][relative] = entry
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fetch-sources', action='store_true')
    parser.add_argument('--archive', type=Path)
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    receipts = []
    for name, url in SOURCES.items():
        target = OUT / name
        if args.fetch_sources:
            with urllib.request.urlopen(url, timeout=30) as response:
                data = response.read(2 * 1024 * 1024 + 1)
            if len(data) > 2 * 1024 * 1024:
                raise ValueError('source response oversized')
            target.write_bytes(data)
        if target.exists():
            receipts.append({'url': url, 'path': str(target.relative_to(ROOT)),
                             'sha256': digest(target.read_bytes())})
    result = {'source_receipts': receipts, 'request_hex': discovery_request().hex(),
              'sockets_opened': False, 'game_started': False}
    if args.archive:
        result['archive'] = inspect_archive(args.archive.resolve())
    (OUT / 'receipts.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
