import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock
import zipfile

spec = importlib.util.spec_from_file_location("installer", Path(__file__).with_name("minecraft-install.py"))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def archive(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zipped:
        for name, data in files.items():
            zipped.writestr(name, data)
    return output.getvalue()


class MinecraftInstallerTests(unittest.TestCase):
    def test_archive_download_streams_verifies_and_extracts_from_disk(self):
        data = archive({'mods/server.jar': b'content', 'run.sh': b'never execute'})
        selection = {'url': 'https://edge.forgecdn.net/pack.zip', 'algorithm': 'sha256', 'hash': hashlib.sha256(data).hexdigest()}
        class Response(io.BytesIO):
            headers = {'Content-Length': str(len(data))}
            def read(self, count=-1):
                if count < 0 or count > 1024**2:
                    raise AssertionError('Archive must be read in bounded blocks')
                return super().read(count)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'download.zip'
            root = Path(directory) / 'server'
            with mock.patch.object(installer.OPENER, 'open', return_value=Response(data)):
                installer.verified_archive(selection, path)
            self.assertEqual(path.read_bytes(), data)
            installer.unpack(path, root, [''])
            self.assertEqual((root / 'mods/server.jar').read_bytes(), b'content')
            self.assertFalse((root / 'run.sh').exists())

    def test_archive_failure_cleanup_and_size_boundary(self):
        selection = {'url': 'https://cdn.modrinth.com/pack.zip', 'algorithm': 'sha256', 'hash': hashlib.sha256(b'good').hexdigest()}
        for payload, length, maximum in [(b'bad', None, 100), (b'good', '200', 100), (b'x' * 101, None, 100), (b'good', '5', 100)]:
            with self.subTest(length=length, maximum=maximum), tempfile.TemporaryDirectory() as directory:
                response = io.BytesIO(payload)
                response.headers = {} if length is None else {'Content-Length': length}
                path = Path(directory) / 'download.zip'
                with mock.patch.object(installer.OPENER, 'open', return_value=response), self.assertRaises(ValueError):
                    installer.verified_archive(selection, path, maximum=maximum)
                self.assertFalse(path.exists())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'existing.zip'
            path.write_bytes(b'keep')
            with mock.patch.object(installer.OPENER, 'open', return_value=io.BytesIO(b'good')), self.assertRaises(FileExistsError):
                installer.verified_archive(selection, path)
            self.assertEqual(path.read_bytes(), b'keep')

    def test_explicit_disk_scratch_and_cleanup_after_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/"root";scratch=Path(directory)/"scratch";scratch.mkdir()
            def verified(file):
                temporary=list(scratch.iterdir())
                self.assertEqual(len(temporary),1)
                self.assertTrue((temporary[0]/"server").is_dir())
                raise ValueError("fixture download failed after scratch allocation")
            with mock.patch.object(installer,"verified",side_effect=verified),self.assertRaises(ValueError):
                installer.install({"files":[{"path":"server.jar"}]},root,work_directory=scratch)
            self.assertEqual(list(scratch.iterdir()),[])

    def test_quilt_installs_into_explicit_staging_directory(self):
        plan = {"version": "26.3", "loader": "quilt", "loader_version": "0.30.1",
                "java": 25, "files": [], "installer": {"url": "fixture"},
                "launch": "-jar quilt-server-launch.jar"}
        def run(command, cwd, **kwargs):
            self.assertEqual(command[-1], '--install-dir="' + str(cwd) + '"')
            self.assertEqual(command[3:7], ["install", "server", "26.3", "0.30.1"])
            (cwd / "quilt-server-launch.jar").write_bytes(b"generated launcher")
        with tempfile.TemporaryDirectory() as root, mock.patch.object(installer, "verified", return_value=b"installer"), mock.patch.object(installer, "bootstrap_java", return_value="/java"), mock.patch.object(installer.subprocess, "run", side_effect=run), mock.patch.dict(os.environ, MAX_PLAYERS="20", GAME_MODE="survival", DIFFICULTY="normal"):
            installer.install(plan, root)
            self.assertEqual((Path(root) / "quilt-server-launch.jar").read_bytes(), b"generated launcher")

    def test_overrides_and_server_filter(self):
        data = archive({"overrides/config/shared.cfg": "common",
                        "server-overrides/config/shared.cfg": "server",
                        "client-overrides/config/client.cfg": "client",
                        "overrides/run.sh": "exit 99",
                        "overrides/world/level.dat": "never replace worlds",
                        "overrides/server.properties": "new properties"})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "server.properties").write_text("existing properties")
            installer.unpack(data, root, ["overrides/", "server-overrides/"])
            self.assertEqual((root / "config/shared.cfg").read_text(), "server")
            self.assertEqual((root / "server.properties").read_text(), "existing properties")
            self.assertFalse((root / "config/client.cfg").exists())
            self.assertFalse((root / "run.sh").exists())
            self.assertFalse((root / "world").exists())

    def test_zip_slip_and_special_files(self):
        for name in ["../escape", "/absolute", "C:/drive", "a\\b", "overrides/../../escape",
                     "overrides/.voltra-start.sh", "overrides/config//bad"]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(ValueError):
                    installer.unpack(archive({name: "bad"}), directory, ["overrides/"])
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as zipped:
            header = zipfile.ZipInfo("overrides/config/link")
            header.create_system = 3
            header.external_attr = (stat.S_IFLNK | 0o777) << 16
            zipped.writestr(header, "../../outside")
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            installer.unpack(output.getvalue(), directory, ["overrides/"])

    def test_existing_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "server"
            root.mkdir()
            (root / "config").symlink_to(Path(directory), target_is_directory=True)
            with self.assertRaises(ValueError):
                installer.unpack(archive({"overrides/config/escaped": "bad"}), root, ["overrides/"])
            self.assertFalse((Path(directory) / "escaped").exists())

    def test_checksum_and_download_boundary(self):
        file = {"url": "https://cdn.modrinth.com/a.jar", "hash": hashlib.sha512(b"good").hexdigest(), "algorithm": "sha512"}
        with mock.patch.object(installer, "fetch", return_value=b"corrupt"), self.assertRaises(ValueError):
            installer.verified(file)
        for address in ["https://cdn.modrinth.com.evil/a", "http://cdn.modrinth.com/a", "https://user@cdn.modrinth.com/a", "https://cdn.modrinth.com:8443/a"]:
            self.assertFalse(installer.allowed_url(address))

    def test_vanilla_keeps_worlds_and_properties(self):
        file = {"path": "server.jar", "url": "https://piston-data.mojang.com/server.jar", "algorithm": "sha1", "hash": hashlib.sha1(b"jar").hexdigest()}
        plan = {"version": "1.12.2", "loader": "vanilla", "java": 8, "files": [file], "launch": "-jar server.jar"}
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(installer, "fetch", return_value=b"jar"):
            root = Path(directory)
            (root / "world").mkdir()
            (root / "world/level.dat").write_bytes(b"world")
            (root / "server.properties").write_text("keep settings")
            installer.install(plan, root)
            installer.install(plan, root)
            self.assertEqual((root / "server.jar").read_bytes(), b"jar")
            self.assertEqual((root / "world/level.dat").read_bytes(), b"world")
            self.assertEqual((root / "server.properties").read_text(), "keep settings")
            self.assertEqual((root / "eula.txt").read_text(), "eula=true\n")

    def test_loader_installer_contracts(self):
        for loader, java, launch in [
            ("fabric", 21, "-jar fabric-server-launch.jar"),
            ("quilt", 21, "-jar quilt-server-launch.jar"),
            ("forge", 8, "-jar .voltra-forge-server.jar"),
            ("forge", 16, "@libraries/net/minecraftforge/forge/1.17.1-37.1.1/unix_args.txt"),
            ("neoforge", 25, "@libraries/net/neoforged/neoforge/26.1.0.10/unix_args.txt"),
        ]:
            with self.subTest(loader=loader, java=java), tempfile.TemporaryDirectory() as directory:
                plan = {"loader": loader, "version": "1.17.1", "loader_version": "37.1.1", "java": java,
                        "files": [], "installer": {"url": "fixture"}, "launch": launch}
                calls = []

                def run(command, cwd, check, timeout):
                    calls.append(command)
                    if loader == "forge" and java == 8:
                        (cwd / "forge-1.12.2-14.23.5.2860-universal.jar").write_bytes(b"legacy")
                    else:
                        target = cwd / (launch[1:] if launch.startswith("@") else launch[5:])
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(b"generated")
                    (cwd / "user_jvm_args.txt").write_text("# installer flags\n-Dfixture=true\n")

                with mock.patch.object(installer, "verified", return_value=b"installer"), \
                        mock.patch.object(installer, "bootstrap_java", return_value="/verified/jdk/bin/java"), \
                        mock.patch.object(installer.subprocess, "run", side_effect=run), \
                        mock.patch.dict(os.environ, {"MAX_PLAYERS": "20", "GAME_MODE": "survival", "DIFFICULTY": "normal"}):
                    installer.install(plan, directory)
                command = calls[0]
                self.assertEqual(command[0], "/verified/jdk/bin/java")
                if loader in {"forge", "neoforge"}:
                    self.assertEqual(command[-1], "--installServer")
                elif loader == "quilt":
                        self.assertEqual(command[3:7], ["install", "server", "1.17.1", "37.1.1"])
                        self.assertTrue(command[7].startswith('--install-dir="'))
                else:
                    self.assertEqual(command[3:], ["server", "-mcversion", "1.17.1", "-loader", "37.1.1"])
                self.assertTrue((Path(directory) / (launch[1:] if launch.startswith("@") else launch[5:])).is_file())


if __name__ == "__main__":
    unittest.main()
