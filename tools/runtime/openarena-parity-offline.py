"""Run existing source fixtures locally, without the historical SSH runner."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
scripts=ROOT/'internal/panel/game_library/scripts'
NATIVE_SOURCE=(scripts/'native-release.py').read_text()
ZIP_SOURCE=(scripts/'native-zip-release.py').read_text()
RUNTIME_SOURCE=(scripts/'openarena-runtime.py').read_text()
exec(compile((ROOT/'tools/runtime/test-openarena.py').read_text(),str(ROOT/'tools/runtime/test-openarena.py'),'exec'),globals())
