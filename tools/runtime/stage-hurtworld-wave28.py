"""Stage one recipe; never mutate canonical overrides."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RECIPE = 'hurtworld/egg-hurtworld.json'

def stage():
    original = json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())[RECIPE]
    profile = json.loads(json.dumps(original))
    source = (ROOT/'internal/panel/game_library/scripts/hurtworld-wave28.py').read_text()
    script=profile['egg']['scripts']['installation']['script']
    script=re.sub(r"\n?cat > \.voltra/hurtworld-wave28\.py <<'([^']+)'\n[\s\S]*?\n\1\n",'',script)
    block="cat > .voltra/hurtworld-wave28.py <<'VOLTRA_HURTWORLD_W28'\n"+source+"\nVOLTRA_HURTWORLD_W28\n"
    marker='python3 .voltra/steam-native-next.py install hurtworld'
    if script.count(marker)!=1:raise ValueError('Unexpected installer entrypoint')
    profile['egg']['scripts']['installation']['script']=script.replace(marker,block+marker)
    profile['egg']['startup'] = profile['egg']['startup'].replace('steam-native-next.py run hurtworld','hurtworld-wave28.py run')
    profile['revision'] = 'hurtworld-wave28-source-candidate'
    return profile

if __name__ == '__main__':
    directory = ROOT/'artifacts/game-parity-20261029/wave28-hurtworld'
    directory.mkdir(parents=True,exist_ok=True)
    (directory/'recipe.pending.json').write_text(json.dumps({RECIPE:stage()},indent=2)+'\n')
