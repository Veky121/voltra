"""MIT. Real PE thunk parsing regressions, no native execution."""
import importlib.util
from pathlib import Path
import struct
import unittest

spec = importlib.util.spec_from_file_location('star_pe_imports', Path(__file__).with_name('generate-imports.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture():
    b = bytearray(4096)
    b[:2] = b'MZ'
    struct.pack_into('<I', b, 60, 0x80)
    b[0x80:0x84] = b'PE\0\0'
    struct.pack_into('<HH', b, 0x84, 0x8664, 1)
    struct.pack_into('<H', b, 0x94, 0xf0)
    struct.pack_into('<H', b, 0x98, 0x20b)
    struct.pack_into('<IIII', b, 0x188 + 8, 0xe00, 0x1000, 0xe00, 0x200)
    struct.pack_into('<I', b, 0x98 + 120, 0x1000)
    struct.pack_into('<5I', b, 0x200, 0x1080, 0, 0, 0x1060, 0x1080)
    b[0x260:0x260 + 13] = b'KERNEL32.dll\0'
    struct.pack_into('<QQQ', b, 0x280, 0x10c0, (1 << 63) | 123, 0)
    b[0x2c0:0x2c0 + 17] = b'\0\0GetProcAddress\0'
    struct.pack_into('<I', b, 0x98 + 112 + 13 * 8, 0x1100)
    struct.pack_into('<8I', b, 0x300, 1, 0x1160, 0, 0x1180, 0x1180, 0, 0, 0)
    b[0x360:0x360 + 11] = b'DELAY.dll\0\0'
    struct.pack_into('<QQ', b, 0x380, 0x11c0, 0)
    b[0x3c0:0x3c0 + 11] = b'\0\0DelayFoo\0'
    return b


class ImportParser(unittest.TestCase):
    def test_named_ordinal_and_delay(self):
        normal, delayed = module.imports(fixture())
        self.assertEqual(normal, {'kernel32.dll': ['GetProcAddress', '#123']})
        self.assertEqual(delayed, {'delay.dll': ['DelayFoo']})

    def test_non_rva_delay_fails_closed(self):
        body = fixture()
        struct.pack_into('<I', body, 0x300, 0)
        with self.assertRaises(ValueError): module.imports(body)

    def test_unmapped_thunk_fails_closed(self):
        body = fixture()
        struct.pack_into('<I', body, 0x200, 0x999999)
        with self.assertRaises(ValueError): module.imports(body)


if __name__ == '__main__': unittest.main()
