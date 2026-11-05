#!/usr/bin/env python3
"""Fresh, source-only three-recipe proposal. Run with Python in isolated WSL."""
import copy
import difflib
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/wave69-gta-migration'
BASE = ROOT / 'artifacts/game-parity-20261029'
RECIPES = ['gta/altv/egg-alt--v.json', 'gta/ragemp/egg-rage--m-p.json', 'gta/samp/egg-s-a--m-p.json']
CAT = 'internal/panel/game_library/overrides.json'
PATTERN = re.compile(r'''cat\s+>\s*(?:"([^"\r\n]+\.py)"|'([^'\r\n]+\.py)'|([^\s]+\.py))\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\4(?:\r?\n|$)''')

def sha(data):
    return hashlib.sha256(data).hexdigest()

def modules(script):
    return {(m[1] or m[2] or m[3]): m[5] + '\n' for m in PATTERN.finditer(script)}

def main():
    from importlib.util import spec_from_file_location, module_from_spec
    spec = spec_from_file_location('controlled_tests', Path(__file__).with_name('wave69-gta-migration-tests.py'))
    tests = module_from_spec(spec)
    spec.loader.exec_module(tests)
    snapshot = json.loads((BASE / 'root-source-regression-wave68/source-before.json').read_text())
    frozen = {r['path']: r['sha256'] for r in snapshot}
    review = json.loads((BASE / 'helper-copy-review-wave68/review-3/report.json').read_text())
    paths = [CAT, 'tools/runtime/embedded-python.mjs'] + sorted(p for p in frozen if p.startswith('internal/panel/game_library/scripts/'))
    before = {p: sha((ROOT / p).read_bytes()) for p in paths}
    for p, digest in before.items():
        assert frozen[p] == digest, ('green input drift', p)
    catalog = json.loads((ROOT / CAT).read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    result = []
    diffs = []
    all_tests = []
    for recipe in RECIPES:
        original = catalog[recipe]
        proposal = copy.deepcopy(original)
        script = original['egg']['scripts']['installation']['script']
        emitted = modules(script)
        key = next(k for k in emitted if k.endswith('/gta-install.py'))
        body = emitted[key]
        evidence = next(e for e in review['entries'] if e['recipe'] == recipe and e['module'] == 'gta_install')
        assert evidence['classification'] == 'required_fix'
        assert sha(body.encode()) == evidence['bodySHA256']
        needle = "            new.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(old,new);copied.append(old.relative_to(root).as_posix())"
        assert body.count(needle) == 1
        newbody = body.replace(needle, '            if new.exists():continue\n' + needle)
        assert script.count(body.rstrip('\n')) == 1
        staged = script.replace(body.rstrip('\n'), newbody.rstrip('\n'), 1)
        proposal['egg']['scripts']['installation']['script'] = staged
        unchanged = copy.deepcopy(proposal)
        unchanged['egg']['scripts']['installation']['script'] = script
        assert unchanged == original
        after_modules = modules(staged)
        assert after_modules.keys() == emitted.keys()
        assert all(after_modules[k] == emitted[k] for k in emitted if k != key)
        for name, source in after_modules.items():
            compile(source, name, 'exec')
        game = recipe.split('/')[1]
        outcomes = tests.run(game, emitted, after_modules)
        all_tests.extend(outcomes)
        fragment = game + '.pending.json'
        (OUT / fragment).write_text(json.dumps({recipe: proposal}, indent=2) + '\n')
        diffs.extend(difflib.unified_diff(body.splitlines(True), newbody.splitlines(True), fromfile=recipe + ':before/' + key, tofile=recipe + ':pending/' + key))
        result.append({'recipe': recipe, 'fragment': fragment, 'fragment_sha256': sha((OUT / fragment).read_bytes()), 'before_script_sha256': sha(script.encode()), 'after_script_sha256': sha(staged.encode()), 'before_helper_sha256': sha(body.encode()), 'after_helper_sha256': sha(newbody.encode()), 'metadata_equal': True, 'other_helpers_equal': True, 'emitted_modules_compiled': len(after_modules), 'revision_unchanged': proposal['revision']})
    after = {p: sha((ROOT / p).read_bytes()) for p in paths}
    assert before == after
    (OUT / 'source.diff').write_text(''.join(diffs))
    report = {'scope': 'Source-only fresh pending proposal; no canonical adoption', 'checkpoint': 'root-source-regression-wave68/report.json: 4569 pass, 0 fail, 22 skip; frontend 420 pass; historical only', 'inputs': {p: {'before': before[p], 'after': after[p], 'green': frozen[p], 'match': True} for p in paths}, 'recipes': result, 'tests': all_tests, 'counts': {'pass': len(all_tests), 'fail': 0, 'skip': 0}, 'trigger': 'No migration receipt; legacy install_release restores or seeds native config, then actual emitted migrate unconditionally copy2 overwrites it from stale root layout. Before cases assert this defect, after cases assert preservation.', 'original37statuses': 'unknown: not individually revalidated; no status file written and no native acceptance promoted', 'cleanup': 'TemporaryDirectory fixtures removed; no toolkit downloads, game processes, services, Docker, SSH, builds, commits, publication or activation. No commands remain running after driver exit.', 'adoption_contract': 'Pending only. Owner must recheck exact catalog and helper hashes against inputs, merge only these three recipe objects with unchanged revisions and metadata, run integration checks and review source.diff. Do not replace a whole helper from standalone source. No publisher availability or consent resolution.', 'remaining_native_gaps': ['No licensed/operator archive acquired; authorized archive URLs are synthetic .invalid fixtures and publisher is mocked.', 'No native startup, networking, gameplay or runtime acceptance.', 'Destination-exists guard is not a race-safe no-clobber operation. Dangling in-volume target symlink remains a characterized limitation; parent conflicts raise without a receipt. No broader path-hardening change proposed.']}
    (OUT / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'recipes': len(result), 'tests': report['counts'], 'inputs_equal': True, 'report': str(OUT / 'report.json')}))

if __name__ == '__main__':
    main()
