import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('proposal', Path(__file__).with_name('stk-settings-proposal.py'))
proposal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proposal)


class Tests(unittest.TestCase):
    def test_typed_fields_unknowns_and_secrets(self):
        data = b'<server-config version="6"><chat value="true"/><voting-timeout value="30"/><private-server-password value="secret"/><operator-extension/></server-config>'
        self.assertEqual(proposal.parse(data), {'chat': True, 'voting-timeout': 30})

    def test_unsafe_ambiguous_and_unsupported_documents(self):
        for data in [b'<!DOCTYPE a><server-config version="6"/>', b'<server-config version="7"/>', b'<server-config version="6"><chat value="true"/><chat value="false"/></server-config>', b'<server-config version="6"><chat value="yes"/></server-config>', b'<server-config version="6"><voting-timeout value="0"/></server-config>']:
            with self.subTest(data=data), self.assertRaises(ValueError):
                proposal.parse(data)


if __name__ == '__main__':
    unittest.main()
