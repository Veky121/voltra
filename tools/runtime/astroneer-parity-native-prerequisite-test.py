"""Offline install dependency refusal, using actual wrapper and temporary files."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('astro_dependency', BASE / 'internal/panel/game_library/scripts/astroneer-parity.py')
astro = importlib.util.module_from_spec(spec)
spec.loader.exec_module(astro)


class VulkanPrerequisite(unittest.TestCase):
    def test_missing_vulkan_refuses_before_acquisition_or_config_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            operator = root / 'operator.ini'
            operator.write_bytes(b'keep exact\r\n')
            with patch.object(astro, 'VULKAN_LIBRARY', root / 'missing-libvulkan.so.1'), patch.object(astro.legacy, 'install') as install, patch.object(astro, 'configure') as configure:
                with self.assertRaisesRegex(ValueError, 'libvulkan1'):
                    astro.install(root, {'PUBLIC_IP':'8.8.8.8','SERVER_PORT':'8777','VOLTRA_ALLOCATED_PORTS':'8777'})
                install.assert_not_called()
                configure.assert_not_called()
            self.assertEqual(operator.read_bytes(), b'keep exact\r\n')
            self.assertEqual([item.name for item in root.iterdir()], ['operator.ini'])

    def test_present_dependency_retains_shared_install_then_configuration(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            library = root / 'libvulkan.so.1'
            library.write_bytes(b'fixture loader boundary')
            calls = []
            with patch.object(astro, 'VULKAN_LIBRARY', library), patch.object(astro.legacy, 'identity', side_effect=lambda *args: calls.append('identity')), patch.object(astro.legacy, 'install', side_effect=lambda *args: calls.append('install')), patch.object(astro, 'configure', side_effect=lambda *args: calls.append('configure')):
                astro.install(root, {'PUBLIC_IP':'8.8.8.8','SERVER_PORT':'8777','VOLTRA_ALLOCATED_PORTS':'8777'})
            self.assertEqual(calls, ['identity', 'install', 'configure'])

    def test_directory_cannot_satisfy_library_preflight(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(astro.legacy, 'install') as install:
            with patch.object(astro, 'VULKAN_LIBRARY', Path(folder)):
                with self.assertRaises(ValueError):
                    astro.install(Path(folder), {})
            install.assert_not_called()


if __name__ == '__main__':
    unittest.main()
