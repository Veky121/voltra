"""Run only in the write-enabled release job. Never overwrite version assets."""
import json
import hashlib
import os
from pathlib import Path
import re
import subprocess
import tempfile


def gh(*args, check=True):
    return subprocess.run(["gh", *args], check=check, text=True, capture_output=True)


def precedence(version):
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(?:-(beta|nightly)\.([\d.]+))?", version.lstrip("v"))
    if not match:
        raise ValueError("Invalid channel manifest version")
    major, minor, patch, kind, seq = match.groups()
    return (int(major), int(minor), int(patch), kind is None, tuple(map(int, (seq or "0").split("."))))


def main():
    tag, channel, sha = (os.environ[name] for name in ("RELEASE_TAG", "RELEASE_CHANNEL", "RELEASE_SHA"))
    # Go validates the exact accepted tag syntax before this script is reached.
    if channel not in ("stable", "beta", "nightly") or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Invalid release plan")
    if os.environ.get("CREATE_NIGHTLY_TAG") == "true":
        if channel != "nightly" or not re.fullmatch(r"v\d+\.\d+\.\d+-nightly\.\d{8}\.[1-9]\d*", tag):
            raise ValueError("Only scheduled nightlies can create a version tag")
        ref = gh("api", f"repos/Veky121/voltra/git/ref/tags/{tag}", check=False)
        if ref.returncode:
            gh("api", "repos/Veky121/voltra/git/refs", "--method", "POST", "-f", f"ref=refs/tags/{tag}", "-f", f"sha={sha}")
        elif json.loads(ref.stdout)["object"]["sha"] != sha:
            raise ValueError("Existing nightly tag points to another commit")
    opts = ["--latest=false"] if channel == "stable" else ["--prerelease", "--latest=false"]
    if gh("release", "view", tag, check=False).returncode:
        # Wings may create this same release concurrently. Re-read after a race.
        result = gh("release", "create", tag, "--verify-tag", "--title", f"Voltra {tag}", "--generate-notes", *opts, check=False)
        if result.returncode:
            gh("release", "view", tag)
    release = json.loads(gh("release", "view", tag, "--json", "assets").stdout)
    names = {asset["name"] for asset in release["assets"]}
    for path in sorted(Path("out").iterdir()):
        if path.name in names:
            with tempfile.TemporaryDirectory() as folder:
                gh("release", "download", tag, "--pattern", path.name, "--dir", folder)
                previous_bytes = Path(folder, path.name).read_bytes()
                if path.name == "manifest.json":
                    previous, current = json.loads(previous_bytes), json.loads(path.read_bytes())
                    previous.pop("publishedAt", None)
                    current.pop("publishedAt", None)
                    if previous != current:
                        raise ValueError("Existing immutable manifest differs")
                    path.write_bytes(previous_bytes)
                elif hashlib.sha256(previous_bytes).digest() != hashlib.sha256(path.read_bytes()).digest():
                    raise ValueError(f"Existing immutable asset differs: {path.name}")
            continue
        gh("release", "upload", tag, str(path))  # deliberately no --clobber
    if channel == "stable":
        latest = gh("api", "repos/Veky121/voltra/releases/latest", check=False)
        if latest.returncode or precedence(json.loads(latest.stdout)["tag_name"]) < precedence(tag):
            gh("release", "edit", tag, "--latest")
    # Only completed version assets can be offered by the mutable channel feed.
    carrier = f"update-{channel}"
    existing = gh("release", "view", carrier, "--json", "assets", check=False)
    if existing.returncode == 0:
        with tempfile.TemporaryDirectory() as folder:
            if any(a["name"] == "manifest.json" for a in json.loads(existing.stdout)["assets"]):
                gh("release", "download", carrier, "--pattern", "manifest.json", "--dir", folder)
                previous = json.loads(Path(folder, "manifest.json").read_text())
                current = json.loads(Path("out/manifest.json").read_text())
                if previous["channel"] != channel:
                    raise ValueError("Carrier channel mismatch")
                if precedence(previous["version"]) >= precedence(current["version"]):
                    print("Version assets published; channel already offers this or a newer version.")
                    return
    else:
        gh("release", "create", carrier, "--target", sha, "--prerelease", "--latest=false", "--title", f"Voltra {channel} update feed", "--notes", "Mutable updater manifest only. Download binaries from versioned releases.")
    gh("release", "upload", carrier, "out/manifest.json", "--clobber")
    gh("release", "edit", carrier, "--prerelease", "--latest=false")
    print(f"Published {tag} to {channel}.")


if __name__ == "__main__":
    main()
