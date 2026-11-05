import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

def load(path):
    s=importlib.util.spec_from_file_location('renown_test_runtime',path); m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

m=load(Path('internal/panel/game_library/scripts/renown-runtime.py').resolve())
def env(**kw):
    return {'SERVER_PORT':'28000','QUERY_PORT':'28001','BEACON_PORT':'28002','RCON_PORT':'28003','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002,28003','ADMIN_PASSWORD':'operator-admin','RCON_PASSWORD':'operator-rcon',**kw}

class Tests(unittest.TestCase):
    def test_seed_then_native_authority_and_unknown_bytes(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);m.configure(root,env());p=root/m.PREFIX/'Game.ini'
            b=p.read_bytes().replace(b'MaxPlayers= 32',b'MaxPlayers= 57')+b'; private comment\r\n+Mod=secret\r\n+Mod=other\r\n'
            p.write_bytes(b);m.configure(root,env(MAX_PLAYERS='3',ADMIN_PASSWORD='ChangeMe'))
            self.assertEqual(p.read_bytes(),b)
    def test_refusal_before_writes_and_acquisition(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);m.configure(root,env());p=root/m.PREFIX/'Engine.ini';p.write_text('[Server]\nFirstPersonOnly=1\nfirstpersononly=0\n')
            before={x:x.read_bytes() for x in root.rglob('*.ini')}
            with patch.object(m.shared.steam,'update') as update:
                with self.assertRaises(ValueError):m.prepare(root,env())
                update.assert_not_called()
            self.assertEqual(before,{x:x.read_bytes() for x in root.rglob('*.ini')})
    def test_update_retention_success_and_failure(self):
        for fail in (False,True):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as d:
                root=Path(d);m.configure(root,env());p=root/m.PREFIX/'Game.ini';before=p.read_bytes()
                save=root/'Renown_Combat/Saved/SaveGames/Save_1.sav';save.parent.mkdir();save.write_bytes(b'operator-save')
                def update(*a,**kw):
                    p.write_bytes(b'depot config')
                    save.write_bytes(b'depot overwritten save')
                    if fail:raise RuntimeError('mock depot failure')
                    return {}
                with patch.object(m.shared.steam,'update',side_effect=update):
                    if fail:
                        with self.assertRaises(RuntimeError):m.install(root,env())
                    else:m.install(root,env())
                self.assertEqual(p.read_bytes(),before);self.assertEqual(save.read_bytes(),b'operator-save')
    def test_actual_emitted_imports(self):
        profile=json.loads(Path('artifacts/game-parity-20261029/wave30-renown/profiles.pending.json').read_text())['renown/egg-renown.json']
        script=profile['egg']['scripts']['installation']['script']
        with tempfile.TemporaryDirectory() as d:
            for name,marker,body in re.findall(r"cat > \.voltra/([^ ]+) <<'([^']+)'\n(.*?)\n\2\n",script,re.S):
                Path(d,name).write_text(body,encoding='utf-8')
            emitted=load(Path(d,'renown_runtime.py'));self.assertEqual(emitted.shared.GAMES['renown'][0],1512690)
            self.assertEqual(emitted.shared.renown_seeds()['templates'],m.shared.renown_seeds()['templates'])

if __name__=='__main__':unittest.main()
