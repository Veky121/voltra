"""Stage exactly one canonical profile, replacing only its emitted runtime body."""
import copy, hashlib, json, re
from pathlib import Path
BASE=Path(__file__).resolve().parents[2];OUT=BASE/'artifacts/game-parity-20261029/wave48-vrising';OUT.mkdir(exist_ok=True)
recipe='v_rising/v_rising_vanilla/egg-v-rising.json'
canonical=BASE/'internal/panel/game_library/overrides.json';profile=json.loads(canonical.read_text())[recipe];staged=copy.deepcopy(profile)
script=staged['egg']['scripts']['installation']['script']
for filename in ('vrising-runtime.py','valheim-vrising-install.py'):
 source=BASE/'internal/panel/game_library/scripts'/filename
 marker="cat > .voltra/"+filename.replace('-','_')+" <<'VOLTRA_SOURCE'\n"
 start=script.index(marker)+len(marker);end=script.index('\nVOLTRA_SOURCE',start)
 script=script[:start]+source.read_text()+script[end:]
staged['egg']['scripts']['installation']['script']=script
assert staged['egg']['variables']==profile['egg']['variables']
assert staged['egg']['docker_images']==profile['egg']['docker_images']
(OUT/'profiles.pending.json').write_text(json.dumps({recipe:staged},indent=2)+'\n')
emitted=re.findall(r"cat > (\S+) <<'VOLTRA_SOURCE'",script)
assert '.voltra/vrising_runtime.py' in emitted and '.voltra/valheim_vrising_install.py' in emitted
(OUT/'stage-check.json').write_text(json.dumps({'recipe':recipe,'emitted_filenames':emitted,'canonical_sha256':hashlib.sha256(canonical.read_bytes()).hexdigest(),'only_changed':'egg.scripts.installation.script runtime body','applied':False},indent=2))
print('Staged exact vanilla fragment; canonical untouched.')
