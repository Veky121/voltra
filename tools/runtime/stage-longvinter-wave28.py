"""Stage one exact recipe; never modifies canonical overrides."""
import json,re
from pathlib import Path
KEY='longvinter/egg-longvinter.json'
OUT=Path('artifacts/game-parity-20261029/wave28-longvinter')
def stage():
    OUT.mkdir(parents=True,exist_ok=True)
    p=json.loads(Path('internal/panel/game_library/overrides.json').read_text())[KEY]
    source=Path('internal/panel/game_library/scripts/longvinter-wave28.py').read_text()
    script=p['egg']['scripts']['installation']['script']
    script=re.sub(r"\n?cat > \.voltra/longvinter_wave28\.py <<'([^']+)'\n[\s\S]*?\n\1\n",'',script)
    p['egg']['scripts']['installation']['script'] = script+"\ncat > .voltra/longvinter_wave28.py <<'VOLTRA_LONGVINTER_W28'\n"+source+"\nVOLTRA_LONGVINTER_W28\n"
    startup=p['egg']['startup']
    p['egg']['startup']=re.sub(r'\.voltra/(?:unreal_building|longvinter_wave28)\.py(?: run(?: longvinter)?)?$', '.voltra/longvinter_wave28.py run',startup)
    if p['egg']['startup']==startup and not startup.endswith('.voltra/longvinter_wave28.py run'):raise ValueError('Unexpected canonical startup')
    (OUT/'recipe.pending.json').write_text(json.dumps({KEY:p},indent=2)+'\n')
    return p
if __name__=='__main__':stage()
