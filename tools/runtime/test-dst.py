import sys,types,tempfile,unittest,os,subprocess,select,time
from pathlib import Path
ini=types.ModuleType('native_config');exec(INI_SOURCE,ini.__dict__);sys.modules['native_config']=ini
dst=types.ModuleType('dst_config');exec(DST_SOURCE,dst.__dict__)
sys.modules['dst_config']=dst
steam=types.ModuleType('steam_template');exec(STEAM_SOURCE,steam.__dict__);sys.modules['steam_template']=steam
installer=types.ModuleType('dst_install');exec(INSTALL_SOURCE,installer.__dict__)
sys.modules['dst_install']=installer
shards=types.ModuleType('native_shards');exec(SHARDS_SOURCE,shards.__dict__);sys.modules['native_shards']=shards
runtime=types.ModuleType('dst_runtime');exec(RUNTIME_SOURCE,runtime.__dict__)

def environment():
    return {'SERVER_PORT':'10998','VOLTRA_ALLOCATED_PORTS':'10998,10999,23563,23565,23567,23569','ONLINE_MODE':'0'}

class NativeConfigurationTests(unittest.TestCase):
    def test_comments_unknown_options_crlf_and_idempotence(self):
        content='; operator\r\n[NETWORK]\r\ncluster_name = old\r\ncustom = unchanged\r\n[OTHER]\r\nkeep = yes\r\n'
        values={'NETWORK':{'cluster_name':'literal $name "quote"','lan_only':'true'}}
        result=ini.patch_ini(content,values)
        self.assertIn('; operator\r\n',result);self.assertIn('custom = unchanged\r\n',result)
        self.assertIn('keep = yes\r\n',result);self.assertIn('cluster_name = literal $name "quote"\r\n',result)
        self.assertEqual(ini.patch_ini(result,values),result)

    def test_duplicate_managed_keys_and_sections_rejected(self):
        for content in ['[NETWORK]\na=1\na=2\n','[NETWORK]\na=1\n[NETWORK]\na=2\n']:
            with self.assertRaises(ValueError):ini.patch_ini(content,{'NETWORK':{'a':'3'}})

    def test_two_shards_have_distinct_allocated_ports_and_private_shared_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);result=dst.configure(root,environment())
            cluster=result['cluster'];master=(cluster/'Master/server.ini').read_text();caves=(cluster/'Caves/server.ini').read_text()
            self.assertIn('server_port = 10998',master);self.assertIn('server_port = 10999',caves)
            self.assertIn('master_server_port = 23563',master);self.assertIn('authentication_port = 23569',caves)
            self.assertNotIn(result['internal_shard_port'],result['ports'])
            self.assertIn('offline_cluster = true',(cluster/'cluster.ini').read_text())
            self.assertEqual((root/'.voltra/dst/shard-key').stat().st_mode&511,0o600)
            before=(root/'.voltra/dst/shard-key').read_text();dst.configure(root,environment())
            self.assertEqual((root/'.voltra/dst/shard-key').read_text(),before)

    def test_online_token_required_before_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with self.assertRaises(ValueError):dst.configure(root,{**environment(),'ONLINE_MODE':'1'})
            self.assertEqual(list(root.iterdir()),[])

    def test_existing_token_world_and_mods_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);cluster=root/'DoNotStarveTogether/config/server';cluster.mkdir(parents=True)
            token=cluster/'cluster_token.txt';token.write_text('operator-existing-credential\n')
            world=cluster/'Master/save/session/world';world.parent.mkdir(parents=True);world.write_bytes(b'operator-native-world')
            mods=cluster/'Master/modoverrides.lua';mods.write_text('return { operator_mod = { enabled = true } }')
            dst.configure(root,{**environment(),'ONLINE_MODE':'1'})
            self.assertEqual(token.read_text(),'operator-existing-credential\n');self.assertEqual(token.stat().st_mode&511,0o600)
            self.assertEqual(world.read_bytes(),b'operator-native-world');self.assertIn('operator_mod',mods.read_text())

    def test_invalid_settings_do_not_create_state(self):
        for key,value in [('CLUSTER_ID','../world'),('CLUSTER_NAME','bad\n[SHARD]'),('VOLTRA_ALLOCATED_PORTS','23560,23561'),('MAX_PLAYERS','32'),('GAME_MODE','invalid'),('PVP','true')]:
            with self.subTest(key=key),tempfile.TemporaryDirectory() as directory:
                root=Path(directory)
                with self.assertRaises(ValueError):dst.configure(root,{**environment(),key:value})
                self.assertEqual(list(root.iterdir()),[])

    def test_symlink_escape_rejected_without_writing_outside(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as outside:
            root=Path(directory);(root/'DoNotStarveTogether').symlink_to(outside,target_is_directory=True)
            with self.assertRaises(ValueError):dst.configure(root,environment())
            self.assertEqual(list(Path(outside).iterdir()),[])

    def test_private_credential_symlink_escape_rejected(self):
        for relative in ['.voltra/dst/shard-key','DoNotStarveTogether/config/server/cluster_token.txt']:
            with self.subTest(path=relative),tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as outside:
                root=Path(directory);credential=Path(outside)/'credential';credential.write_text('a'*64)
                link=root/relative;link.parent.mkdir(parents=True);link.symlink_to(credential)
                with self.assertRaises(ValueError):dst.configure(root,environment())
                self.assertEqual(credential.read_text(),'a'*64)

    def test_mod_setup_preserved_when_steam_validation_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);target=root/'mods/dedicated_server_mods_setup.lua';target.parent.mkdir()
            original=b'-- operator\nServerModSetup("123456")\n';target.write_bytes(original)
            def failed_update(*args,**kwargs):
                target.write_text('-- publisher replacement')
                raise RuntimeError('fixture Steam failure')
            previous=installer.update;installer.update=failed_update
            try:
                with self.assertRaises(RuntimeError):installer.update_game(root)
            finally:installer.update=previous
            self.assertEqual(target.read_bytes(),original)
            self.assertEqual(len(list((root/'.voltra/dst/publisher-file-backups').glob('*.lua'))),1)

    def test_launcher_reuses_identity_and_keeps_secrets_out_of_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);binary=root/installer.BINARY;binary.parent.mkdir();binary.write_text('fixture native binary')
            specs,env,credentials=runtime.launch(root,{**environment(),'SERVER_TOKEN':'fixture-private-token','PYTHONHOME':'wrong-python','LD_PRELOAD':'wrong-library'})
            self.assertEqual([spec['name'] for spec in specs],['Master','Caves'])
            self.assertTrue(all('fixture-private-token' not in spec['argv'] for spec in specs))
            self.assertTrue(all('server' in spec['argv'] for spec in specs))
            self.assertEqual([spec['argv'][spec['argv'].index('-port')+1] for spec in specs],['10998','10999'])
            self.assertNotIn('PYTHONHOME',env);self.assertNotIn('LD_PRELOAD',env)
            self.assertEqual(env['LD_LIBRARY_PATH'],str(root/'bin64/lib64'))
            self.assertIn('fixture-private-token',credentials)

    def test_readiness_uses_connected_worlds_with_pause_disabled(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);binary=root/installer.BINARY;binary.parent.mkdir();binary.write_text('fixture native binary')
            specs,_,_=runtime.launch(root,{**environment(),'PAUSE_EMPTY':'0'})
            self.assertEqual([spec['ready'] for spec in specs],[b'[Shard] Secondary Caves(2) ready!',b'[Shard] secondary shard LUA is now ready!'])

    def test_file_only_token_and_shard_key_are_redacted(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);binary=root/installer.BINARY;binary.parent.mkdir();binary.write_text('fixture native binary')
            token=root/'DoNotStarveTogether/config/server/cluster_token.txt';token.parent.mkdir(parents=True);token.write_text('file-only-private-token\n')
            specs,env,credentials=runtime.launch(root,{**environment(),'ONLINE_MODE':'1'})
            key=(root/'.voltra/dst/shard-key').read_text().strip()
            self.assertIn('file-only-private-token',credentials);self.assertIn(key,credentials)
            redactor=steam.Redactor(credentials)
            filtered=redactor.feed(('file-only-private-token '+key).encode(),final=True)
            self.assertNotIn(b'file-only-private-token',filtered);self.assertNotIn(key.encode(),filtered)
            self.assertTrue(all('file-only-private-token' not in spec['argv'] and key not in spec['argv'] for spec in specs))

    def test_existing_worldgen_files_never_downloaded_or_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for shard in ['Master','Caves']:
                target=root/'DoNotStarveTogether/config/server'/shard/'worldgenoverride.lua';target.parent.mkdir(parents=True);target.write_text('return { operator = true }')
            installer.worldgen(root,{'MASTER_WORLDGEN':'not a URL','CAVES_WORLDGEN':'not a URL'})
            self.assertTrue(all('operator' in path.read_text() for path in root.rglob('worldgenoverride.lua')))

    def test_lan_gameplay_port_range_is_enforced_before_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with self.assertRaises(ValueError):dst.configure(root,{'SERVER_PORT':'23560','VOLTRA_ALLOCATED_PORTS':'23560,23561,23562,23563,23564,23565','ONLINE_MODE':'0'})
            self.assertEqual(list(root.iterdir()),[])
            result=dst.configure(root,{'SERVER_PORT':'23560','VOLTRA_ALLOCATED_PORTS':'23560,23561,23562,23563,23564,23565','ONLINE_MODE':'1','SERVER_TOKEN':'fixture-token'})
            self.assertEqual(result['ports'][:2],[23560,23561])

    def supervisor_fixture(self,root,failing=False):
        (root/'steam_template.py').write_text(STEAM_SOURCE);(root/'native_shards.py').write_text(SHARDS_SOURCE)
        (root/'engine.py').write_text('import sys,time\nname=sys.argv[1]\nprint("READY",flush=True)\nprint("dummy-private-credential",flush=True)\nif len(sys.argv)>2 and sys.argv[2]=="fail": time.sleep(0.2);sys.exit(7)\nif len(sys.argv)>2 and sys.argv[2]=="reported": print("FATAL",flush=True)\nfor line in sys.stdin:\n print(name+":"+line.strip(),flush=True)\n if line.strip()=="c_shutdown()": break\n')
        tag='reported' if failing=='reported' else 'fail'
        spec='[{"name":name,"argv":[sys.executable,"engine.py",name]+(['+repr(tag)+'] if name=="Caves" and '+str(bool(failing))+' else []),"ready":b"READY","failed":(b"FATAL",)} for name in ["Master","Caves"]]'
        return 'from native_shards import run\nimport os,sys\nfrom pathlib import Path\nraise SystemExit(run(Path.cwd(),'+spec+',dict(os.environ),"c_shutdown()",["dummy-private-credential"]))'

    def test_supervisor_routes_console_and_stops_both_shards(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);script=self.supervisor_fixture(root)
            child=subprocess.Popen([sys.executable,'-u','-c',script],cwd=root,env={**os.environ,'PYTHONPATH':str(root)},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            output=b''
            try:
                deadline=time.monotonic()+10
                while b'VOLTRA_SHARDS_READY' not in output:
                    self.assertLess(time.monotonic(),deadline)
                    if select.select([child.stdout],[],[],0.2)[0]:output+=os.read(child.stdout.fileno(),65536)
                child.stdin.write(b'Caves> probe-cave\nprobe-master\nc_shutdown()\n');child.stdin.flush()
                self.assertEqual(child.wait(timeout=10),0);output+=child.stdout.read()
                self.assertIn(b'Caves:probe-cave',output);self.assertIn(b'Master:probe-master',output)
                self.assertIn(b'Master:c_shutdown()',output);self.assertIn(b'Caves:c_shutdown()',output)
                self.assertNotIn(b'dummy-private-credential',output)
            finally:
                if child.poll() is None:child.kill();child.wait()
                child.stdin.close();child.stdout.close()

    def test_failed_shard_stops_its_sibling_and_returns_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);script=self.supervisor_fixture(root,True)
            child=subprocess.run([sys.executable,'-u','-c',script],cwd=root,env={**os.environ,'PYTHONPATH':str(root)},input=b'',stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=10)
            self.assertEqual(child.returncode,1);self.assertIn(b'Master:c_shutdown()',child.stdout)
            self.assertNotIn(b'dummy-private-credential',child.stdout)

    def test_reported_fatal_failure_stops_live_processes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);script=self.supervisor_fixture(root,'reported')
            child=subprocess.run([sys.executable,'-u','-c',script],cwd=root,env={**os.environ,'PYTHONPATH':str(root)},input=b'',stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=10)
            self.assertEqual(child.returncode,1)
            self.assertIn(b'Master:c_shutdown()',child.stdout);self.assertIn(b'Caves:c_shutdown()',child.stdout)

unittest.main()
