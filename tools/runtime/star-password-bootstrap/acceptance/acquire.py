"""MIT. One approved anonymous Windows acquisition, no game execution.

Mounted only in a fresh owned nonroot fixture. Uses shared Steam update/manifest
verification and never synthesizes Steam identity, encrypted files or worlds.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


def verify_manifest(body, shared):
    expected = {'3809401': '3659990775896995763', '228989': '5753583882400741046'}
    if re.findall(r'"SharedDepots"\s*\{\s*"228989"\s*"([0-9]+)"\s*\}', body) != ['228980']:
        raise ValueError('Shared depot source link differs or is unavailable')
    if re.findall(r'"appid"\s*"([0-9]+)"', shared) != ['228980'] or re.findall(r'"StateFlags"\s*"([0-9]+)"', shared) != ['4']:
        raise ValueError('Actual shared application receipt is incomplete')
    for depot, manifest in expected.items():
        actual = body if depot == '3809401' else shared
        blocks = re.findall(r'"'+depot+r'"\s*\{([^{}]*)\}', actual)
        size = '21349240119' if depot == '3809401' else '25674515'
        if len(blocks) != 1 or re.findall(r'"manifest"\s*"([0-9]+)"', blocks[0]) != [manifest] or re.findall(r'"size"\s*"([0-9]+)"', blocks[0]) != [size]:
            raise ValueError('Installed depot identity differs or is unavailable')
    return expected


def engine_markers(path):
    found, pending = set(), b''
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024**2), b''):
            data = pending + block
            found.update(value.decode('ascii') for value in re.findall(rb'\+\+UE5\+Release-5\.[0-9]{1,2}(?![0-9])', data))
            pending = data[-128:]
    return sorted(found)


def finish(root, steam):
    for relative in ('steamapps/appmanifest_3809400.acf','steamapps/appmanifest_228980.acf',
                     'StarRupture/Binaries/Win64/StarRuptureServerEOS-Win64-Shipping.exe'):
        path = root/relative
        if any(p.is_symlink() for p in (path,*path.parents)) or not path.is_file() or not path.resolve().is_relative_to(root) or path.stat().st_uid != os.geteuid():
            raise ValueError('Installed receipt/payload path is not confined and owned')
        if relative.endswith('.acf') and path.stat().st_size > 1024**2:
            raise ValueError('Installed receipt exceeds bound')
    receipt = steam.manifest(root, 3809400)
    if receipt['buildid'] != 25642172:
        raise ValueError('Installed publisher build drift: no game boot authorized')
    depots = verify_manifest((root/'steamapps/appmanifest_3809400.acf').read_text(),
                             (root/'steamapps/appmanifest_228980.acf').read_text())
    binary = 'StarRupture/Binaries/Win64/StarRuptureServerEOS-Win64-Shipping.exe'
    path = root/binary
    sha = hashlib.sha256()
    with path.open('rb') as stream:
        for part in iter(lambda: stream.read(1024**2), b''): sha.update(part)
    report = {'phase':'installed_no_game_execution','app_id':3809400,'release':receipt,
              'depots':depots,'binary':binary,'binary_bytes':path.stat().st_size,
              'binary_sha256':sha.hexdigest(),'engine_release_markers':engine_markers(path),
              'game_or_loader_executed':False,'microsoft_installer_executed':False}
    with (root/'.voltra/star-acceptance/acquisition.json').open('x') as output:
        output.write(json.dumps(report, indent=2)+'\n')
    print('VOLTRA_STAR_ACQUISITION '+json.dumps(report), flush=True)


def main():
    root = Path('/work')
    assert os.name == 'posix' and os.geteuid() == 988
    assert root.resolve() == root and root.stat().st_uid == 988
    steam = load('star_acquisition_steam', '/shared/steam-template.py')
    if sys.argv[1:] == ['--verify-installed']:
        finish(root, steam)
        return
    if sys.argv[1:]: raise ValueError('Unknown acquisition mode')
    state = root / '.voltra/star-acceptance'; state.mkdir(mode=0o700)
    with (state/'acquisition-attempted').open('x') as marker: marker.write('one anonymous acquisition\n')
    binary = 'StarRupture/Binaries/Win64/StarRuptureServerEOS-Win64-Shipping.exe'
    steam.update(root, 3809400, {'STEAM_USER': 'anonymous', 'WINDOWS_INSTALL': '1'},
                           validate=True, required=(binary,), platform='windows')
    finish(root, steam)


if __name__ == '__main__': main()
