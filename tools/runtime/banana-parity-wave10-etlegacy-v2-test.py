"""Run original candidate fixtures plus quoted-head refusal regressions."""
from pathlib import Path

original = Path(__file__).with_name('banana-parity-wave10-etlegacy-test.py')
text = original.read_text().replace('banana-parity-wave10-etlegacy-authority.py',
                                    'banana-parity-wave10-etlegacy-authority-v2.py')
text = text.replace('unittest.main()', '')
exec(compile(text, str(original), 'exec'))


def quoted_aliases_refuse(self):
    for line in ['set "g_password" "hidden"', '"g_password" "hidden"',
                 '"set" g_password "hidden"', '"set"g_password "hidden"',
                 'set"g_password" "hidden"', 'seta "SV_HOSTNAME" "hidden"',
                 'sets "sv_privatepassword" "hidden"',
                 'setu "refereePassword" "hidden"',
                 'set "shoutcastPassword" "hidden"']:
        with self.subTest(line=line), tempfile.TemporaryDirectory() as directory:
            root = Path(directory); game = self.game(root)
            target = game / 'userdata/legacy/voltra-native.cfg'
            target.parent.mkdir(parents=True)
            target.write_text('set g_password "first"\n' + line + '\n')
            before = self.snapshot(root)
            with self.assertRaises(ValueError): candidate.configure(root, {})
            self.assertEqual(self.snapshot(root), before)


def unknown_quoted_scalars_preserved(self):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory); game = self.game(root)
        target = game / 'userdata/legacy/voltra-native.cfg'
        target.parent.mkdir(parents=True)
        text = 'set "operator_unknown" "preserve"\nset sv_hostname "Owner"\n'
        target.write_text(text)
        candidate.configure(root, {})
        self.assertEqual(target.read_text(), text)


ETLegacyAuthorityTests.test_quoted_known_aliases_refuse_before_writes = quoted_aliases_refuse
ETLegacyAuthorityTests.test_unknown_quoted_scalars_are_retained = unknown_quoted_scalars_preserved
unittest.main()
