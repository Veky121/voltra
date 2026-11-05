"""Source fixture only: load the real underscore installer names."""
import importlib.util
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = pathlib.Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
import json
import re
TEMP = tempfile.TemporaryDirectory()
recipe = 'americas_army/proving_grounds/egg-america-s-army--proving-grounds.json'
profile = json.loads((SCRIPTS.parent / 'overrides.json').read_text(encoding='utf-8-sig'))[recipe]
installer = profile['egg']['scripts']['installation']['script']
for name, marker, content in re.findall(r"cat > .voltra/([a-z_]+\.py) <<'([^']+)'\n(.*?)\n\2", installer, re.S):
    (pathlib.Path(TEMP.name) / name).write_text(content, encoding='utf-8')
assert (pathlib.Path(TEMP.name) / 'aapg_runtime.py').is_file(), 'canonical installer must emit wrapper'
sys.path.insert(0, TEMP.name)
import aapg_runtime

class AAPGTests(unittest.TestCase):
    def test_emitted_installer_retention(self):
        import tactical_next_install as installer
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            binary=root/'Binaries/Linux/AAPG';binary.parent.mkdir(parents=True);binary.write_bytes(b'fixture only')
            target=root/'AAGame/Config/PCServerLinux-AAGame.ini';target.parent.mkdir(parents=True)
            raw=b'; operator\r\n[Unknown]\r\n+Array=x\r\n+Array=y\r\nSecret=private\r\n'
            target.write_bytes(raw)
            for failure in (False,True):
                def update(*args,**kwargs):
                    target.write_bytes(b'publisher replacement')
                    if failure:raise RuntimeError('fixture update failure')
                with patch.object(installer,'arguments'),patch.object(installer,'update',side_effect=update):
                    if failure:
                        with self.assertRaises(RuntimeError):installer.install(root,{'VOLTRA_TACTICAL_NEXT':'aapg'})
                    else:installer.install(root,{'VOLTRA_TACTICAL_NEXT':'aapg'})
                self.assertEqual(target.read_bytes(),raw)

    def test_preflight_before_update(self):
        for name in ['bad" -port=1', 'bad\\name', 'bad\nname']:
            with patch.object(aapg_runtime, 'tactical_main') as launch:
                with self.assertRaises(ValueError):
                    aapg_runtime.main(pathlib.Path(TEMP.name), {'VOLTRA_TACTICAL_NEXT':'aapg', 'SERVER_NAME': name, 'AUTO_UPDATE':'1'})
                launch.assert_not_called()

    def test_shared_success_failure_propagated(self):
        env={'VOLTRA_TACTICAL_NEXT':'aapg','SERVER_NAME':"Operator's full name"}
        with patch.object(aapg_runtime,'tactical_main',return_value=7) as launch:
            self.assertEqual(aapg_runtime.main(pathlib.Path(TEMP.name),env),7)
            launch.assert_called_once()
        with patch.object(aapg_runtime,'tactical_main',side_effect=RuntimeError('update failed')):
            with self.assertRaises(RuntimeError):aapg_runtime.main(pathlib.Path(TEMP.name),env)

if __name__=='__main__':unittest.main()

