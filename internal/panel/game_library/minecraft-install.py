"""Execute a panel-validated, non-secret Minecraft installation plan."""
from contextlib import contextmanager
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
MAX_PACK_ARCHIVE = 2 * 1024**3
MAX_PACK_EXPANDED = 4 * 1024**3
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


def verified_archive(file, destination, maximum=MAX_PACK_ARCHIVE):
    """Stream large server packs into installer scratch, never into RAM/tmpfs."""
    if not allowed_url(file['url']):
        raise ValueError('The plan contains an unsupported download host')
    algorithm = file['algorithm']
    expected = file['hash']
    if algorithm not in {'sha1', 'sha256', 'sha512'}:
        raise ValueError('The download has no supported checksum')
    checksum = hashlib.new(algorithm)
    if not isinstance(expected, str) or len(expected) != checksum.digest_size * 2 or any(c not in '0123456789abcdefABCDEF' for c in expected):
        raise ValueError('The download has no supported checksum')
    destination = Path(destination)
    request = urllib.request.Request(file['url'], headers={'User-Agent': AGENT})
    output = None
    try:
        with OPENER.open(request, timeout=120) as response, destination.open('xb') as output:
            length = response.headers.get('Content-Length')
            if length and int(length) > maximum:
                raise ValueError('The pack download exceeds the supported 2 GiB archive size')
            size = 0
            while True:
                block = response.read(min(1024**2, maximum - size + 1))
                if not block:
                    break
                size += len(block)
                if size > maximum:
                    raise ValueError('The pack download exceeds the supported 2 GiB archive size')
                checksum.update(block)
                output.write(block)
            if length and size != int(length):
                raise ValueError('The pack download was interrupted')
            if checksum.hexdigest().lower() != expected.lower():
                raise ValueError('A download did not match its checksum')
    except BaseException:
        if output is not None:
            destination.unlink(missing_ok=True)
        raise
    return destination


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
    with zipfile.ZipFile(io.BytesIO(data) if isinstance(data, bytes) else data) as archive:
        entries = archive.infolist()
        if len(entries) > 30000 or sum(f.file_size for f in entries) > MAX_PACK_EXPANDED:
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



PACK_REPLACE = {"mods", "config", "defaultconfigs", "kubejs", "scripts"}
PACK_PRESERVE = {"server.properties", "eula.txt", "ops.json", "whitelist.json",
                 "banned-players.json", "banned-ips.json", "usercache.json",
                 "user_jvm_args.txt", "local", "VOLTRA_OVERRIDE"}


@contextmanager
def pack_content_transaction(staging, root):
    """Replace pack-owned directories, including ones absent from the new pack.

    Keep rollback copies until the caller finishes publishing its launch/receipt.
    Never follow existing links or replace a configured world directory.
    """
    staging, root = Path(staging), Path(root)
    properties = root / "server.properties"
    if properties.is_symlink():
        raise ValueError("Server properties is a symlink")
    worlds = {"world", "world_nether", "world_the_end"}
    if properties.is_file():
        for line in properties.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("level-name="):
                name = line.strip().split("=", 1)[1]
                safe_target(root, name)
                worlds.add(name.split("/")[0])
    if worlds & PACK_REPLACE:
        raise ValueError("Configured world conflicts with a pack-owned directory")
    state = root / '.voltra/minecraft-pack-content.json'
    if (root / '.voltra').is_symlink() or state.is_symlink():
        raise ValueError('Pack state contains a symlink')
    previous = json.loads(state.read_text()) if state.is_file() else {}
    baseline = previous.get('config_files', {})
    if not isinstance(baseline, dict):
        raise ValueError('Invalid pack config baseline')
    config_files, retained = {}, []
    def checksum(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()
    for name in ('config', 'defaultconfigs'):
        for source in (staging / name).rglob('*'):
            if source.is_file() and not source.is_symlink():
                config_files[source.relative_to(staging).as_posix()] = checksum(source)
    for name in sorted(PACK_REPLACE):
        for base in (staging, root):
            path = safe_target(base, name)
            if path.exists() and not path.is_dir():
                raise ValueError("Pack-owned path is not a directory: " + name)
            if path.exists():
                for child in path.rglob("*"):
                    if child.is_symlink() or not (child.is_file() or child.is_dir()):
                        raise ValueError("Pack-owned directory contains links or special files")
    # .voltra was validated above; archive paths must still reject this namespace.
    overrides = safe_target(state.parent, 'overrides')
    legacy_overrides = safe_target(root, 'VOLTRA_OVERRIDE')
    for folder in (legacy_overrides, overrides):
        if folder.exists() and not folder.is_dir():
            raise ValueError(str(folder.relative_to(root)) + ' must be a directory')
        for source in folder.rglob('*'):
            relative = source.relative_to(folder).as_posix()
            safe_target(folder, relative)
            if source.is_symlink() or not (source.is_file() or source.is_dir()):
                raise ValueError('Config overrides contain links or special files')
            if relative.split('/')[0] not in {'config', 'defaultconfigs'}:
                raise ValueError('Config overrides support only config/ and defaultconfigs/')
    with tempfile.TemporaryDirectory(prefix=".voltra-pack-rollback-", dir=root) as temporary:
        rollback = Path(temporary)
        changed = []
        prepared_overrides = rollback / 'prepared-overrides'
        prepared_overrides.mkdir()
        for folder in (legacy_overrides, overrides):
            for source in sorted(folder.rglob('*')):
                relative = source.relative_to(folder).as_posix()
                destination = safe_target(prepared_overrides, relative)
                if source.is_dir():
                    if destination.exists() and not destination.is_dir():
                        raise ValueError('Conflicting override paths: ' + relative)
                    destination.mkdir(parents=True, exist_ok=True)
                elif destination.exists():
                    if not destination.is_file() or checksum(source) != checksum(destination):
                        raise ValueError('Conflicting overrides in VOLTRA_OVERRIDE and .voltra/overrides: ' + relative)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, destination)
        try:
            for name in sorted(PACK_REPLACE):
                destination = root / name
                backup = rollback / name
                existed = destination.exists()
                if existed:
                    os.replace(destination, backup)
                changed.append((destination, backup if existed else None))
                source = staging / name
                if source.exists():
                    shutil.copytree(source, destination)
                if name in {'config', 'defaultconfigs'} and existed:
                    for old in backup.rglob('*'):
                        if not old.is_file():
                            continue
                        relative = name + '/' + old.relative_to(backup).as_posix()
                        # Unknown legacy files and edits belong to the user.
                        if relative not in baseline or checksum(old) != baseline[relative]:
                            target = safe_target(root, relative)
                            target.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copy2(old, target)
                            override = safe_target(prepared_overrides, relative)
                            if not override.exists():
                                override.parent.mkdir(parents=True, exist_ok=True)
                                shutil.copy2(old, override)
                            retained.append(relative)
                    # Preserve a user's deletion of a previously supplied config.
                    for relative in baseline:
                        if relative.split('/')[0] == name and not safe_target(backup, relative[len(name)+1:]).exists():
                            target = safe_target(root, relative)
                            if target.is_file():
                                target.unlink()
                                retained.append(relative)
            # Explicit overrides always win over the publisher and inferred edits.
            for source in prepared_overrides.rglob('*'):
                if source.is_file():
                    relative = source.relative_to(prepared_overrides).as_posix()
                    target = safe_target(root, relative)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, target)
                    if relative not in retained:
                        retained.append(relative)
            yield
            overrides.parent.mkdir(parents=True, exist_ok=True)
            old_overrides = rollback / 'old-overrides' if overrides.exists() else None
            if old_overrides:
                os.replace(overrides, old_overrides)
            changed.append((overrides, old_overrides))
            os.replace(prepared_overrides, overrides)
            if legacy_overrides.exists():
                legacy_backup = rollback / 'legacy-overrides'
                os.replace(legacy_overrides, legacy_backup)
                changed.append((legacy_overrides, legacy_backup))
            state.parent.mkdir(parents=True, exist_ok=True)
            pending = rollback / 'content-receipt.json'
            pending.write_text(json.dumps({'config_files': config_files,
                'retained_user_configs': retained}, sort_keys=True) + '\n')
            os.replace(pending, state)
            if retained:
                print('Applied .voltra/overrides configs; review compatibility: ' + ', '.join(retained))
        except BaseException:
            for destination, backup in reversed(changed):
                if destination.exists():
                    shutil.rmtree(destination)
                if backup is not None:
                    os.replace(backup, destination)
            raise


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
        for index, archive in enumerate(plan.get("archives", [])):
            downloaded = Path(temporary) / ("pack-" + str(index) + ".zip")
            try:
                verified_archive(archive["file"], downloaded)
                unpack(downloaded, staging, archive["prefixes"])
            finally:
                downloaded.unlink(missing_ok=True)
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
        replacing_pack = bool(plan.get("archives"))
        from contextlib import nullcontext
        with pack_content_transaction(staging, root) if replacing_pack else nullcontext():
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
                first = relative.split("/")[0]
                if replacing_pack and first in PACK_REPLACE:
                    continue
                if (first in PACK_PRESERVE or first.startswith("world")) and (root / first).exists():
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
            eula = safe_target(root, "eula.txt")
            if not eula.exists():
                eula.write_text("eula=true\n", encoding="utf-8")


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
