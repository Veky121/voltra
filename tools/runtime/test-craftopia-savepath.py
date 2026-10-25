class CraftopiaSavePath(unittest.TestCase):
    def setup_config(self,root,save='savePath=DedicatedServerSave/\n'):
        (root/'Craftopia.x86_64').write_bytes(b'not executed')
        content=('[GameWorld]\nname=before\n[Host]\nport=6587\n[Save]\n; operator comment\nautoSaveSec=77\n'+save+'UnknownSetting=keep\n').encode()
        (root/'ServerSetting.ini').write_bytes(content)
        return content,{'VOLTRA_CRAFTING':'craftopia','SRCDS_APPID':'1670340','SERVER_PORT':'28002','VOLTRA_ALLOCATED_PORTS':'28002','WORLD_NAME':'Literal world'}

    def test_exact_default_uses_publisher_absolute_branch(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);_,env=self.setup_config(root)
            runtime.configure(root,env);value=(root/'ServerSetting.ini').read_text()
            expected=str(root/'DedicatedServerSave')+'/'
            self.assertIn('savePath= '+expected,value)
            # Actual publisher branch: IsAbsolute accepts leading slash;
            # otherwise it concatenates base+raw without adding a separator.
            raw=next(line.split('=',1)[1].strip()for line in value.splitlines()if line.startswith('savePath'))
            native=raw if raw.startswith('/')else str(root)+raw
            self.assertEqual(native,expected)
            self.assertIn('; operator comment',value);self.assertIn('autoSaveSec=77',value);self.assertIn('UnknownSetting=keep',value)

    def test_missing_native_fallback_initializes_default(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);_,env=self.setup_config(root,save='')
            runtime.configure(root,env)
            self.assertIn(str(root/'DedicatedServerSave')+'/',(root/'ServerSetting.ini').read_text())

    def test_missing_save_section_initializes_default(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);_,env=self.setup_config(root)
            (root/'ServerSetting.ini').write_text('[GameWorld]\nname=before\n[Host]\nport=6587\n')
            runtime.configure(root,env)
            self.assertIn('[Save]\nsavePath = '+str(root/'DedicatedServerSave')+'/',(root/'ServerSetting.ini').read_text())

    def test_custom_absolute_and_relative_paths_unchanged(self):
        for value in ['/home/container/OperatorWorld/','custom/worlds/','DedicatedServerSave','./DedicatedServerSave/','']:
            with self.subTest(value=value),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);_,env=self.setup_config(root,'savePath='+value+'\n')
                runtime.configure(root,env)
                self.assertIn('savePath='+value+'\n',(root/'ServerSetting.ini').read_text())

    def test_config_mode_and_numeric_ownership_retained(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);_,env=self.setup_config(root);p=root/'ServerSetting.ini';p.chmod(0o640);os.chown(p,1234,2345)
            runtime.configure(root,env);st=p.stat()
            self.assertEqual((st.st_mode&0o777,st.st_uid,st.st_gid),(0o640,1234,2345))

    def test_default_symlink_escape_fails_before_config_write(self):
        with tempfile.TemporaryDirectory()as directory,tempfile.TemporaryDirectory()as outside:
            root=Path(directory);before,env=self.setup_config(root);(root/'DedicatedServerSave').symlink_to(outside,target_is_directory=True)
            with self.assertRaises(ValueError):runtime.configure(root,env)
            self.assertEqual((root/'ServerSetting.ini').read_bytes(),before)
            self.assertEqual(list(Path(outside).iterdir()),[])

    def test_default_file_conflict_fails_before_config_write(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);before,env=self.setup_config(root);(root/'DedicatedServerSave').write_text('operator file')
            with self.assertRaises(ValueError):runtime.configure(root,env)
            self.assertEqual((root/'ServerSetting.ini').read_bytes(),before)

    def test_duplicate_save_key_fails_before_config_write(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);before,env=self.setup_config(root,'savePath=DedicatedServerSave/\nsavePath=custom/\n')
            with self.assertRaises(ValueError):runtime.configure(root,env)
            self.assertEqual((root/'ServerSetting.ini').read_bytes(),before)

    def test_craftopia_relay_lifecycle_preserves_native_exit(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);events=[];relay=mock.Mock()
            relay.start.side_effect=lambda:events.append('start')
            relay.finish.side_effect=lambda:events.append('finish')or False
            factory=mock.Mock(return_value=relay)
            with mock.patch.dict(sys.modules,{'native_log':types.SimpleNamespace(NativeLogRelay=factory)}),mock.patch.object(runtime,'configure',return_value=([],{},['secret'],b'ready','\x03')),mock.patch.object(runtime,'run',side_effect=lambda *a,**k:events.append('native')or 250):
                self.assertEqual(runtime.main(root,{'VOLTRA_CRAFTING':'craftopia','AUTO_UPDATE':'0'}),250)
            self.assertEqual(events,['start','native','finish'])
            self.assertEqual(factory.call_args.kwargs,{'relative_directory':'.config/unity3d/PocketPair/Craftopia/Logs_DS','prefix':'PlayerLog_','suffix':'.log','credentials':['secret']})

    def test_craftopia_relay_finishes_when_native_raises(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);relay=mock.Mock();factory=mock.Mock(return_value=relay)
            with mock.patch.dict(sys.modules,{'native_log':types.SimpleNamespace(NativeLogRelay=factory)}),mock.patch.object(runtime,'configure',return_value=([],{},[],b'ready','\x03')),mock.patch.object(runtime,'run',side_effect=RuntimeError('native launch failure')):
                with self.assertRaisesRegex(RuntimeError,'native launch failure'):runtime.main(root,{'VOLTRA_CRAFTING':'craftopia','AUTO_UPDATE':'0'})
            relay.start.assert_called_once();relay.finish.assert_called_once()

unittest.main()
