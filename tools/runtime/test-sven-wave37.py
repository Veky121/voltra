class SvenRepairTests(unittest.TestCase):
    fixture = SourceThirdTests.fixture
    def test_hyphen_maps_private_bootstrap_and_precedence(self):
        for name in ('fixture-map', 'folder/fixture-map'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root=Path(directory); env=self.fixture(root,'sven',SC_MAP=name,SC_PASSWORD='p'*20,SC_NAME='n'*40)
                cfg=root/'svencoop/server.cfg';cfg.parent.mkdir();cfg.write_bytes(b'// operator\r\nexec plugins.cfg\r\n');cfg.chmod(0o640)
                before=(cfg.read_bytes(),cfg.stat().st_mode,cfg.stat().st_uid,cfg.stat().st_gid)
                argv,_,query=runtime.configure(root,env)
                self.assertNotIn('+map',argv);self.assertNotIn(name,argv)
                self.assertEqual(argv[-2:],['+exec','voltra_bootstrap.cfg'])
                bootstrap=cfg.with_name('voltra_bootstrap.cfg')
                self.assertEqual(bootstrap.read_text(),'servercfgfile voltra_server.cfg\nmap "'+name+'"\nexec voltra_managed.cfg\n')
                self.assertEqual(bootstrap.stat().st_mode & 0o777,0o600)
                self.assertEqual(cfg.with_name('voltra_server.cfg').read_text(),'exec server.cfg\nexec voltra_managed.cfg\n')
                self.assertEqual(before,(cfg.read_bytes(),cfg.stat().st_mode,cfg.stat().st_uid,cfg.stat().st_gid))
                self.assertEqual(query[2],name)

    def test_invalid_inputs_leave_all_config_bytes_unchanged(self):
        for key,value in [('SC_NAME','n'*41),('SC_PASSWORD','p'*21),('SC_MAP','bad;quit'),('SC_MAP','bad+quit'),('SC_MAP','bad\nquit'),('SC_MAP','../bad'),('SC_MAP','bad"'),('SC_MAP','bad\\x'),('SC_NAME','bad;quit'),('SC_PASSWORD','bad;quit')]:
            with self.subTest(key=key,value=value),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);env=self.fixture(root,'sven',SC_MAP='fixture-map');runtime.configure(root,env)
                paths=list((root/'svencoop').iterdir());before={p:p.read_bytes() for p in paths}
                with self.assertRaises(ValueError):runtime.configure(root,{**env,key:value})
                self.assertEqual(before,{p:p.read_bytes() for p in paths})

    def test_bootstrap_escape_refused_before_managed_writes(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as outside:
            root=Path(directory);env=self.fixture(root,'sven');folder=root/'svencoop';folder.mkdir()
            target=Path(outside)/'external.cfg';target.write_bytes(b'outside')
            (folder/'voltra_bootstrap.cfg').symlink_to(target)
            with self.assertRaises(ValueError):runtime.configure(root,env)
            self.assertFalse((folder/'voltra_managed.cfg').exists());self.assertEqual(target.read_bytes(),b'outside')

    def test_mock_update_run_query_raw_exit_and_failures(self):
        for failure in ('none','update','run'):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);env=self.fixture(root,'sven',SC_MAP='fixture-map',AUTO_UPDATE='1');observed=threading.Event()
                def query(*args,**kwargs):
                    self.assertEqual(args[2],'fixture-map');observed.set();args[-1].wait(1)
                def child(*args,**kwargs):
                    self.assertNotIn('+map',args[1]);kwargs['output_observer'](b'mocked output\n')
                    if failure=='run':raise RuntimeError('mock run failure')
                    return 250
                with mock.patch.object(runtime,'install',side_effect=RuntimeError('mock update failure') if failure=='update' else None) as update,mock.patch.object(runtime,'run',side_effect=child) as run,mock.patch.object(runtime.source_l4d,'query_ready',side_effect=query) as observer:
                    if failure=='none':self.assertEqual(runtime.main(root,env),250)
                    else:
                        with self.assertRaises(RuntimeError):runtime.main(root,env)
                    update.assert_called_once_with(root,env,validate=False)
                    if failure=='update':run.assert_not_called();observer.assert_not_called()
                    else:self.assertTrue(observed.is_set())

