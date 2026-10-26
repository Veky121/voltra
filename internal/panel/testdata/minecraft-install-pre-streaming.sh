#!/bin/bash
set -euo pipefail
if [[ "${EULA_ACCEPTED:-false}" != "true" ]]; then
    echo "Accept the Minecraft EULA before installing."
    exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends python3 ca-certificates
mkdir -p /mnt/server
cd /mnt/server
python3 - <<'VOLTRA_MINECRAFT_PY'
"""Execute a panel-validated, non-secret Minecraft installation plan."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import stat
import subprocess
import tarfile
import tempfile
import urllib.parse
import urllib.request
import zipfile
import zlib

AGENT = "Voltra-GameLibrary/1.0 (https://github.com/voltra-panel/voltra)"
HOSTS = {
    "piston-data.mojang.com", "launcher.mojang.com", "maven.fabricmc.net",
    "maven.quiltmc.org", "maven.minecraftforge.net", "maven.neoforged.net",
    "fill-data.papermc.io", "cdn.modrinth.com", "edge.forgecdn.net",
    "mediafilez.forgecdn.net", "media.forgecdn.net", "github.com",
    "raw.githubusercontent.com", "objects.githubusercontent.com",
    "release-assets.githubusercontent.com", "gitlab.com", "api.adoptium.net",
}
CONTENT = {"mods", "config", "defaultconfigs", "kubejs", "scripts",
           "datapacks", "resources", "global_packs", "resourcepacks"}


def allowed_url(address):
    u = urllib.parse.urlsplit(address)
    return (u.scheme == "https" and u.hostname in HOSTS and not u.username
            and not u.password and not u.port and not u.fragment)


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_url(newurl):
            raise ValueError("The download redirected to an unsupported host")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(SafeRedirect())


def fetch(address, maximum):
    if not allowed_url(address):
        raise ValueError("The plan contains an unsupported download host")
    req = urllib.request.Request(address, headers={"User-Agent": AGENT})
    with OPENER.open(req, timeout=120) as response:
        data = response.read(maximum + 1)
    if len(data) > maximum:
        raise ValueError("The download exceeds the supported size")
    return data


def verified(file, maximum=512 * 1024 * 1024):
    data = fetch(file["url"], maximum)
    algorithm = file["algorithm"]
    if algorithm not in {"sha1", "sha256", "sha512"}:
        raise ValueError("The download has no supported checksum")
    if hashlib.new(algorithm, data).hexdigest().lower() != file["hash"].lower():
        raise ValueError("A download did not match its checksum")
    return data


def safe_name(name):
    if (not name or len(name) > 512 or any(c in name for c in "\\\0\r\n:")
            or name.startswith("/")):
        raise ValueError("Unsafe archive path")
    parts = name.rstrip("/").split("/")
    if any(p in {"", ".", ".."} or p.lower().startswith(".voltra") for p in parts):
        raise ValueError("Unsafe archive path")
    return PurePosixPath(*parts)


def safe_target(root, name):
    relative = safe_name(name)
    root = Path(root).resolve()
    target = root.joinpath(*relative.parts)
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Refusing to write through a symlink")
    if not target.resolve().is_relative_to(root):
        raise ValueError("Archive path escaped the server directory")
    return target


def unpack(data, root, prefixes):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > 30000 or sum(f.file_size for f in entries) > 2 * 1024**3:
            raise ValueError("The pack exceeds the supported archive size")
        for entry in entries:
            safe_name(entry.filename)
            kind = stat.S_IFMT(entry.external_attr >> 16)
            if kind not in {0, stat.S_IFREG, stat.S_IFDIR}:
                raise ValueError("The pack contains a symlink or special file")
            if entry.file_size > 512 * 1024**2:
                raise ValueError("The pack contains an oversized file")
        for prefix in prefixes:
            for entry in entries:
                if entry.is_dir() or not entry.filename.startswith(prefix):
                    continue
                name = entry.filename[len(prefix):]
                relative = safe_name(name)
                if relative.parts[0] not in CONTENT and name != "server.properties":
                    continue
                target = safe_target(root, name)
                if name == "server.properties" and target.exists():
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(entry) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)


def bootstrap_java(major, directory):
    architecture = {"x86_64": "x64", "aarch64": "aarch64"}.get(platform.machine())
    if not architecture:
        raise ValueError("This node architecture has no supported Java installer")
    address = ("https://api.adoptium.net/v3/assets/latest/" + str(major)
               + "/hotspot?architecture=" + architecture
               + "&image_type=jdk&os=linux&vendor=eclipse")
    assets = json.loads(fetch(address, 4 * 1024**2))
    if not assets:
        raise ValueError("No Java installer is available for this node")
    package = assets[0]["binary"]["package"]
    raw = verified({"url": package["link"], "hash": package["checksum"],
                    "algorithm": "sha256"})
    root = Path(directory).resolve()
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
        members = archive.getmembers()
        if sum(m.size for m in members) > 1024**3:
            raise ValueError("The Java archive exceeds the supported size")
        link_paths = set()
        for member in members:
            relative = safe_name(member.name)
            destination = root.joinpath(*relative.parts)
            if not destination.resolve().is_relative_to(root):
                raise ValueError("Unsafe Java archive path")
            if member.issym() or member.islnk():
                link_paths.add(destination)
                link = (destination.parent / member.linkname if member.issym()
                        else root / member.linkname)
                if not link.resolve().is_relative_to(root):
                    raise ValueError("Unsafe Java archive link")
            elif not member.isfile() and not member.isdir():
                raise ValueError("Unsupported Java archive entry")
        for member in members:
            destination = root.joinpath(*safe_name(member.name).parts)
            if any(parent in link_paths for parent in destination.parents):
                raise ValueError("Java archive writes through a link")
            if not member.issym() and not member.islnk():
                archive.extract(member, root)
        for member in members:
            if member.issym() or member.islnk():
                archive.extract(member, root)
    candidates = list(root.glob("*/bin/java"))
    if len(candidates) != 1:
        raise ValueError("The Java installer has no usable executable")
    return str(candidates[0])


def install(plan, root, work_directory=None):
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    # Wings mounts /tmp as a small tmpfs. Pack archives plus the Java bootstrap
    # must use the server disk budget, not exhaust that tmpfs during extraction.
    with tempfile.TemporaryDirectory(prefix="voltra-minecraft-", dir=work_directory or root) as temporary:
        staging = Path(temporary) / "server"
        staging.mkdir()
        for file in plan["files"]:
            target = safe_target(staging, file["path"])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(verified(file))
        for archive in plan.get("archives", []):
            unpack(verified(archive["file"], 512 * 1024**2), staging, archive["prefixes"])
        installer = plan.get("installer")
        if installer:
            java_root = Path(temporary) / "java"
            java_root.mkdir()
            java = bootstrap_java(plan["java"], java_root)
            installer_path = Path(temporary) / "installer.jar"
            installer_path.write_bytes(verified(installer))
            command = [java, "-jar", str(installer_path)]
            if plan["loader"] == "fabric":
                command += ["server", "-mcversion", plan["version"], "-loader", plan["loader_version"]]
            elif plan["loader"] == "quilt":
                # Quilt otherwise defaults to a nested server/ directory.
                # Quotes are part of its CLI value parser, not shell syntax.
                command += ["install", "server", plan["version"], plan["loader_version"],
                            '--install-dir="' + str(staging) + '"']
            elif plan["loader"] in {"forge", "neoforge"}:
                command += ["--installServer"]
            else:
                raise ValueError("Unsupported installer")
            subprocess.run(command, cwd=staging, check=True, timeout=1800)
            if plan["loader"] == "forge" and plan["java"] <= 8:
                jars = [p for p in staging.glob("forge-*.jar") if "installer" not in p.name]
                if len(jars) != 1:
                    raise ValueError("Forge did not generate one server JAR")
                shutil.copyfile(jars[0], staging / ".voltra-forge-server.jar")
        launch = plan["launch"]
        launch_file = launch[1:] if launch.startswith("@") else launch.removeprefix("-jar ")
        if not (staging / launch_file).is_file():
            raise ValueError("The loader installer did not generate its launch target")
        for source in staging.rglob("*"):
            if source.is_symlink():
                raise ValueError("The installer generated an unsupported symlink")
            if not source.is_file():
                continue
            relative = source.relative_to(staging).as_posix()
            if relative == ".voltra-forge-server.jar":
                target = root / relative
                if target.is_symlink():
                    raise ValueError("Refusing to replace a symlink")
            else:
                target = safe_target(root, relative)
            if relative in {"server.properties", "user_jvm_args.txt"} and target.exists():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        properties = safe_target(root, "server.properties")
        if not properties.exists():
            properties.write_text(
                "server-ip=0.0.0.0\nserver-port=25565\nonline-mode=true\nenable-query=false\n"
                + "max-players=" + os.environ["MAX_PLAYERS"] + "\n"
                + "gamemode=" + os.environ["GAME_MODE"] + "\n"
                + "difficulty=" + os.environ["DIFFICULTY"] + "\n"
                + "motd=A Minecraft server\n", encoding="utf-8")
        safe_target(root, "eula.txt").write_text("eula=true\n", encoding="utf-8")


def main():
    if os.environ.get("EULA_ACCEPTED") != "true":
        raise ValueError("Accept the Minecraft EULA before installing")
    plan = json.loads(zlib.decompress(base64.b64decode(os.environ["MINECRAFT_INSTALL_PLAN"])))
    install(plan, "/mnt/server")
    print("Minecraft " + plan["version"] + " " + plan["loader"] + " installed.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit("Minecraft installation failed: " + str(error))

VOLTRA_MINECRAFT_PY
