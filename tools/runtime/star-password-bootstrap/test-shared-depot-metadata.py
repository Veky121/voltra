"""MIT. Execute actual staged pure controller functions; no worker/network call."""
import ast
import copy
import json
from pathlib import Path
import re
import unittest

SOURCE = Path(__file__).with_name('shared-depot-metadata-once.py')
tree = ast.parse(SOURCE.read_text())
names = {'fixed_request', 'decimal', 'validate_metadata', 'shared_selection'}
nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
nodes += [node for node in tree.body if isinstance(node, ast.Assign) and any(
    isinstance(target, ast.Name) and target.id in {'EXPECTED_WORKER', 'APP_ID', 'TARGET_DEPOT'} for target in node.targets)]
scope = {'re': re}
exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), scope)


def metadata():
    return {'app_id': 228980, 'state': 'fixture', 'entitlement_verified': False, 'content_downloaded': False,
            'branches': [{'name': 'public', 'build_id': '25642172'}], 'depots': [{
                'depot_id': 228989, 'from_app_id': None, 'platforms': ['windows'], 'architecture': 64,
                'manifests': [{'branch': 'public', 'manifest_id': '3659990775896995763',
                               'disk_bytes': '21349240119', 'download_bytes': '2653127216'}]}]}


class SharedMetadata(unittest.TestCase):
    def test_fixed_request_is_anonymous_one_owner_app(self):
        request = scope['fixed_request']()
        self.assertEqual(request['app_id'], 228980)
        self.assertEqual(request['operation'], 'anonymous_metadata')
        for key in ('username', 'password', 'guard', 'beta_password'): self.assertIsNone(request[key])
        self.assertEqual(scope['EXPECTED_WORKER'], 'cea92b57d34a3bdeba7c7135f48532c9427762d04c1bf361edaec46279ea15b2')

    def test_lossless_selection(self):
        value = scope['shared_selection'](json.loads(json.dumps(metadata())))
        self.assertEqual(value['depot_id'], 228989)
        self.assertEqual(value['public_manifest']['manifest_id'], '3659990775896995763')
        self.assertIsInstance(value['public_manifest']['disk_bytes'], str)
        self.assertFalse(value['entitlement_verified'])

    def test_numeric_lossy_tokens_are_rejected(self):
        for bad in (3659990775896995763, True, '01', '+1', '1e3', ' 1', '18446744073709551616', '１２'):
            value = metadata(); value['depots'][0]['manifests'][0]['manifest_id'] = bad
            with self.assertRaises(ValueError): scope['validate_metadata'](value)

    def test_uint64_boundaries_and_nullable_footprint(self):
        self.assertEqual(scope['decimal']('18446744073709551615'), '18446744073709551615')
        value = metadata(); value['depots'][0]['manifests'][0]['disk_bytes'] = None
        self.assertIsNone(scope['shared_selection'](value)['public_manifest']['disk_bytes'])
        value['depots'][0]['manifests'][0]['manifest_id'] = '0'
        with self.assertRaises(ValueError): scope['validate_metadata'](value)

    def test_missing_target_never_guesses_identity(self):
        value = metadata(); value['depots'] = []
        self.assertEqual(scope['shared_selection'](value)['state'], 'target_not_returned')

    def test_missing_public_manifest_never_uses_other_branch(self):
        value = metadata(); value['depots'][0]['manifests'][0]['branch'] = 'preview'
        selection = scope['shared_selection'](value)
        self.assertEqual(selection['state'], 'public_manifest_not_returned')
        self.assertIsNone(selection['public_manifest'])

    def test_wrong_app_duplicates_and_content_claim_fail(self):
        for modify in (lambda v: v.update(app_id=3809400),
                       lambda v: v.update(content_downloaded=True),
                       lambda v: v['depots'].append(copy.deepcopy(v['depots'][0])),
                       lambda v: v['depots'][0]['manifests'].append(copy.deepcopy(v['depots'][0]['manifests'][0]))):
            value = metadata(); modify(value)
            with self.assertRaises(ValueError): scope['validate_metadata'](value)

    def test_transport_and_bounds_preserved_without_invocation(self):
        source = SOURCE.read_text()
        self.assertIn('HARD_SECONDS = 35', source)
        self.assertIn('MAX_FRAME = 65536', source)
        self.assertIn('F_SEAL_WRITE', source)
        self.assertNotIn('app_update', source)
        self.assertEqual(source.count('subprocess.Popen('), 1)
        ast.parse(source)


if __name__ == '__main__': unittest.main()
