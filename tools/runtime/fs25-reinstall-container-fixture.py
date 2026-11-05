"""Run as root on Linux with a source tar and a prepared root-default installer image.

Only disposable fixture directories are mounted. Wine downloads are stubbed and
networking is disabled. This proves installer identity, ordering and failure gates,
not a native GIANTS update. Usage: python3 this.py source.tar image
"""
import os
import pathlib
import shutil
import subprocess
import sys
import tarfile
import tempfile

root = pathlib.Path(tempfile.mkdtemp(prefix="voltra-fs25-reinstall-fixture-"))
os.chmod(root, 0o755)
try:
    for result in [0, 1, 2]:
        volume = root / str(result)
        volume.mkdir()
        os.chown(volume, 996, 988)
        with tarfile.open(sys.argv[1]) as archive:
            archive.extractall(volume, filter="data")
        (volume / ".voltra/scripts").mkdir(parents=True)
        game = volume / ".fs25prefix/drive_c/Program Files (x86)/Farming Simulator 2025"
        game.mkdir(parents=True)
        (game / "dedicatedServer.exe").write_text("fixture")
        (game / "VERSION").write_text("1.25.0.0")
        (volume / ".fs25prefix/system.reg").write_text("fixture")
        docs = volume / "data"
        docs.mkdir()
        (docs / "pdlc").mkdir()
        (docs / "fixture.dat").write_text("FAKE")
        (docs / "savegame1").mkdir()
        (docs / "savegame1/world.xml").write_text("preserve me")
        profile = volume / ".fs25prefix/drive_c/users/container/Documents/My Games"
        profile.mkdir(parents=True)
        (profile / "FarmingSimulator2025").symlink_to("/home/container/data")
        bins = root / ("bin" + str(result))
        bins.mkdir()
        (bins / "node").write_text(
            '#!/bin/bash\necho "${1##*/} ${2:-}" >> /home/container/trace\n'
            'case "${1##*/}:${2:-}" in game-update.mjs:prepare) exit '
            + str(result) + ';; esac\nexit 0\n'
        )
        os.chmod(bins / "node", 0o755)
        subprocess.run(["chown", "-R", "996:988", str(volume)], check=True)
        driver = root / ('driver' + str(result))
        driver.write_text('#!/bin/bash\nexec bash /mnt/server/.voltra/fs25/reinstall.sh\n')
        os.chmod(driver, 0o700)
        command = [
            "docker", "run", "--rm", "--network", "none",
            "--mount", "type=bind,src=" + str(volume) + ",dst=/mnt/server",
            "--mount", "type=bind,src=" + str(driver) + ",dst=/mnt/install/install.sh,readonly",
            "--mount", "type=bind,src=" + str(bins) + ",dst=/testbin,readonly",
            "-e", "PATH=/testbin:/opt/wine-stable/bin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "-e", "WEB_PASSWORD=fixture-only-password", "--entrypoint", "bash",
            sys.argv[2], "/mnt/install/install.sh",
        ]
        process = subprocess.run(command, capture_output=True, text=True, timeout=30)
        assert (volume / "trace").exists(), (process.returncode, process.stdout, process.stderr)
        trace = (volume / "trace").read_text()
        assert (process.returncode == 0) == (result == 0), (process.stdout, process.stderr)
        assert ("download-game.mjs --dlc-only" in trace) == (result == 0), trace
        assert ("configure.mjs" in trace) == (result == 0), trace
        assert (docs / "savegame1/world.xml").read_text() == "preserve me"
        print("Pinned installer fixture passed: base result", result,
              "exit", process.returncode, "saved data preserved.")
finally:
    shutil.rmtree(root)
