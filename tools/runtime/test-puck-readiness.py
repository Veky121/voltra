import contextlib
import importlib.util
import io
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('puck_readiness', ROOT / 'internal/panel/game_library/scripts/puck-readiness.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReadinessTest(unittest.TestCase):
    def setUp(self):
        self.env = dict(SERVER_TICK_RATE='100', CLIENT_TICK_RATE='360', FRAME_RATE='120', KICK_TIMEOUT='300', QUERY_PORT='28012')
        self.proof = dict(serverPhysicsTick=100, advertisedClientInputTick=360, engineTargetFrameRate=120,
                          configuredKickTimeout=300, nativeQueryPort=28012, nativeQueryListening=True,
                          failure=None, probedNativeKickTweenSeconds=300.0)

    def line(self, proof):
        return b'[VoltraLegacyControls] Native proof ' + json.dumps(proof).encode() + b'\n'

    def test_fragmentation_and_both_readiness_orders(self):
        for scene_first in [True, False]:
            observer = module.PuckObserver(self.env)
            scene = b'Puck B1235 is ready to accept clients on localhost\n'
            lines = [scene, self.line(self.proof)] if scene_first else [self.line(self.proof), scene]
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                for line in lines:
                    for byte in line:
                        observer(bytes([byte]))
                observer(scene)
            self.assertTrue(observer.emitted)
            self.assertEqual(output.getvalue().count('Voltra Puck compatibility ready'), 1)

    def test_invalid_proofs_never_ready(self):
        mutations = [('probedNativeKickTweenSeconds', float('nan')), ('probedNativeKickTweenSeconds', float('inf')),
                     ('probedNativeKickTweenSeconds', None), ('probedNativeKickTweenSeconds', True),
                     ('nativeQueryListening', 1), ('serverPhysicsTick', 100.0), ('configuredKickTimeout', False),
                     ('failure', ''), ('nativeQueryPort', 28013)]
        for key, value in mutations:
            with self.subTest(key=key, value=value):
                observer = module.PuckObserver(self.env)
                with self.assertRaises(ValueError):
                    observer(self.line({**self.proof, key:value}))
                self.assertFalse(observer.emitted)

    def test_duplicate_keys_and_non_object(self):
        for payload in [b'{"x":1,"x":2}', b'[]', b'{']:
            with self.assertRaises(ValueError):
                module.PuckObserver(self.env)(b'[VoltraLegacyControls] Native proof '+payload+b'\n')

    def test_bound_is_per_line_and_restart_is_fresh(self):
        observer = module.PuckObserver(self.env)
        observer(b'log\n' * 300000)
        with self.assertRaises(ValueError):
            observer(b'x' * (observer.limit + 1))
        self.assertFalse(module.PuckObserver(self.env).emitted)

    def test_plugin_failure(self):
        with self.assertRaises(ValueError):
            module.PuckObserver(self.env)(b'[VoltraLegacyControls] Compatibility initialization failed: missing API\n')


if __name__ == '__main__':
    unittest.main()
