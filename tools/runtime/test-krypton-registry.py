import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('base_source_tests',HERE/'test-krypton-source.py');base=importlib.util.module_from_spec(s);s.loader.exec_module(base)
adapter=base.base.load('krypton_registry_data','krypton-registry-data.py')


class RegistryTests(unittest.TestCase):
    def test_official_inputs_have_strong_identity_and_proprietary_boundary(self):
        pins=base.source.RECIPE['registry_generation']
        self.assertEqual(pins['version'],'1.19.3')
        for key in ('metadata','server','server_mappings'):
            self.assertRegex(pins[key]['sha256'],'^[a-f0-9]{64}$');self.assertRegex(pins[key]['sha1'],'^[a-f0-9]{40}$');self.assertGreater(pins[key]['bytes'],0)
        text=(base.base.SCRIPTS/'KryptonRegistrySupplement.java').read_text()
        self.assertNotIn('net.minecraft.server.Main',text)
        self.assertIn('defaultStateId',text);self.assertIn('No exact Krypton property signature',text)

    def test_sparse_duplicate_and_negative_registry_ids_rejected(self):
        for ids in ([0,2],[0,0],[-1,0]):
            with self.subTest(ids=ids),self.assertRaises(ValueError):adapter.ordered({str(i):{'id':v} for i,v in enumerate(ids)})

    def test_registry_reorders_by_actual_id_and_keeps_rows(self):
        rows={'stone':{'id':1,'properties':['B','A']},'air':{'id':0,'defaultStateId':0}}
        result=adapter.ordered(rows);self.assertEqual(list(result),['air','stone']);self.assertEqual(result['stone'],rows['stone'])
        nonregistry={'x':{'protocol':99}};self.assertIs(adapter.ordered(nonregistry),nonregistry)

    def test_mapping_method_overrides_same_named_field(self):
        lines=[]
        for short,long in adapter.CLASSES.items():
            lines.append(long+' -> '+short+':')
            if short=='Block':lines+=['    SomeType defaultBlockState -> field','    1:1:SomeType defaultBlockState() -> method']
            if short=='Property':lines+=['    java.lang.String getName() -> noarg','    java.lang.String getName(java.lang.Comparable) -> value']
        result=adapter.mappings('\n'.join(lines));self.assertEqual(result['Block']['defaultBlockState'],'method');self.assertEqual(result['Property']['getName'],'noarg');self.assertEqual(result['Property']['getNameValue'],'value')
        with self.assertRaises(ValueError):adapter.mappings('')

    def test_every_archive_path_checked_before_extraction(self):
        for bad in ('../escape','/absolute','root\\escape','root/../escape','C:/drive'):
            with self.subTest(bad=bad),tempfile.TemporaryDirectory() as d:
                root=Path(d);archive=root/'input.jar';out=root/'out';out.mkdir()
                with zipfile.ZipFile(archive,'w') as z:z.writestr('META-INF/versions/1.19.3/server.jar',b'valid');z.writestr(bad.replace('\\','/'),b'bad')
                if '\\' in bad:archive.write_bytes(archive.read_bytes().replace(b'root/escape',b'root\\escape'))
                with self.assertRaises(ValueError):adapter.unpack_server(archive,out)
                self.assertEqual(list(out.iterdir()),[])

    def test_links_and_devices_rejected(self):
        for mode in (0o120777,0o020600):
            with tempfile.TemporaryDirectory() as d:
                root=Path(d);archive=root/'input.jar';out=root/'out';out.mkdir()
                with zipfile.ZipFile(archive,'w') as z:
                    entry=zipfile.ZipInfo('META-INF/versions/1.19.3/server.jar');entry.external_attr=mode<<16;z.writestr(entry,b'x')
                with self.assertRaises(ValueError):adapter.unpack_server(archive,out)

    def test_extracts_only_official_version_and_libraries(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);archive=root/'input.jar';out=root/'out';out.mkdir()
            with zipfile.ZipFile(archive,'w') as z:
                z.writestr('META-INF/versions/1.19.3/server.jar',b'version');z.writestr('META-INF/libraries/gson.jar',b'lib');z.writestr('bundler/Main.class',b'never extracted')
            rows=adapter.unpack_server(archive,out);self.assertEqual(len(rows),2);self.assertFalse((out/'bundler').exists())

    def test_source_property_literals_and_enum_sets(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);file=root/'server/src/main/kotlin/org/kryptonmc/krypton/state/property/KryptonProperties.kt';file.parent.mkdir(parents=True)
            file.write_text('val LIT: BooleanProperty = BooleanProperty("lit")\nval AGE: IntProperty = IntProperty("age", 0, 2)\nval SHAPE: EnumProperty<Shape> = EnumProperty.create("shape")\n')
            enum=root/'api/src/main/kotlin/Shape.kt';enum.parent.mkdir(parents=True);enum.write_text('public enum class Shape {\n    FLAT,\n    ROUND\n}\n')
            result=adapter.properties(root);self.assertEqual(result['AGE']['values'],['0','1','2']);self.assertEqual(result['SHAPE']['values'],['flat','round']);self.assertEqual(result['LIT']['values'],['false','true'])
            file.write_text(file.read_text()+'val UNKNOWN: OtherProperty = OtherProperty("x")\n')
            with self.assertRaises(ValueError):adapter.properties(root)


if __name__=='__main__':unittest.main()
