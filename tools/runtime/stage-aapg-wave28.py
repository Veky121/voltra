"""Generate only the exact AAPG fragment; never edit canonical overrides."""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RECIPE = 'americas_army/proving_grounds/egg-america-s-army--proving-grounds.json'
OUT = ROOT / 'artifacts/game-parity-20261029/wave28-aapg'

def stage():
    profile = copy.deepcopy(json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text(encoding='utf-8-sig'))[RECIPE])
    wrapper = (ROOT/'internal/panel/game_library/scripts/aapg-runtime.py').read_text(encoding='utf-8-sig')
    profile['egg']['startup'] = profile['egg']['startup'].replace('tactical_next_runtime.py', 'aapg_runtime.py')
    profile['egg']['scripts']['installation']['script'] += "\ncat > .voltra/aapg_runtime.py <<'VOLTRA_AAPG_WAVE28'\n" + wrapper + "\nVOLTRA_AAPG_WAVE28\n"
    profile['settings_documents'] = ['AAGame/Config/PCServerLinux-AAGame.ini']
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT/'recipe-fragment.json').write_text(json.dumps({RECIPE:profile},indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':stage()
