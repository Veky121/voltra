"""Emit an unmerged exact Hogwarp candidate. Never touches canonical overrides."""
import copy, hashlib, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/hogwarp-integration-followup'
NAMES=['steam-template.py','native-config.py','native-console.py','source-install.py','source-next-install.py','tactical-install.py','tactical-runtime.py','publisher-install.py','publisher-runtime.py']
def emit():
    canonical=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())['hogwarp/egg-hogwarp.json']
    candidate=copy.deepcopy(canonical)
    modules={n.replace('-','_'):(ROOT/'internal/panel/game_library/scripts'/n).read_bytes() for n in NAMES}
    modules['hogwarp_owner.py']=(ROOT/'tools/runtime/hogwarp-owner.py').read_bytes()
    script='''#!/bin/bash
set -euo pipefail
cd "${VOLTRA_HOGWARP_ROOT:-/mnt/server}"
# An existing Python 3.9+ interpreter is an operator runtime prerequisite.
command -v python3 >/dev/null || { echo 'Hogwarp requires operator-provided Python 3.9+; nothing installed' >&2; exit 1; }
python3 -c 'import sys; assert sys.version_info >= (3,9), "Python 3.9+ required"'
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
'''
    for name,data in modules.items():
        assert b'VOLTRA_HOGWARP_MODULE' not in data
        script+='cat > "$stage/'+name+'" <<\'VOLTRA_HOGWARP_MODULE\'\n'+data.decode()+'VOLTRA_HOGWARP_MODULE\n'
    script+='python3 -I -B "$stage/hogwarp_owner.py" --install "$PWD"\n'
    # -I excludes the script directory too. Explicitly add the emitted directory,
    # never cwd, before importing its trusted entrypoint.
    script=script.replace('python3 -I -B "$stage/hogwarp_owner.py" --install "$PWD"', '''python3 -I -B -c 'import sys,runpy; sys.path.insert(0,sys.argv[1]); sys.argv=[sys.argv[1]+"/hogwarp_owner.py","--install",sys.argv[2]]; runpy.run_path(sys.argv[0],run_name="__main__")' "$stage" "$PWD"''')
    candidate['egg']['scripts']['installation']['script']=script
    candidate['egg']['startup']="exec python3 -I -B -c 'import sys; sys.path.insert(0,\"/home/container/.voltra\"); from hogwarp_owner import main; from pathlib import Path; import os; raise SystemExit(main(Path.cwd(),dict(os.environ))))'"
    candidate['egg']['startup']=candidate['egg']['startup'].replace('dict(os.environ))))','dict(os.environ)))')
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'profile.pending.json').write_text(json.dumps(candidate,indent=2)+'\n')
    (OUT/'install-emitted.sh').write_text(script)
    (OUT/'emitted').mkdir(exist_ok=True)
    for name,data in modules.items():(OUT/'emitted'/name).write_bytes(data)
    return canonical,candidate,modules
if __name__=='__main__':emit()

