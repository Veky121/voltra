"""Offline attribution against private captured XML; never starts the publisher."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

workspace = Path('/source')
base = workspace / 'internal/panel/game_library/scripts'
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, base / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
for name in ('steam-template', 'additional-survival-install', 'native-console', 'strategy-survival-install'):
    load(name.replace('-', '_'), name + '.py')
wrapper = load('cryo_authority', 'cryofall-file-authority.py')
shared = load('cryofall_runtime', 'cryofall-runtime.py')
before = (workspace / '.local/game-parity-20261029/cryofall-native/settings-after.xml').read_bytes()
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    target = root / 'Data/SettingsServer.xml'
    target.parent.mkdir()
    target.write_bytes(before)
    env = wrapper.preflight(root, {'SERVER_PORT': '29107', 'VOLTRA_ALLOCATED_PORTS': '29107'}, require_binary=False)
    shared.configure(root, env)
    after = target.read_bytes()
    assert b'VOLTRA_NATIVE_COMMENT_SENTINEL' in after
    assert b'CryoFall native roundtrip' in after
    print(json.dumps({'actual_shared_configure': True, 'comment_preserved': True, 'whole_file_bytes_equal': before == after,
                      'native_process_not_started': True, 'conclusion': 'Whole-boot comment loss occurs after shared configure; publisher rewrites the XML.'}))
