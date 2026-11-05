"""Stage exactly one current profile without changing canonical controls or helpers."""
import json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
RECIPE='urbanterror/egg-urban-terror.json'
OUT=ROOT/'artifacts/game-parity-20261029/wave48-urbanterror'
def stage():
    profile=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text(encoding='utf-8-sig'))[RECIPE]
    script=profile['egg']['scripts']['installation']['script']
    for source,target in [('urbanterror-install.py','urbanterror_install.py'),('quake-family-runtime.py','quake_family_runtime.py')]:
        pattern=r"(cat > \.voltra/"+re.escape(target)+r" <<'VOLTRA_SOURCE'\n).*?(\nVOLTRA_SOURCE\n)"
        script,count=re.subn(pattern,lambda m:m[1]+(ROOT/'internal/panel/game_library/scripts'/source).read_text().rstrip('\n')+m[2],script,flags=re.S)
        if count!=1:raise ValueError('Expected exactly one emitted '+target)
    profile['egg']['scripts']['installation']['script']=script
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'overrides.pending.json').write_text(json.dumps({RECIPE:profile},indent=2)+'\n')
    return profile
if __name__=='__main__':stage()
