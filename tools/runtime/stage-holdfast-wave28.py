"""Emit review fragment only. Never modifies the canonical profile."""
import json
from pathlib import Path
recipe='holdfast/egg-holdfast-na-w.json'
profile=json.loads(Path('internal/panel/game_library/overrides.json').read_text())[recipe]
startup=profile['egg']['startup'].replace('.voltra/steam-native-next.py run holdfast','.voltra/holdfast-wave28.py run')
source=Path('internal/panel/game_library/scripts/holdfast-wave28.py').read_text()
fragment={'recipe':recipe,'startup':startup,'installer_insert_before_final_install':"cat > .voltra/holdfast-wave28.py <<'VOLTRA_HOLDFAST_WAVE28'\n"+source+"\nVOLTRA_HOLDFAST_WAVE28\n",'canonical_applied':False}
path=Path('artifacts/game-parity-20261029/wave28-holdfast/recipe-fragment.json');path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(fragment,indent=2))
