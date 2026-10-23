import importlib.util
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

def load(name):
    path=Path('internal/panel/game_library/scripts')/(name+'.py');spec=importlib.util.spec_from_file_location(name,path);result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

class GTAC(unittest.TestCase):
    def test_native_controls_preserve_resources(self):
        runtime=load('gtac-runtime')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'gtac').mkdir();p=root/'gtac/server.xml';p.write_text('<server><!-- retained --><resources><resource src="custom" /></resources><modules><module src="native.so" /></modules><cvar name="traffic" value="0" /></server>')
            for game in ['gta:iii','gta:vc','gta:sa','gta:ug','gta:iv','gta:eflc']:
                runtime.configure(root,{'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010','GAMETYPE':game,'SERVERNAME':'Literal " $ & < >','MAX_PLAYERS':'12','SERVER_PASSWORD':'secret','SERVERBROWSER':'false'})
                xml=ET.fromstring(p.read_text());self.assertEqual(xml.findtext('game'),game);self.assertEqual(xml.findtext('servername'),'Literal " $ & < >');self.assertEqual(xml.findtext('httpport'),'28010');self.assertEqual(xml.find('resources/resource').get('src'),'custom');self.assertEqual(xml.find('modules/module').get('src'),'native.so');self.assertIn('retained',p.read_text())
    def test_reject_entities_duplicate_and_unallocated(self):
        runtime=load('gtac-runtime')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'gtac').mkdir();p=root/'gtac/server.xml'
            for raw,ports in [('<!DOCTYPE server><server/>','28010'),('<server><port>1</port><port>2</port></server>','28010'),('<server/>','28011')]:
                p.write_text(raw)
                with self.assertRaises(ValueError):runtime.configure(root,{'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':ports})
    def test_release_selection_fail_closed(self):
        installer=load('gtac-install');self.assertEqual(installer.identity({})['version'],'1.7.3')
        for value in ['latest','1.7.2','../../x']:
            with self.assertRaises(ValueError):installer.identity({'DL_VERSION':value})
        self.assertEqual(installer.identity({'DL_VERSION':'latest','GTAC_RELEASE_SHA256':'a'*64})['sha256'],'a'*64)

if __name__=='__main__':unittest.main()
