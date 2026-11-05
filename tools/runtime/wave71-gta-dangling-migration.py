"""Stage a narrow dangling-destination preservation follow-up; no canonical writes."""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'artifacts/game-parity-20261029'
OUT = BASE / 'wave71-gta-dangling-migration'
PATTERN = re.compile(r"cat\s+>\s*(?:\"([^\"\r\n]+\.py)\"|'([^'\r\n]+\.py)'|([^\s]+\.py))\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\4(?:\r?\n|$)")
sha = lambda data: hashlib.sha256(data).hexdigest()

def function(body):
    tree = ast.parse(body)
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'migrate')
    scope = {'json': json, 'shutil': shutil}
    exec(compile(ast.Module(body=[node], type_ignores=[]), '<exact emitted migrate>', 'exec'), scope)
    return scope['migrate']

def check(fn, game, dangling):
    with tempfile.TemporaryDirectory(prefix='voltra-migration-link-') as tmp:
        root = Path(tmp)
        (root / '.voltra' / game).mkdir(parents=True)
        (root / game).mkdir()
        old = root / 'server.cfg'
        old.write_bytes(b'legacy\r\n')
        destination = root / game / old.name
        target = root / 'operator-missing.cfg'
        destination.symlink_to(target)
        fn(root, game, [old.name])
        assert destination.is_symlink()
        assert target.exists() is not dangling
        assert old.read_bytes() == b'legacy\r\n'
        if dangling:
            receipt = json.loads((root / '.voltra' / game / 'legacy-layout-imported.json').read_text())
            assert receipt['copied'] == []

def ordinary(fn, game, existing):
    with tempfile.TemporaryDirectory(prefix='voltra-migration-ordinary-') as tmp:
        root = Path(tmp)
        (root / '.voltra' / game).mkdir(parents=True)
        (root / game).mkdir()
        (root / 'server.cfg').write_bytes(b'legacy\r\n')
        destination = root / game / 'server.cfg'
        if existing:
            destination.write_bytes(b'operator\r\n')
            destination.chmod(0o640)
        fn(root, game, ['server.cfg'])
        assert destination.read_bytes() == (b'operator\r\n' if existing else b'legacy\r\n')
        if existing:
            assert destination.stat().st_mode & 0o777 == 0o640
        first = (root / '.voltra' / game / 'legacy-layout-imported.json').read_bytes()
        fn(root, game, ['server.cfg'])
        assert (root / '.voltra' / game / 'legacy-layout-imported.json').read_bytes() == first

def emitted_checks(script, before, after, game):
    with tempfile.TemporaryDirectory(prefix='voltra-migration-emitted-') as tmp:
        directory = Path(tmp)
        for match in PATTERN.finditer(script):
            name = Path(match[1] or match[2] or match[3]).name
            (directory / name).write_text(match[5] + '\n')
        target = directory / 'gta-install.py'
        for label, body in [('before', before), ('after', after)]:
            target.write_text(body)
            spec = importlib.util.spec_from_file_location('migration_' + game + '_' + label, target)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            check(module.migrate, game, label == 'after')
            if label == 'after':
                ordinary(module.migrate, game, True)
                ordinary(module.migrate, game, False)

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    proposals = {}
    retained_outcomes = []
    harness_path = ROOT / 'tools/runtime/wave69-gta-migration-tests.py'
    harness_source = harness_path.read_text()
    old_assertion = "assert (r / 'missing-referent').read_bytes() == b'stale-root'"
    assert harness_source.count(old_assertion) == 1
    harness_source = harness_source.replace(old_assertion, "assert (r / game / config).is_symlink() and not (r / 'missing-referent').exists()")
    harness_source = harness_source.replace('after:known-limit-dangling-in-volume-symlink-follows-copy2', 'after:dangling-in-volume-symlink-preserved')
    harness = {'__file__': str(harness_path), '__name__': 'wave71_retained_migration_fixtures'}
    exec(compile(harness_source, str(harness_path), 'exec'), harness)
    for game in ['altv', 'ragemp', 'samp']:
        source = BASE / 'wave69-gta-migration' / (game + '.pending.json')
        original = json.loads(source.read_text())
        recipe, profile = next(iter(original.items()))
        proposal = copy.deepcopy(profile)
        script = profile['egg']['scripts']['installation']['script']
        match = next(m for m in PATTERN.finditer(script) if (m[1] or m[2] or m[3]).endswith('/gta-install.py'))
        before = match[5] + '\n'
        tree = ast.parse(before)
        migrate = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'migrate')
        lines = before.splitlines(keepends=True)
        segment = ''.join(lines[migrate.lineno - 1:migrate.end_lineno])
        assert segment.count('if new.exists():continue') == 1
        patched = segment.replace('if new.exists():continue', 'if new.exists() or new.is_symlink():continue')
        after = ''.join(lines[:migrate.lineno - 1]) + patched + ''.join(lines[migrate.end_lineno:])
        check(function(before), game, False)
        check(function(after), game, True)
        emitted_checks(script, before, after, game)
        emitted = {(m[1] or m[2] or m[3]): m[5] + '\n' for m in PATTERN.finditer(script)}
        installer_key = next(name for name in emitted if name.endswith('/gta-install.py'))
        baseline_modules = dict(emitted)
        assert before.count('            if new.exists():continue\n') == 1
        baseline_modules[installer_key] = before.replace('            if new.exists():continue\n', '')
        candidate_modules = dict(emitted)
        candidate_modules[installer_key] = after
        retained_outcomes.extend(harness['run'](game, baseline_modules, candidate_modules))
        proposal['egg']['scripts']['installation']['script'] = script[:match.start(5)] + after[:-1] + script[match.end(5):]
        proposals[recipe] = proposal
        rows.append({'recipe': recipe, 'input_sha256': sha(source.read_bytes()), 'helper_before_sha256': sha(before.encode()), 'helper_after_sha256': sha(after.encode()), 'old_followed_dangling_link': True, 'candidate_preserved_dangling_link': True})
    (OUT / 'recipes.pending.json').write_text(json.dumps(proposals, indent=2) + '\n')
    assert len(retained_outcomes) == 48
    report = {'scope': 'source-only emitted helper and retained actual legacy install-call fixtures with publisher boundary mocked; full installer shell not exercised', 'checks_passed': 66, 'retained_fixture_outcomes': retained_outcomes, 'retained_harness_sha256': sha(harness_path.read_bytes()), 'harness_adjustment': 'Only the known dangling-link expectation and label are changed in memory; historical harness unchanged.', 'recipes': rows, 'canonical_modified': False, 'historical_statuses_modified': False, 'limitations': ['Existence check is not a race-safe no-clobber publication primitive.', 'Stage only the changed migrate helper body after wave70 consolidation, retaining independent writer fixes.', 'Full installer shell and native lifecycle verification remain pending.'], 'cleanup': 'Temporary fixtures removed by TemporaryDirectory.'}
    (OUT / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'checks_passed': 66, 'recipes': len(rows), 'canonical_modified': False}))

if __name__ == '__main__':
    main()
