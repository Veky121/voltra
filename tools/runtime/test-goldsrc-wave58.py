#!/usr/bin/env python3
"""Wave58 offline boundaries; no publisher or native process is run."""
import importlib.util
from pathlib import Path
import sys
from unittest.mock import patch
import unittest
spec = importlib.util.spec_from_file_location('prior_goldsrc_tests', Path(__file__).with_name('test-goldsrc.py'))
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)
runtime, installer = prior.runtime, prior.installer

class PreflightTests(prior.GoldSrcTest):
    def env_for(self, flavor):
        return {**self.env, 'VOLTRA_GOLDSRC_RECIPE': flavor, 'HLDS_GAME': 'valve',
                'SRCDS_MAP': 'crossfire', 'SRCDS_BETAID': 'steam_legacy' if flavor == 'rehlds' else ''}

    def test_invalid_prerequisites_leave_all_bytes_unchanged(self):
        for flavor in ('generic', 'rehlds'):
            invalid = [('SERVER_PORT', '0'), ('VAC_PORT', '28100'), ('SRCDS_MAP', '../escape'),
                       ('HOSTNAME', 'bad;quit'), ('SERVER_PASSWORD', 'bad\nquit'),
                       ('SRV_SLOTS', '33'), ('AUTO_UPDATE', 'yes'), ('VALIDATE', 'yes'),
                       ('STEAM_PASS', 'private'), ('SRCDS_BETAPASS', 'private'),
                       ('SRCDS_BETAID', '+quit')]
            if flavor == 'rehlds': invalid += [('VERSION', '../../escape'), ('SRCDS_BETAID', '')]
            for key, value in invalid:
                with self.subTest(flavor=flavor, key=key):
                    env = {**self.env_for(flavor), key: value}
                    before = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
                    with patch.object(installer, 'update') as update, patch.object(prior.rehlds, 'overlay') as overlay:
                        with self.assertRaises(ValueError): installer.install(self.root, env)
                        update.assert_not_called(); overlay.assert_not_called()
                    with self.assertRaises(ValueError): runtime.configure(self.root, env)
                    after = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
                    self.assertEqual(before, after)
                    self.assertFalse((self.root / '.voltra').exists())

    def test_positive_install_publisher_boundary_is_mocked(self):
        for flavor in ('generic', 'rehlds'):
            env = self.env_for(flavor)
            with patch.object(installer, 'update') as update, patch.object(prior.rehlds, 'overlay') as overlay:
                installer.install(self.root, env)
                update.assert_called_once()
                self.assertEqual(update.call_args.kwargs['required'], ('hlds_run', 'hlds_linux', 'valve/liblist.gam'))
                self.assertEqual(overlay.call_count, int(flavor == 'rehlds'))
            argv, _ = runtime.configure(self.root, env)
            self.assertEqual(argv[-2:], ['+exec', 'voltra_bootstrap.cfg'])
            self.assertNotIn(env['HOSTNAME'], argv)
            for name in ('voltra_managed.cfg', 'voltra_server.cfg', 'voltra_bootstrap.cfg', 'banned.cfg', 'listip.cfg'):
                self.assertTrue((self.root / 'valve' / name).is_file())

if __name__ == '__main__': unittest.main(verbosity=2)
