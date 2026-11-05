"""Source-only pending fragments and controlled Linux publication regression.

Run with WSL python3 -B. Never adopts the proposal or executes a payload.
"""
import copy
import difflib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys
import tarfile
import tempfile
import types
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/wave69-proton-publication'
REVIEW = ROOT / 'artifacts/game-parity-20261029/helper-copy-review-wave68/review-4/report.json'
CAT = ROOT / 'internal/panel/game_library/overrides.json'
PAT = re.compile(r'''cat\s+>\s*(?:"([^"\r\n]+\.py)"|'([^'\r\n]+\.py)'|([^\s]+\.py))\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\4(?:\r?\n|$)''')


def sha(b):
    return hashlib.sha256(b).hexdigest()


def snapshot(root):
    result = {}
    for p in sorted(root.rglob('*')):
        key = str(p.relative_to(root))
        result[key] = ['link', os.readlink(p)] if p.is_symlink() else ['dir'] if p.is_dir() else ['file', p.read_bytes().hex(), p.stat().st_mode]
    return result


def module(body):
    m = types.ModuleType('controlled_proton')
    exec(compile(body, '<exact-emitted-helper>', 'exec'), m.__dict__)
    return m


def exercise(body, candidate):
    results = []
    cases = ['fresh', 'cache', 'cached-install', 'library-link', 'receipt-link', 'unreceipted', 'bad-receipt',
             'voltra-link', 'base-link', 'target-link', 'library-dir-link', 'library-file', 'leaf-directory', 'receipt-directory', 'target-file',
             'dangling-library', 'dangling-receipt', 'bad-bridge', 'base-file', 'voltra-file']
    for case in cases:
        with tempfile.TemporaryDirectory(prefix='wave69-proton-') as tmp:
            workspace = Path(tmp); root = workspace/'volume'; root.mkdir()
            sentinel = workspace/'outside'; sentinel.mkdir(); (sentinel/'sentinel').write_bytes(b'OUTSIDE ORIGINAL')
            m = module(body); base = root/'.voltra/proton'; base.mkdir(parents=True)
            target = base/m.VERSION
            loader = workspace/'loader'; loader.write_bytes(b'synthetic loader bytes')
            m.VULKAN_LIBRARY = loader
            sdk = root/'.steam/sdk64/steamclient.so'; sdk.parent.mkdir(parents=True); sdk.write_bytes(b'SteamUtils011')
            stream = io.BytesIO()
            with tarfile.open(fileobj=stream, mode='w:gz') as archive:
                for name, data in [('proton', b'inert proton'), ('files/lib/wine/x86_64-unix/lsteamclient.so', b'SteamUtils011 inert bridge'), ('LICENSE', b'synthetic license')]:
                    info = tarfile.TarInfo(m.ARCHIVE_ROOT+'/'+name); info.size = len(data); archive.addfile(info, io.BytesIO(data))
            payload = stream.getvalue(); calls = {'acquire': 0, 'extract': 0}
            # Synthetic archive hashes are the only fixture substitution to the pin.
            # Original constants are recorded separately and candidate must retain them.
            m.SHA256 = sha(payload); m.SHA512 = hashlib.sha512(payload).hexdigest()
            class Response(io.BytesIO):
                def geturl(self): return 'https://fixture.invalid/archive'
            def acquire(*args, **kwargs):
                calls['acquire'] += 1
                return Response(payload)
            original_unpack = m.unpack
            def unpack(*args):
                calls['extract'] += 1
                return original_unpack(*args)
            m.unpack = unpack
            if case == 'cache':
                cache = root/'.voltra/public-cache'/m.SHA256; cache.parent.mkdir(); cache.write_bytes(payload)
            if case in ('cached-install', 'bad-receipt', 'bad-bridge'):
                bridge = target/'files/lib/wine/x86_64-unix/lsteamclient.so'; bridge.parent.mkdir(parents=True)
                bridge.write_bytes(b'SteamUtils011 installed'); (target/'proton').write_bytes(b'inert installed')
                (base/'release.json').write_text(json.dumps({'sha512': m.SHA512 if case != 'bad-receipt' else 'wrong', 'bridge_sha256': 'wrong' if case == 'bad-bridge' else sha(bridge.read_bytes())}))
            if case == 'unreceipted': target.mkdir(); (target/'keep').write_bytes(b'keep')
            if case == 'target-file': target.write_bytes(b'keep')
            if case == 'library-link':
                (base/'lib').mkdir(); (base/'lib/libvulkan.so.1').symlink_to(sentinel/'sentinel')
            if case == 'receipt-link': (base/'release.json').symlink_to(sentinel/'sentinel')
            if case == 'dangling-library':
                (base/'lib').mkdir(); (base/'lib/libvulkan.so.1').symlink_to(sentinel/'missing')
            if case == 'dangling-receipt': (base/'release.json').symlink_to(sentinel/'missing')
            if case == 'target-link': target.symlink_to(sentinel, target_is_directory=True)
            if case == 'library-dir-link': (base/'lib').symlink_to(sentinel, target_is_directory=True)
            if case == 'library-file': (base/'lib').write_bytes(b'keep')
            if case == 'leaf-directory': (base/'lib/libvulkan.so.1').mkdir(parents=True)
            if case == 'receipt-directory': (base/'release.json').mkdir()
            if case in ('base-link', 'voltra-link'):
                base.rmdir()
                if case == 'base-link': base.symlink_to(sentinel, target_is_directory=True)
                else:
                    (root/'.voltra').rmdir(); (root/'.voltra').symlink_to(sentinel, target_is_directory=True)
            if case in ('base-file', 'voltra-file'):
                base.rmdir()
                if case == 'base-file': base.write_bytes(b'keep')
                else:
                    (root/'.voltra').rmdir(); (root/'.voltra').write_bytes(b'keep')
            before = snapshot(workspace); error = None
            with patch('urllib.request.urlopen', acquire), patch('subprocess.Popen', side_effect=AssertionError('process forbidden')), patch('os.system', side_effect=AssertionError('shell forbidden')):
                try: m.provision(root)
                except (ValueError, OSError, json.JSONDecodeError) as exc: error = type(exc).__name__+': '+str(exc)
            after = snapshot(workspace)
            if case in ('fresh', 'cache', 'cached-install'):
                assert error is None, (case, error)
                if case == 'cached-install': assert before == after and calls == {'acquire': 0, 'extract': 0}
                else:
                    assert (base/'lib/libvulkan.so.1').read_bytes() == loader.read_bytes()
                    assert (target/'LICENSE').read_bytes() == b'synthetic license'
                    assert calls == {'acquire': int(case != 'cache'), 'extract': 1}
            elif candidate:
                assert error and before == after and calls == {'acquire': 0, 'extract': 0}, (case, error, calls)
            elif case in ('library-link', 'receipt-link'):
                assert error is None and (sentinel/'sentinel').read_bytes() != b'OUTSIDE ORIGINAL' and calls == {'acquire': 1, 'extract': 1}
            elif case == 'unreceipted':
                assert error and before == after and calls == {'acquire': 1, 'extract': 1}
            results.append({'case': case, 'candidate': candidate, 'error': error, 'calls': calls, 'complete_fixture_unchanged': before == after, 'before': before, 'after': after})
    return results


def main():
    assert sys.platform == 'linux', 'Run in isolated WSL only'
    review = json.loads(REVIEW.read_text()); original = json.loads(CAT.read_bytes())
    checkpoint = json.loads((ROOT/'artifacts/game-parity-20261029/root-source-regression-wave68/source-before.json').read_text())
    expected = {x['path']: x['sha256'] for x in checkpoint}
    paths = list(review['input_hashes'])
    before = {p: sha((ROOT/p).read_bytes()) for p in paths}
    for p, actual in before.items(): assert actual == expected[p], (p, actual, expected[p])
    entries = [e for e in review['entries'] if e['classification'] == 'required_fix']; assert len(entries) == 11
    current = (ROOT/'internal/panel/game_library/scripts/enshrouded-proton.py').read_text()
    block = current[current.index('    # Refuse every publication path'):current.index('    if receipt.is_file() and target.is_dir():')]
    # Extend the same preflight to invalid types and internal ancestor links.
    block += "    for path in (root/'.voltra', base, target, library):\n        if path.is_symlink() or (path.exists() and not path.is_dir()):raise ValueError('Invalid Proton publication directory')\n    for path in (library/'libvulkan.so.1', receipt):\n        if path.exists() and not path.is_file():raise ValueError('Invalid Proton publication file')\n\n"
    pending = {}; groups = {}; diffs = []; hashes = []
    for e in entries:
        key = e['recipe']; entry = copy.deepcopy(original[key]); script = entry['egg']['scripts']['installation']['script']
        matches = [m for m in PAT.finditer(script) if (m[1] or m[2] or m[3]) == e['emitted_path']]; assert len(matches) == 1
        match = matches[0]; body = match[5]+'\n'; assert sha(body.encode()) == e['bodySHA256']
        anchor = '    if receipt.is_file() and target.is_dir():'; assert body.count(anchor) == 1
        new = body.replace(anchor, block+anchor, 1)
        assert new.replace(block, '', 1) == body
        for constant in ('VERSION', 'ARCHIVE_ROOT', 'SHA256', 'SHA512', 'URL'):
            assert getattr(module(body), constant) == getattr(module(new), constant)
        entry['egg']['scripts']['installation']['script'] = script[:match.start(5)]+new[:-1]+script[match.end(5):]
        restored = copy.deepcopy(entry); restored['egg']['scripts']['installation']['script'] = script; assert restored == original[key]
        old_modules = [(m[1] or m[2] or m[3], m[5]) for m in PAT.finditer(script)]
        new_modules = [(m[1] or m[2] or m[3], m[5]) for m in PAT.finditer(entry['egg']['scripts']['installation']['script'])]
        assert len(old_modules) == len(new_modules)
        for old, updated in zip(old_modules, new_modules):
            assert old[0] == updated[0]
            if old[0] != e['emitted_path']: assert old == updated
        pending[key] = entry
        group = groups.setdefault(e['bodySHA256'], {'recipes': [], 'body': body, 'new': new})
        assert group['body'] == body; group['recipes'].append(key)
        diffs.extend(difflib.unified_diff(body.splitlines(True), new.splitlines(True), fromfile=key+':before', tofile=key+':pending'))
        hashes.append({'recipe': key, 'alias': e['emitted_path'], 'before': sha(body.encode()), 'after': sha(new.encode()), 'entry_before': sha(json.dumps(original[key], sort_keys=True).encode()), 'entry_after': sha(json.dumps(entry, sort_keys=True).encode())})
    tests = []
    for digest, group in groups.items():
        tests.append({'old_hash': digest, 'recipes': group['recipes'], 'original_constants': {k: getattr(module(group['body']), k) for k in ('VERSION', 'SHA256', 'SHA512', 'URL')}, 'tests': exercise(group['body'], False)+exercise(group['new'], True)})
    after = {p: sha((ROOT/p).read_bytes()) for p in paths}; assert before == after
    OUT.mkdir(exist_ok=True)
    (OUT/'recipes.pending.json').write_text(json.dumps(pending, indent=2)+'\n')
    (OUT/'helpers.diff').write_text(''.join(diffs))
    report = {'outcome': 'passed', 'inputs_before': before, 'inputs_after': after, 'recipe_hashes': hashes, 'groups': tests, 'passed': sum(len(g['tests']) for g in tests), 'failures': 0, 'skips': [], 'original37statuses': 'unchanged in canonical catalog; historical external status files unknown and untouched', 'cleanup': 'All TemporaryDirectory fixtures removed; no game/process/download/service/publisher execution. No commands remain running.', 'adoption_contract': 'Pending only. Integrator must verify canonical input hashes and merge exactly these eleven entries; only selected helper insertion changes. All other bodies, aliases, pins, revisions and nonscript metadata preserved. No canonical adoption performed.', 'native_gaps': 'No native Proton/Wine/library/game execution, acquisition, desktop, browser or gameplay acceptance. No historical status promotion.', 'trigger_repro': 'Valid synthetic tar, Vulkan loader and SteamUtils011 SDK allow old provision to follow library/receipt leaf symlinks outside temporary volume; old unreceipted target acquires and extracts before refusal. Candidate refuses all invalid paths/types and rollback mismatches before either boundary.', 'fixture_contract': 'Exact actual emitted source compiled/imported as inert modules. Synthetic archive replaces hash constants only in temporary module objects. HTTPS acquisition mocked; real bounded unpack runs on synthetic bytes. No real /home/container access. Complete fixture bytes, modes and path/link sets recorded for refusals.'}
    (OUT/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'passed': report['passed'], 'groups': len(groups), 'entries': len(pending), 'output': str(OUT)}))


if __name__ == '__main__': main()
