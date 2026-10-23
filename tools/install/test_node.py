"""Linux-only installer tests with temporary install paths and fake host commands.

Real Bash, PTY, SHA256 validation and file writes. No network or host services.
Run in a disposable container: python3 tools/install/test_node.py.
"""
import fcntl
import hashlib
import os
from pathlib import Path
import pty
import select
import subprocess
import tempfile
import termios
import time
import unittest


class InstallerTests(unittest.TestCase):
    def run_install(self, mode="", arch="x86_64", version="v1.2.3", replace=False, answer="", terminal=True):
        with tempfile.TemporaryDirectory(prefix="voltra-release-installer-") as temporary:
            root = Path(temporary)
            fake = root / "fakebin"
            fake.mkdir()
            fixtures = root / "fixtures"
            fixtures.mkdir()
            log = root / "commands"
            for target in ("amd64", "arm64"):
                for name in (f"voltra-wings-linux-{target}", f"voltra-node-linux-{target}"):
                    (fixtures / name).write_text('#!/bin/bash\nprintf "node %s\\n" "$*" >> "$LOG"\n')
            (fixtures / "WINGS-LICENSE").write_text("MIT fixture notice\n")
            (fixtures / "wings-provenance.json").write_text('{}\n')
            for manifest, names in (
                ("WINGS-SHA256SUMS", ["voltra-wings-linux-amd64", "voltra-wings-linux-arm64", "WINGS-LICENSE", "wings-provenance.json"]),
                ("NODE-SHA256SUMS", ["voltra-node-linux-amd64", "voltra-node-linux-arm64"]),
            ):
                content = "".join(f"{hashlib.sha256((fixtures / name).read_bytes()).hexdigest()}  {name}\n" for name in names)
                if mode == "duplicate" and manifest == "WINGS-SHA256SUMS":
                    content += content.splitlines()[0] + "\n"
                if mode == "missing-checksum" and manifest == "NODE-SHA256SUMS":
                    content = ""
                (fixtures / manifest).write_text(content)
            scripts = {
                "uname": 'if [[ $1 == -s ]]; then echo Linux; else echo "$ARCH"; fi',
                "systemctl": 'echo "systemctl $*" >> "$LOG"; if [[ $MODE == active && $* == *is-active* && $* == *wings.service* ]]; then exit 0; fi; if [[ $MODE == activating && $* == show* && $* == *wings.service* ]]; then echo activating; exit 0; fi; exit 1',
                "docker": 'echo "docker $*" >> "$LOG"; [[ $MODE != docker-down ]]',
                "od": 'if [[ $MODE == bad-elf ]]; then echo 00000000; else echo 7f454c46; fi',
                "curl": '''echo "curl $*" >> "$LOG"
while (( $# )); do
  case $1 in -o) destination=$2; shift 2 ;; https://*) url=$1; shift ;; *) shift ;; esac
done
asset=${url##*/}
[[ $MODE != missing-release ]] || exit 22
cp "$FIXTURES/$asset" "$destination"
if [[ $MODE == corrupt && $asset == voltra-node-* ]]; then echo CORRUPT >> "$destination"; fi
''',
            }
            for name, body in scripts.items():
                path = fake / name
                path.write_text("#!/bin/bash\nset -eu\n" + body + "\n")
                path.chmod(0o755)
            script = Path(__file__).with_name("node.sh").read_text()
            # Change only absolute filesystem destinations. /dev/tty stays real.
            for directory in ("/usr/local", "/usr/bin/wings", "/etc/pterodactyl", "/etc/voltra", "/run/systemd/system"):
                script = script.replace(directory, str(root) + directory)
            (root / "run/systemd/system").mkdir(parents=True)
            installed = root / "usr/local/bin"
            installed.mkdir(parents=True)
            if mode in ("existing", "active", "activating"):
                (installed / "wings").write_text("original binary")
            if mode == "config":
                config = root / "etc/pterodactyl/config.yml"
                config.parent.mkdir(parents=True)
                config.write_text("preserve private configuration")
            source = root / "installer.sh"
            source.write_text(script)
            env = dict(os.environ, PATH=str(fake) + ":/usr/bin:/bin", LOG=str(log), FIXTURES=str(fixtures), MODE=mode, ARCH=arch)
            args = ["bash", str(source), version, "https://panel.example.com"] + (["--replace-existing"] if replace else [])
            master, slave = pty.openpty()

            def session():
                os.setsid()
                if terminal:
                    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

            process = subprocess.Popen(args, env=env, stdin=slave if terminal else subprocess.DEVNULL, stdout=slave, stderr=slave, preexec_fn=session)
            os.close(slave)
            if answer:
                os.write(master, (answer + "\n").encode())
            output = bytearray()
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                if select.select([master], [], [], 0.1)[0]:
                    try:
                        data = os.read(master, 65536)
                        if not data:
                            break
                        output.extend(data)
                    except OSError:
                        break
                if process.poll() is not None:
                    # Continue draining the PTY until EOF.
                    continue
            if process.poll() is None:
                process.kill()
            code = process.wait()
            os.close(master)
            files = {p.name: p.read_bytes() for p in installed.iterdir() if p.is_file()}
            return code, output.decode(errors="replace"), log.read_text() if log.exists() else "", files

    def test_fresh_both_architectures(self):
        for arch, target in (("x86_64", "amd64"), ("aarch64", "arm64")):
            with self.subTest(arch=arch):
                code, output, commands, files = self.run_install(arch=arch)
                self.assertEqual(code, 0, output)
                self.assertIn(f"voltra-wings-linux-{target}", commands)
                self.assertIn("node setup", commands)
                self.assertEqual(set(files), {"wings", "voltra-node"})
                self.assertNotIn("systemctl enable", commands)
                self.assertNotIn("systemctl restart", commands)

    def test_verification_failures_install_nothing(self):
        for mode in ("corrupt", "duplicate", "missing-checksum", "missing-release", "bad-elf", "docker-down"):
            with self.subTest(mode=mode):
                code, output, commands, files = self.run_install(mode=mode)
                self.assertNotEqual(code, 0, output)
                self.assertEqual(files, {})
                self.assertNotIn("node setup", commands)

    def test_existing_requires_opt_in_and_stopped_services(self):
        for mode, replace, answer in (("existing", False, ""), ("config", False, ""), ("active", True, ""), ("activating", True, ""), ("existing", True, "no")):
            with self.subTest(mode=mode, replace=replace):
                code, output, commands, files = self.run_install(mode=mode, replace=replace, answer=answer)
                self.assertNotEqual(code, 0, output)
                self.assertNotIn("curl ", commands)
                self.assertNotIn("restart", commands)
                if "wings" in files:
                    self.assertEqual(files["wings"], b"original binary")

    def test_explicit_replacement_never_starts_setup_or_services(self):
        code, output, commands, files = self.run_install(mode="existing", replace=True, answer="REPLACE STOPPED NODE BINARIES")
        self.assertEqual(code, 0, output)
        self.assertIn("binary-backup.", output)
        self.assertNotIn("node setup", commands)
        self.assertNotIn("restart", commands)
        self.assertEqual(set(files), {"wings", "voltra-node"})

    def test_invalid_version_arch_and_no_terminal_fail_closed(self):
        for kwargs in ({"version": "latest"}, {"version": "v1.2.3/evil"}, {"arch": "riscv64"}, {"terminal": False}):
            with self.subTest(kwargs=kwargs):
                code, output, commands, files = self.run_install(**kwargs)
                self.assertNotEqual(code, 0, output)
                self.assertEqual(files, {})
                self.assertNotIn("curl ", commands)


if __name__ == "__main__":
    unittest.main()
