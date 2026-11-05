"""Stage only the exact canonical DMP profile; never apply overrides."""
import copy, hashlib, json, pathlib, re
BASE=pathlib.Path(__file__).resolve().parents[2]
OUT=BASE/'artifacts/game-parity-20261029/wave45-ksp_dmp'
RECIPE='ksp/DMP/egg-k-s-p-d-m-p.json'
def stage():
    original=json.loads((BASE/'internal/panel/game_library/overrides.json').read_text())[RECIPE]
    profile=copy.deepcopy(original)
    script=profile['egg']['scripts']['installation']['script']
    for name in ('ksp-install.py','ksp-runtime.py'):
        emitted=name.replace('-','_')
        pattern="(cat > .voltra/"+re.escape(emitted)+" <<'VOLTRA_SOURCE'\n).*?(\nVOLTRA_SOURCE\n)"
        body=(BASE/'internal/panel/game_library/scripts'/name).read_text().rstrip('\n')
        script,count=re.subn(pattern,lambda m:m[1]+body+m[2],script,flags=re.S)
        if count!=1:raise ValueError('Expected exact single helper emission '+emitted)
    profile['egg']['scripts']['installation']['script']=script
    profile['revision']='ksp-dmp-wave45-source-only'
    profile['verification']='not_verified'
    profile['detail']='Unapplied source-only DMP native-file authority and protected publication fixes. Native/browser/gameplay acceptance pending.'
    unchanged=copy.deepcopy(profile);unchanged['egg']['scripts']['installation']['script']=original['egg']['scripts']['installation']['script']
    for key in ('revision','verification','detail'):unchanged[key]=original[key]
    assert unchanged==original
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'profiles.json').write_text(json.dumps({RECIPE:profile},indent=2)+'\n')
    return profile
if __name__=='__main__':stage()
