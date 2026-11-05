"""Read-only packaging audit. Static candidates require review, not acceptance."""
import ast
import hashlib
import json
from pathlib import Path, PurePosixPath
import re

ROOT = Path(__file__).resolve().parents[2]
CANONICAL = ROOT / 'internal/panel/game_library/overrides.json'
OUT = ROOT / 'artifacts/game-parity-20261029/installed-python-layout-audit.json'
FIRST_PARTY = {
    p.stem.replace('-', '_')
    for p in (ROOT / 'internal/panel/game_library/scripts').glob('*.py')
}
# Match only quoted, literal heredocs. No shell expansion or game code runs.
HEREDOC = re.compile(
    r"cat\s*>\s*(?:\"([^\"\n]+\.py)\"|'([^'\n]+\.py)'|([^\s\n]+\.py))"
    r"\s*<<'([^'\n]+)'\r?\n([\s\S]*?)\r?\n\4(?:\r?\n|$)"
)


def inspect_profile(recipe, profile):
    script = profile.get('egg', {}).get('scripts', {}).get('installation', {}).get('script', '')
    embedded = [((m[1] or m[2] or m[3]), m[5]) for m in HEREDOC.finditer(script)]
    targets = {PurePosixPath(name) for name, _ in embedded}
    candidates = []
    for filename, body in embedded:
        target = PurePosixPath(filename)
        try:
            # CPython accepts an UTF-8 BOM in an actual source file. Parsing a
            # Unicode string would incorrectly flag those valid emitted files.
            tree = ast.parse(body.encode('utf-8'))
        except SyntaxError as error:
            candidates.append({'file': filename, 'line': error.lineno,
                               'kind': 'python_syntax', 'detail': str(error)})
            continue
        siblings = {p.name for p in targets if p.parent == target.parent}
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == 'with_name' and node.args
                    and isinstance(node.args[0], ast.Constant)
                    and isinstance(node.args[0].value, str)):
                name = node.args[0].value
                if name.endswith('.py') and name not in siblings:
                    candidates.append({'file': filename, 'line': node.lineno,
                                       'kind': 'literal_sibling_not_embedded', 'name': name,
                                       'note': 'May have a guarded fallback or be supplied elsewhere. Inspect before fixing.'})
            names = []
            if isinstance(node, ast.Import):
                names = [alias.name.split('.')[0] for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and not node.level and node.module:
                names = [node.module.split('.')[0]]
            for name in names:
                if name in FIRST_PARTY and name + '.py' not in siblings:
                    candidates.append({'file': filename, 'line': node.lineno,
                                       'kind': 'first_party_module_not_sibling', 'name': name,
                                       'note': 'Review sys.path setup, aliases and staged dependency acquisition.'})
    return {'recipe': recipe, 'embedded_python_count': len(embedded),
            'status': 'review_required' if candidates else 'no_static_candidate',
            'candidates': candidates}


if __name__ == '__main__':
    before = CANONICAL.read_bytes()
    profiles = json.loads(before)
    rows = [inspect_profile(recipe, profile) for recipe, profile in profiles.items()]
    if CANONICAL.read_bytes() != before:
        raise RuntimeError('Canonical source changed during audit; rerun on stable inputs')
    result = {
        'scope': 'Static emitted-Python layout only; no shell/game/import execution',
        'canonical_sha256': hashlib.sha256(before).hexdigest(),
        'profiles': len(rows),
        'embedded_python_count': sum(row['embedded_python_count'] for row in rows),
        'review_required_profiles': sum(bool(row['candidates']) for row in rows),
        'python_syntax_candidates': sum(candidate['kind'] == 'python_syntax'
                                        for row in rows for candidate in row['candidates']),
        'limitations': [
            'No game installation, boot, settings, lifecycle or browser acceptance',
            'No candidates does not prove import success',
            'Fallback branches, sys.path changes and acquired dependencies require manual review',
            'Only literal quoted heredocs are inspected; dynamically generated files are not proven',
        ],
        'rows': rows,
        'runtime_mutations': 0,
    }
    OUT.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: result[k] for k in (
        'profiles', 'embedded_python_count', 'review_required_profiles', 'runtime_mutations')}))
