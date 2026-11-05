"""AMS2 source-only preflight regressions. No Wine, native server or acquisition."""
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
CANONICAL=ROOT/'internal/panel/game_library/scripts/assetto-ams-native.py'
BASE={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002','VOLTRA_STEAM_AUTO_UPDATE':'1'}
CONFIG='// retain operator comment\nname:"old", password:"fixture", steamPort:28001,hostPort:28000,queryPort:28002,maxPlayerCount:16,addons:{custom:true}\n'


def load(path):
    module=types.ModuleType('racing_wave3');module.__file__=str(CANONICAL)
    exec(compile(path.read_text(),str(path),'exec'),module.__dict__)
    return module


class AMS2Preflight(unittest.TestCase):
    def test_missing_publisher_config_can_be_repaired_after_valid_preflight(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);module=load(CANONICAL);events=[]
            def repair(*args,**kwargs):
                events.append('install');(root/'server.cfg').write_text(CONFIG)
            def configured(*args):
                events.append('configure');module.plan_ams2(root,BASE)
                raise RuntimeError('native start intercepted')
            with patch.object(module,'install_steam',side_effect=repair),patch.object(module,'configure',side_effect=configured):
                with self.assertRaisesRegex(RuntimeError,'native start intercepted'):module.run(root,'ams2',BASE)
            self.assertEqual(events,['install','configure'])

    def test_missing_config_does_not_bypass_invalid_control_refusal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);module=load(CANONICAL)
            with patch.object(module,'install_steam') as install:
                with self.assertRaises(ValueError):module.run(root,'ams2',{**BASE,'MAX_PLAYERS':'33'})
            install.assert_not_called();self.assertEqual(list(root.iterdir()),[])

    def test_invalid_inputs_do_not_acquire_or_write(self):
        bad=[{'SERVER_PORT':'1'},{'QUERY_PORT':'28000'},{'MAX_PLAYERS':'33'},
             {'SERVER_NAME':'bad\nname'},{'WINEDEBUG':'bad\nsetting'}]
        for change in bad:
            with self.subTest(change=change),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary);(root/'server.cfg').write_text(CONFIG)
                module=load(CANONICAL)
                with patch.object(module,'install_steam') as install,patch.object(module.native,'private_write') as write,patch.object(module.subprocess,'Popen') as spawn:
                    with self.assertRaises(ValueError):module.run(root,'ams2',{**BASE,**change})
                install.assert_not_called();write.assert_not_called();spawn.assert_not_called()
                self.assertEqual((root/'server.cfg').read_text(),CONFIG)
                self.assertEqual([p.name for p in root.iterdir()],['server.cfg'])

    def test_invalid_publisher_grammar_does_not_acquire_or_write(self):
        for content in [CONFIG+'name:"duplicate"',CONFIG.replace('password:', 'missing:'),CONFIG+'addons:{']:
            with self.subTest(content=content),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary);(root/'server.cfg').write_text(content)
                module=load(CANONICAL)
                with patch.object(module,'install_steam') as install,patch.object(module.native,'private_write') as write:
                    with self.assertRaises(ValueError):module.run(root,'ams2',BASE)
                install.assert_not_called();write.assert_not_called()
                self.assertEqual((root/'server.cfg').read_text(),content)

    def test_plan_is_pure_and_preserves_nested_addons_comments(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'server.cfg').write_text(CONFIG)
            module=load(CANONICAL)
            target,previous,updated,values=module.plan_ams2(root,{**BASE,'SERVER_NAME':'Literal $ name'})
            self.assertEqual(previous,CONFIG);self.assertEqual(target,root/'server.cfg')
            self.assertIn('name:"Literal $ name"',updated);self.assertIn('addons:{custom:true}',updated)
            self.assertTrue(updated.startswith('// retain operator comment'))
            self.assertEqual((root/'server.cfg').read_text(),CONFIG)
            self.assertEqual(values['hostPort'],28000)

    def test_valid_preflight_reaches_installer_then_stops_on_its_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'server.cfg').write_text(CONFIG)
            module=load(CANONICAL)
            with patch.object(module,'install_steam',side_effect=RuntimeError('offline acquisition intercepted')) as install,patch.object(module.native,'private_write') as write:
                with self.assertRaisesRegex(RuntimeError,'offline acquisition intercepted'):module.run(root,'ams2',BASE)
            install.assert_called_once_with(root,'ams2',BASE,validate=False);write.assert_not_called()
            self.assertEqual((root/'server.cfg').read_text(),CONFIG)

    def test_non_ams_branch_does_not_use_new_planner(self):
        module=load(CANONICAL)
        with patch.object(module,'plan_ams2',side_effect=AssertionError('AMS2 only')),patch.object(module,'configure',side_effect=RuntimeError('original branch reached')):
            with self.assertRaisesRegex(RuntimeError,'original branch reached'):module.run(Path('.'),'assetto',{})


if __name__=='__main__':unittest.main()
