"""MIT. Cube setup and root-layout archive regression fixtures."""
import importlib.util
import io
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
import json
from unittest.mock import patch

base=Path('internal/panel/game_library/scripts')
spec=importlib.util.spec_from_file_location('native_release',base/'native-release.py');native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
sys.modules['native_release']=native
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,base/file);result=importlib.util.module_from_spec(spec);sys.modules[name]=result;spec.loader.exec_module(result);return result
module('steam_template','steam-template.py');query=module('cube_query','cube-query.py');runtime=module('cube_runtime','cube-runtime.py');installer=module('cube_install','cube-install.py')


class CubeArchiveTests(unittest.TestCase):
    def archive(self,path,entries):
        with tarfile.open(path,'w') as out:
            for name,kind,mode in entries:
                item=tarfile.TarInfo(name);item.type=kind;item.mode=mode
                item.size=7 if kind==tarfile.REGTYPE else 0
                if kind==tarfile.SYMTYPE:item.linkname='/outside'
                out.addfile(item,io.BytesIO(b'payload') if item.size else None)

    def test_original_prefixed_layout_and_modes_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.archive(root/'tar',[('release',tarfile.DIRTYPE,0o755),('release/bin/server',tarfile.REGTYPE,0o755)])
            native.extract(root/'tar',root/'out','release')
            self.assertEqual((root/'out/bin/server').read_bytes(),b'payload')
            self.assertEqual((root/'out/bin/server').stat().st_mode&0o777,0o755)

    def test_root_layout_with_dot_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.archive(root/'tar',[('.',tarfile.DIRTYPE,0o755),('./bin/server',tarfile.REGTYPE,0o755),('./config/server.cfg',tarfile.REGTYPE,0o600)])
            native.extract(root/'tar',root/'out',None)
            self.assertEqual((root/'out/bin/server').read_bytes(),b'payload')
            self.assertEqual((root/'out/config/server.cfg').stat().st_mode&0o777,0o600)

    def test_root_and_prefixed_reject_absolute_traversal_backslash_and_specials(self):
        for prefix in (None,'release'):
            for name,kind in [('/outside',tarfile.REGTYPE),('release/../outside',tarfile.REGTYPE),('release\\outside',tarfile.REGTYPE),('release/link',tarfile.SYMTYPE),('release/hard',tarfile.LNKTYPE),('release/fifo',tarfile.FIFOTYPE),('release/device',tarfile.CHRTYPE)]:
                with self.subTest(prefix=prefix,name=name),tempfile.TemporaryDirectory() as directory:
                    root=Path(directory);self.archive(root/'tar',[(name,kind,0o777)])
                    with self.assertRaises(ValueError):native.extract(root/'tar',root/'out',prefix)

    def test_duplicate_normalized_root_paths_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.archive(root/'tar',[('./config/file',tarfile.REGTYPE,0o644),('config/file',tarfile.REGTYPE,0o644)])
            with self.assertRaises(ValueError):native.extract(root/'tar',root/'out',None)

    def test_empty_root_file_and_wrong_prefix_rejected(self):
        for name,prefix in [('',None),('.',None),('release','release'),('wrong/file','release')]:
            with self.subTest(name=name,prefix=prefix),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);self.archive(root/'tar',[(name,tarfile.REGTYPE,0o644)])
                with self.assertRaises(ValueError):native.extract(root/'tar',root/'out',prefix)

    def test_oversized_member_rejected_before_content_is_read(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);member=tarfile.TarInfo('large');member.size=4*1024**3+1
            (root/'tar').write_bytes(member.tobuf()+bytes(1024))
            with self.assertRaises(ValueError):native.extract(root/'tar',root/'out',None)

    def test_assault_older_archive_layout_detection(self):
        for prefix in ('release/', ''):
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);self.archive(root/'tar',[(prefix+'bin_unix/linux_64_server',tarfile.REGTYPE,0o755)])
                self.assertEqual(installer.archive_prefix(root/'tar'),'release' if prefix else None)

    def test_assault_ambiguous_archive_layout_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.archive(root/'tar',[('one/bin_unix/linux_64_server',tarfile.REGTYPE,0o755),('two/bin_unix/linux_64_server',tarfile.REGTYPE,0o755)])
            with self.assertRaises(ValueError):installer.archive_prefix(root/'tar')


class CubeSetupTests(unittest.TestCase):
    def test_assault_original_flags_literal_values_and_generated_credential(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env={'SERVER_PORT':'28020','ASSAULT_SERVER_DESCRIPTION':'Literal $value "quotes" +command','ASSAULT_SERVER_MOTD':'Welcome; literal'}
            game,argv,credentials,port=runtime.configure(root,env,'assaultcube')
            self.assertTrue((game/'logs').is_dir())
            self.assertIn('-nLiteral $value "quotes" +command',argv);self.assertIn('-oWelcome; literal',argv)
            self.assertIn('-mlocalhost',argv);self.assertFalse(any(a.startswith('-Y')for a in argv))
            password=root/'.voltra/assaultcube/admin-password';self.assertEqual(password.stat().st_mode&0o777,0o600)
            self.assertIn('-x'+password.read_text(),argv)
            self.assertEqual(runtime.configure(root,env,'assaultcube')[1],argv)
            options=game/'config/voltra-options.txt';options.write_text('-D10\n')
            runtime.configure(root,env,'assaultcube');self.assertEqual(options.read_text(),'-D10\n')

    def test_assault_public_key_and_existing_explicit_password(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env={'SERVER_PORT':'28020','PUBLIC_SERVER':'1','ASSAULT_SERVER_KEY':'a'*64,'ASSAULT_SERVER_ADMINPASSWORD':'private password'}
            _,argv,_,_=runtime.configure(root,env,'assaultcube')
            self.assertIn('-Y'+'a'*64,argv);self.assertIn('-xprivate password',argv);self.assertIn('-mms.cubers.net',argv)
            self.assertFalse((root/'.voltra/assaultcube/admin-password').exists())

    def test_sauer_operator_config_retained_and_native_escaping(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);game=root/'sauerbraten';game.mkdir();operator=game/'server-init.cfg';operator.write_bytes(b'// operator\nservermotd "before"\n')
            env={'SERVER_PORT':'28020','CUBE_SERVERDESCRIPTION':'Literal "quote" ^caret $value;','SERVER_PASSWORD':'private password'}
            _,argv,_,_=runtime.configure(root,env,'sauerbraten')
            self.assertIn('-q'+str(game/'userdata'),argv)
            self.assertEqual(operator.read_bytes(),b'// operator\nservermotd "before"\n')
            managed=game/'userdata/server-init.cfg';content=managed.read_text()
            self.assertIn('serverdesc "Literal ^"quote^" ^^caret $value;"',content)
            self.assertIn('updatemaster 0',content);self.assertIn('mastername ""',content)
            self.assertLess(content.index('// operator'),content.index('// Voltra managed'))
            self.assertEqual(managed.stat().st_mode&0o777,0o600)

    def test_invalid_controls_are_rejected(self):
        for kind in ('assaultcube','sauerbraten'):
            prefix='ASSAULT_SERVER_' if kind=='assaultcube' else 'CUBE_'
            for env in [{'SERVER_PORT':'65535'},{'PUBLIC_SERVER':'2'},{prefix+'MAXPLAYERS':'0'},{prefix+'MAXPLAYERS':'17'},{prefix+'ADMINPASSWORD':'tiny'},{prefix+'MASTERSERVER':'bad host'},{prefix+'ADMINPASSWORD':'bad\npassword'}]:
                with self.subTest(kind=kind,env=env),tempfile.TemporaryDirectory() as directory,self.assertRaises(ValueError):runtime.configure(Path(directory),{'SERVER_PORT':'28020',**env},kind)
        for env in [{'PUBLIC_SERVER':'1'},{'ASSAULT_SERVER_KEY':'bad'},{'ASSAULT_SERVER_KEY':'A'*64},{'ASSAULT_SERVER_MOTD':'bad\nmessage'}]:
            with tempfile.TemporaryDirectory() as directory,self.assertRaises(ValueError):runtime.configure(Path(directory),{'SERVER_PORT':'28020',**env},'assaultcube')

    def test_native_operator_bytes_are_not_forced_through_utf8(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);game=root/'sauerbraten';game.mkdir();original=b'// Latin-1 operator comment: \xff\n'
            (game/'server-init.cfg').write_bytes(original)
            runtime.configure(root,{'SERVER_PORT':'28020'},'sauerbraten')
            self.assertEqual((game/'server-init.cfg').read_bytes(),original)
            self.assertTrue((game/'userdata/server-init.cfg').read_bytes().startswith(original))

    def test_volume_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as outside:
            root=Path(directory);(root/'assaultcube').symlink_to(outside,target_is_directory=True)
            with self.assertRaises(ValueError):runtime.configure(root,{'SERVER_PORT':'28020'},'assaultcube')

    def test_only_expected_requested_postready_sauer_interrupt_is_normalized(self):
        cases=[('sauerbraten',-2,True,True,False,True,0),('sauerbraten',130,True,True,False,True,0),
               ('sauerbraten',-2,False,True,False,False,1),('sauerbraten',-2,True,False,False,False,1),
               ('sauerbraten',-2,True,True,True,False,1),('sauerbraten',137,True,True,False,False,137),
               ('assaultcube',0,True,True,False,False,0),('assaultcube',-2,True,True,False,False,1),
               ('sauerbraten',0,False,False,False,False,1)]
        for kind,code,requested,ready,failed,normalized,status in cases:
            with self.subTest(kind=kind,code=code):self.assertEqual(runtime.completion_status(kind,code,requested,ready,failed),(normalized,status))

    def test_known_assault_release_pin(self):
        self.assertEqual(installer.assault_release({'VERSION':'v1.3.0.2'}),installer.AC)
        with patch.object(installer.urllib.request,'urlopen',return_value=io.BytesIO(b'{"tag_name":"v1.3.0.2"}')):
            self.assertEqual(installer.assault_release({'VERSION':'latest'}),installer.AC)

    def test_other_assault_release_digest_required_and_never_silent_fallback(self):
        asset={'name':'AssaultCube.tar.bz2','browser_download_url':'https://github.com/assaultcube/AC/releases/download/v1.2/AssaultCube.tar.bz2','size':123}
        meta=json.dumps({'tag_name':'v1.2','assets':[asset]}).encode()
        with patch.object(installer.urllib.request,'urlopen',side_effect=lambda *a,**k:io.BytesIO(meta)):
            with self.assertRaises(ValueError):installer.assault_release({'VERSION':'v1.2'})
            self.assertEqual(installer.assault_release({'VERSION':'v1.2','RELEASE_SHA256':'a'*64})['sha256'],'a'*64)
        for value in ['../bad','a/b','bad tag']:
            with self.assertRaises(ValueError):installer.assault_release({'VERSION':value})


class CubeProtocolTests(unittest.TestCase):
    def string(self,value):return b''.join(query.putint(b)for b in value.encode())+b'\x00'
    def test_integer_boundaries_and_truncation(self):
        for value in [-2147483648,-32769,-32768,-128,-127,-126,0,127,128,32767,32768,2147483647]:
            self.assertEqual(query.Reader(query.putint(value)).integer(),value)
        for packet in [b'',b'\x80',b'\x80\x01',b'\x81\x00']:
            with self.assertRaises(ValueError):query.Reader(packet).integer()

    def test_native_assault_and_sauer_shapes(self):
        p=query.putint;nonce=1234567
        ac=b''.join(p(v)for v in [nonce,0,1300,2,0,10])+self.string('ac_desert')+self.string('literal $name')+p(8)+p(1)
        result=query.parse('assaultcube',ac,nonce);self.assertEqual(result['map'],'ac_desert');self.assertTrue(result['password']);self.assertEqual(result['maxplayers'],8)
        sauer=b''.join(p(v)for v in [nonce,0,5,260,1,0,4,4])+self.string('')+self.string('Sauer server')
        result=query.parse('sauerbraten',sauer,nonce);self.assertEqual(result['map'],'');self.assertTrue(result['password'])
        altered=b''.join(p(v)for v in [nonce,0,7,260,1,0,4,0,0,75])+self.string('')+self.string('Sauer server')
        self.assertEqual(query.parse('sauerbraten',altered,nonce)['game_speed'],75)
        for kind,packet in [('assaultcube',ac),('sauerbraten',sauer)]:
            with self.assertRaises(ValueError):query.parse(kind,packet,nonce+1)
            for size in range(len(packet)):
                with self.assertRaises(ValueError):query.parse(kind,packet[:size],nonce)


unittest.main()
