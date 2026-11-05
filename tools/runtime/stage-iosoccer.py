"""Emit an IOSoccer recipe fragment for root review, never apply canonical data."""
import json
from pathlib import Path

def fragment(repo):
    source=(repo/'internal/panel/game_library/scripts/iosoccer-runtime.py').read_text()
    return {'recipe':'iosoccer/eggs-iosoccer.json',
            'startup':'exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/iosoccer_runtime.py',
            'installer_append':"cat > .voltra/iosoccer_runtime.py <<'VOLTRA_IOSOCCER'\n"+source+"\nVOLTRA_IOSOCCER\n",
            'installer_preacquisition_hook':"from iosoccer_runtime import preflight\npreflight(Path.cwd(), dict(os.environ))\n",
            'apply':False,
            'integration_gap':'Root must place preflight before acquisition and helper publication; emit shared source_runtime.py/source_install.py/native_console.py/steam_template.py dependencies with existing shared stager.'}

if __name__=='__main__':
    print(json.dumps(fragment(Path(__file__).resolve().parents[2]),indent=2))
