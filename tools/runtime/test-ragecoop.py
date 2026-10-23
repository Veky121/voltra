import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

def load(name):
    path=Path('internal/panel/game_library/scripts')/(name+'.py');spec=importlib.util.spec_from_file_location(name,path);result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

class RageCOOP(unittest.TestCase):
    def test_config_preserves_original_features(self):
        runtime=load('ragecoop-runtime')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'ragecoop').mkdir();p=root/'ragecoop/Settings.xml';p.write_text('<Settings><!--keep--><UseP2P>true</UseP2P><UseVoice>true</UseVoice><UseZeroTier>false</UseZeroTier><CustomSetting>retained</CustomSetting></Settings>')
            runtime.configure(root,{'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010','SERVER_NAME':'Literal " $ & < >','MAX_PLAYERS':'12'})
            xml=ET.fromstring(p.read_text());self.assertEqual(xml.findtext('Name'),'Literal " $ & < >');self.assertEqual(xml.findtext('Port'),'28010');self.assertEqual(xml.findtext('MaxPlayers'),'12');self.assertEqual(xml.findtext('UseVoice'),'true');self.assertEqual(xml.findtext('UseP2P'),'true');self.assertEqual(xml.findtext('UseZeroTier'),'false');self.assertEqual(xml.findtext('CustomSetting'),'retained');self.assertIn('keep',p.read_text())
    def test_archive_confinement(self):
        installer=load('ragecoop-install')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name in ['../escape','/escape','x\\escape']:
                archive=root/'archive.zip'
                with zipfile.ZipFile(archive,'w') as z:z.writestr(name,'bad')
                with self.assertRaises(ValueError):installer.extract(archive,root/'out')
    def test_default_pinned(self):
        self.assertEqual(load('ragecoop-install').identity({})['sha256'],'85cb91487993138f30f913ed2fe7bffbcc5c9e2f2c2b59eba91480ce1016fd8d')

if __name__=='__main__':unittest.main()
