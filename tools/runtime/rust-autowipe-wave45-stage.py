"""Source-only exact autowipe staging. Never writes the canonical catalog."""
import copy
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
RECIPE = 'rust/rust_autowipe/egg-rust-autowipe.json'
OUT = ROOT/'artifacts/game-parity-20261029/wave45-rust_autowipe'

def stage():
    canonical = json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())
    profile = copy.deepcopy(canonical[RECIPE])
    script = profile['egg']['scripts']['installation']['script']
    pattern = r"(cat > .voltra/rust_install.py <<'VOLTRA_SOURCE'\n)(.*?)(\nVOLTRA_SOURCE\n)"
    helper = (ROOT/'internal/panel/game_library/scripts/rust-install.py').read_text()
    script, count = re.subn(pattern, lambda m: m[1]+helper+m[3], script, flags=re.S)
    if count != 1: raise ValueError('Expected exactly one emitted rust_install.py')
    profile['egg']['scripts']['installation']['script'] = script
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT/'profiles.json').write_text(json.dumps({RECIPE:profile}, indent=2)+'\n', newline='\n')
    return canonical, profile

if __name__ == '__main__':
    stage()
