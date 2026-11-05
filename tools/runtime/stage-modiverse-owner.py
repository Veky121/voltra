"""Offline exact-profile staging only. No shared writes or runtime commands."""
import ast
import copy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/modiverse-owner'
BASE = ROOT / 'internal/panel/game_library/scripts'
RECIPE = 'modiverse/egg-modiverse.json'

def stage():
    OUT.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((ROOT/'internal/panel/game_library/upstream/catalog.json').read_text())
    original = next(e for e in catalog['entries'] if e['path'] == RECIPE)
    current = json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text(encoding='utf-8-sig'))[RECIPE]
    if current.get('revision','').startswith('wave15-'):
        current = json.loads((ROOT/'artifacts/game-parity-20261029/root-wave15-source-integration/baseline-overrides.json').read_text(encoding='utf-8-sig'))[RECIPE]
    profile = copy.deepcopy(current)
    egg = profile['egg']
    assert egg['variables'][:len(original['egg']['variables'])] == original['egg']['variables']
    sources = {'modiverse_owner.py': ROOT/'tools/runtime/modiverse-owner.py'}
    queue = list(sources)
    while queue:
        name = queue.pop()
        tree = ast.parse(sources[name].read_text(encoding='utf-8-sig'))
        for node in ast.walk(tree):
            modules = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module] if isinstance(node, ast.ImportFrom) else []
            for module in modules:
                if not module:
                    continue
                target = module + '.py'
                source = BASE / (module.replace('_', '-') + '.py')
                if target not in sources and source.exists():
                    sources[target] = source
                    queue.append(target)
    payloads = {name:path.read_text(encoding='utf-8-sig') for name,path in sources.items()}
    payloads['modiverse_seed.json'] = (BASE/'sandbox-servers-modiverse-seed.json').read_text()
    script = '#!/bin/bash\nset -euo pipefail\ncd /mnt/server\n'
    # Python/image prerequisites precede filesystem writes. No package acquisition here.
    script += 'python3 -c "import sys; assert sys.version_info >= (3, 9)"\n'
    script += 'stage=$(mktemp -d)\ntrap \'rm -rf -- "$stage"\' EXIT\n'
    for name, data in payloads.items():
        script += 'cat > "$stage/'+name+'" <<\'VOLTRA_MODIVERSE_SOURCE\'\n'+data+"\nVOLTRA_MODIVERSE_SOURCE\n"
    script += 'python3 "$stage/modiverse_owner.py" preflight\n'
    script += 'python3 "$stage/modiverse_owner.py" install\nmkdir -p .voltra\ncp -- "$stage/"* .voltra/\n'
    egg['startup'] = 'exec python3 .voltra/modiverse_owner.py run'
    egg['scripts']['installation']['script'] = script
    profile.update(revision='modiverse-owner-source-v2', platforms=['linux/amd64'], verification='not_verified')
    (OUT/'profile.pending.json').write_text(json.dumps({RECIPE:profile},indent=2)+'\n')
    (OUT/'emitted-payloads.json').write_text(json.dumps(payloads,indent=2)+'\n')
    hashes = {str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in sources.values()}
    for path in (ROOT/'artifacts/sandbox-servers-source-acceptance.json', BASE/'sandbox-servers-modiverse-seed.json', ROOT/'internal/panel/game_library/overrides.json'):
        hashes[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
    (OUT/'source-hashes.json').write_text(json.dumps(hashes,indent=2)+'\n')
    return payloads

if __name__ == '__main__':
    print('Staged', len(stage()), 'payloads; shared sources untouched')
