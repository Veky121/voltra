import hashlib
import json
from pathlib import Path
import re

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / 'artifacts/game-parity-20261029/wave27-aloft-save-path'
RECIPE = 'aloft/egg-aloft.json'

def stage():
    original = json.loads((REPO / 'internal/panel/game_library/overrides.json').read_text())[RECIPE]
    profile = json.loads(json.dumps(original))
    hashes = {}
    sources = REPO / 'internal/panel/game_library/scripts'
    aliases = {'aloft_parity_wave2.py': 'aloft-preflight.py'}
    def replace(match):
        name, delimiter, old = match.groups()
        leaf = Path(name).name
        source = sources / aliases.get(leaf, leaf.replace('_', '-'))
        if not source.is_file():
            raise ValueError('Unknown emitted helper: ' + leaf)
        raw = source.read_bytes()
        body = raw.decode().replace('\r\n', '\n').rstrip('\n')
        if '\n' + delimiter in body:
            raise ValueError('Unsafe heredoc delimiter')
        hashes[str(source.relative_to(REPO))] = hashlib.sha256(raw).hexdigest()
        return f"cat > {name} <<'{delimiter}'\n{body}\n{delimiter}\n"
    script, count = re.subn(r"cat > ([^ ]+) <<'([^']+)'\n(.*?)\n\2(?:\n|$)", replace, profile['egg']['scripts']['installation']['script'], flags=re.S)
    if count != 7 or '.voltra/aloft_parity_wave2.py run aloft' not in profile['egg']['startup']:
        raise ValueError('Unexpected exact recipe installer/startup')
    profile['egg']['scripts']['installation']['script'] = script
    assert profile['egg']['variables'] == original['egg']['variables']
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'profile-fragment.json').write_text(json.dumps({RECIPE: profile}, indent=2) + '\n')
    (OUT / 'helper-hashes.json').write_text(json.dumps(hashes, indent=2) + '\n')
    return profile

if __name__ == '__main__':
    stage()
