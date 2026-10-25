#!/usr/bin/env python3
"""Verified official headless acquisition. Does not execute Factorio.

The install root must be offline and exclusively owned by the install job.
Existing mutable files are never imported into an archive extraction directory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import stat
import struct
import sys
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request

PIN = "2.0.77"
PIN_SHA = "c4efc11529f74d37c96933e291e0db73fd9f5aa4738913d9301b24680b3e947f"
RELEASES = "https://factorio.com/api/latest-releases"
SUMS = "https://factorio.com/download/sha256sums/"
VERSION = re.compile(r"(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,3})\Z")
MAX_ARCHIVE = 1024 * 1024 * 1024
MAX_EXPANDED = 4 * MAX_ARCHIVE
PROTECTED = {"data/map-gen-settings.json", "data/map-settings.json", "data/server-settings.json"}


class InstallError(Exception):
    pass


def official(url):
    parsed = urllib.parse.urlsplit(url)
    host = parsed.hostname or ""
    if (parsed.scheme != "https" or parsed.username is not None or parsed.password is not None
            or parsed.port not in (None, 443) or not (host == "factorio.com" or host.endswith(".factorio.com"))):
        raise InstallError("Download redirected outside official Factorio HTTPS endpoints")
    return url


class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        official(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url, destination, limit):
    official(url)
    # No automatic retries, credentials, third-party mirrors or fallback releases.
    opener = urllib.request.build_opener(OfficialRedirect())
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "Voltra-Factorio-Installer/1.0"})
        with opener.open(request, timeout=60) as response, open(destination, "xb") as output:
            official(response.geturl())
            total = 0
            while True:
                chunk = response.read(min(1024 * 1024, limit - total + 1))
                if not chunk:
                    break
                total += len(chunk)
                if total > limit:
                    raise InstallError("Official download exceeds the configured size limit")
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
    except urllib.error.HTTPError as exc:
        code = exc.code
        exc.close()
        raise InstallError("Official download unavailable, HTTP %s; no fallback attempted" % code) from None
    except urllib.error.URLError:
        raise InstallError("Official download failed; no fallback attempted") from None


def digest(path):
    result = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def metadata(url, work, name, limit, transport):
    path = work / name
    transport(url, path, limit)
    if path.stat().st_size > limit:
        raise InstallError("Metadata exceeds limit")
    return path.read_text(encoding="utf-8")


def resolve(requested, work, transport=fetch):
    if requested in ("latest", "stable", "experimental"):
        branch = "experimental" if requested == "experimental" else "stable"
        try:
            version = json.loads(metadata(RELEASES, work, "releases.json", 65536, transport))[branch]["headless"]
        except (ValueError, KeyError, TypeError):
            raise InstallError("Official release metadata is malformed") from None
    else:
        version = requested
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        raise InstallError("Version must be a literal X.Y.Z, stable, latest or experimental")
    if version == PIN:
        return version, PIN_SHA
    filename = "factorio-headless_linux_%s.tar.xz" % version
    inventory = metadata(SUMS, work, "sha256sums.txt", 4 * 1024 * 1024, transport)
    matches = []
    for line in inventory.splitlines():
        fields = line.split()
        if len(fields) == 2 and fields[1].lstrip("*") == filename:
            matches.append(fields[0])
    if len(matches) != 1 or not re.fullmatch(r"[0-9a-f]{64}", matches[0]):
        raise InstallError("Unsupported or unavailable headless Linux x64 version %s: no unique official SHA256" % version)
    return version, matches[0]


def safe_relative(name):
    if "\\" in name or ":" in name or "\x00" in name or any(ord(c) < 32 for c in name):
        raise InstallError("Unsafe archive path")
    pieces = name.rstrip("/").split("/")
    if not pieces or pieces[0] != "factorio" or any(x in ("", ".", "..") for x in pieces):
        raise InstallError("Archive must contain confined factorio/ paths")
    if len(pieces) == 1:
        return None
    relative = "/".join(pieces[1:])
    if pieces[1] not in ("bin", "data", "doc", "config", "saves", "mods", "licenses", "achievements.txt", "config-path.cfg", "player-data.json"):
        raise InstallError("Unrecognized archive top-level path: " + pieces[1])
    return relative


def protected(name):
    return name in PROTECTED or name.split("/", 1)[0] in ("config", "saves", "mods") or name == "player-data.json"


def extract(archive, destination, version):
    names = {}
    total = 0
    files = []
    with tarfile.open(archive, "r:xz") as bundle:
        members = bundle.getmembers()
        if len(members) > 100000:
            raise InstallError("Archive has too many entries")
        for entry in members:
            name = safe_relative(entry.name)
            if name is None:
                if not entry.isdir():
                    raise InstallError("Archive root is not a directory")
                continue
            if not (entry.isdir() or entry.isfile()):
                raise InstallError("Archive links and special entries are unsupported")
            folded = name.casefold()
            if folded in names:
                raise InstallError("Duplicate or case-colliding archive path")
            names[folded] = (name, entry.isdir())
            total += entry.size
            if total > MAX_EXPANDED or entry.size < 0:
                raise InstallError("Expanded archive exceeds limit")
        for name, isdir in names.values():
            for parent in PurePosixPath(name).parents:
                existing = names.get(str(parent).casefold())
                if existing is not None and not existing[1]:
                    raise InstallError("Archive file/directory collision")
        for entry in members:
            name = safe_relative(entry.name)
            if name is None or entry.isdir():
                continue
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.extractfile(entry) as source, open(target, "xb") as output:
                shutil.copyfileobj(source, output)
                output.flush()
                os.fsync(output.fileno())
            os.chmod(target, 0o755 if entry.mode & 0o111 else 0o644)
            if not protected(name):
                files.append(name)
    try:
        info = json.loads((destination / "data/base/info.json").read_text())
        if info["version"] != version or info["name"] != "base":
            raise InstallError("Archive metadata does not match requested version")
        with open(destination / "bin/x64/factorio", "rb") as binary:
            header = binary.read(20)
        if len(header) != 20 or header[:6] != b"\x7fELF\x02\x01" or struct.unpack("<H", header[18:20])[0] != 62:
            raise InstallError("Archive is not an ELF64 Linux x64 Factorio build")
    except (OSError, ValueError, KeyError, TypeError):
        raise InstallError("Archive is missing valid Factorio version/binary metadata") from None
    return sorted(files)


def confined(root, name):
    if not isinstance(name, str) or not name or name.startswith(("/", "\\")) or "\x00" in name:
        raise InstallError("Unsafe publication path")
    path = root
    for part in PurePosixPath(name).parts:
        if part in ("", ".", "..") or ":" in part or "\\" in part:
            raise InstallError("Unsafe publication path")
        path = path / part
        if path.is_symlink():
            raise InstallError("Install target contains a symlink: " + name)
    return path


def sync_dir(path):
    if os.name != "nt":
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def write_json(path, value):
    with open(path, "x", encoding="utf-8") as output:
        json.dump(value, output, sort_keys=True)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())


def publish(root, stage, files, version, requested, archive_sha, hook=lambda point: None):
    """Journal before mutation; roll back on cancellation/errors and next invocation.

    Transaction directory must remain until commit directory fsync succeeds. A
    power failure leaves explicit recovery state; no success inferred from it.
    """
    state = root / ".voltra"
    transaction = state / "factorio-transaction"
    if transaction.exists():
        raise InstallError("Unfinished Factorio transaction; run --recover before reinstall")
    prior = state / "factorio-installed.json"
    previous = None
    if prior.exists():
        try:
            previous = json.loads(prior.read_text())
            if previous.get("format") != 1 or not isinstance(previous.get("files"), dict):
                raise ValueError()
        except (ValueError, OSError):
            raise InstallError("Installed-version receipt is malformed") from None
    old_version = previous.get("version") if previous else None
    if old_version is None and (root / "data/base/info.json").exists():
        try:
            old_version = json.loads(confined(root, "data/base/info.json").read_text())["version"]
        except (ValueError, KeyError, TypeError):
            raise InstallError("Existing Factorio version metadata is malformed; preserve backups and inspect before migration") from None
    if old_version is not None:
        if not isinstance(old_version, str) or not VERSION.fullmatch(old_version):
            raise InstallError("Existing Factorio version is invalid")
        if tuple(map(int, version.split("."))) < tuple(map(int, old_version.split("."))):
            raise InstallError("Downgrade refused: saves/config may be incompatible. Restore an appropriate backup into a separate server")
    # No version history means migration compatibility cannot be established.
    if old_version is None and any((root / "saves").glob("*.zip")):
        raise InstallError("Existing saves have no installed-version receipt. Back up and explicitly establish their compatible Factorio version before migration")
    stale = set(previous["files"] if previous else ()) - set(files)
    changes = sorted(set(files) | stale | {".voltra/factorio-installed.json"})
    records = []
    for name in changes:
        target = confined(root, name)
        if target.exists() and not target.is_file():
            raise InstallError("Publication conflicts with a non-file: " + name)
        if target.exists() and name != ".voltra/factorio-installed.json":
            if previous:
                owned = previous["files"].get(name)
                if owned is None:
                    raise InstallError("New publisher path conflicts with an operator file: " + name)
                if digest(target) != owned["sha256"] or target.stat().st_size != owned["size"]:
                    raise InstallError("Receipt-owned publisher file was operator-modified: " + name)
            else:
                if old_version != version:
                    raise InstallError("Legacy ownership is unverified. Reinstall its current exact version first, using an official verified archive/cache, then upgrade")
                if name not in files or digest(target) != digest(stage / name):
                    raise InstallError("Legacy publisher file differs from the exact verified archive: " + name)
        current = target.stat() if target.exists() else None
        records.append({"path": name, "existed": current is not None,
                        "mode": stat.S_IMODE(current.st_mode) if current else None,
                        "uid": current.st_uid if current else None, "gid": current.st_gid if current else None})
    transaction.mkdir(mode=0o700)
    (transaction / "backup").mkdir()
    journal = {"format": 1, "records": records, "directories": []}
    # Record all prospective new directories before creating any of them.
    dirs = set()
    for row in records:
        for directory in confined(root, row["path"]).parents:
            if directory == root:
                break
            if not directory.exists():
                dirs.add(directory.relative_to(root).as_posix())
    journal["directories"] = sorted(dirs, key=lambda x: (x.count("/"), x))
    write_json(transaction / "journal.json", journal)
    sync_dir(transaction)
    sync_dir(state)
    receipt_files = {}
    try:
        hook("before_publish")
        for directory in journal["directories"]:
            confined(root, directory).mkdir(mode=0o755)
        for row in records:
            name = row["path"]
            target = confined(root, name)
            backup = transaction / "backup" / name
            backup.parent.mkdir(parents=True, exist_ok=True)
            if row["existed"]:
                os.replace(target, backup)
                sync_dir(backup.parent)
                sync_dir(target.parent)
            if name == ".voltra/factorio-installed.json":
                continue
            if name in files:
                source = stage / name
                mode = row["mode"] if row["mode"] is not None else stat.S_IMODE(source.stat().st_mode)
                if os.name != "nt" and row["uid"] is not None:
                    os.chown(source, row["uid"], row["gid"])
                os.chmod(source, mode)
                os.replace(source, target)
                sync_dir(target.parent)
                installed_stat = target.stat()
                receipt_files[name] = {"sha256": digest(target), "mode": mode, "size": installed_stat.st_size,
                                       "uid": installed_stat.st_uid, "gid": installed_stat.st_gid}
            hook("published:" + name)
        receipt = {"format": 1, "version": version, "requested": requested, "archive_sha256": archive_sha,
                   "payload_architecture": "linux-x64", "files": receipt_files,
                   "compatibility": "not_tested; saves/config preserved, back up before changing versions"}
        write_json(transaction / "receipt.tmp", receipt)
        hook("before_receipt")
        os.replace(transaction / "receipt.tmp", prior)
        sync_dir(state)
        hook("after_receipt")
        # Durable commit marker distinguishes recoverable mutation from commit.
        write_json(transaction / "committed.json", {"receipt_sha256": digest(prior)})
        sync_dir(transaction)
    except BaseException:
        recover(root)
        raise
    shutil.rmtree(transaction)
    sync_dir(state)
    return receipt


def recover(root):
    transaction = root / ".voltra/factorio-transaction"
    if not transaction.exists():
        return
    journal_path = transaction / "journal.json"
    if not journal_path.exists():
        raise InstallError("Incomplete journal requires operator inspection; no automatic mutation")
    journal = json.loads(journal_path.read_text())
    if journal.get("format") != 1:
        raise InstallError("Unsupported recovery journal")
    if (transaction / "committed.json").exists():
        marker = json.loads((transaction / "committed.json").read_text())
        if marker["receipt_sha256"] != digest(root / ".voltra/factorio-installed.json"):
            raise InstallError("Committed receipt was changed; recovery stopped")
        sync_dir(root / ".voltra")
        sync_dir(transaction)
    else:
        for row in reversed(journal["records"]):
            target = confined(root, row["path"])
            backup = confined(transaction / "backup", row["path"])
            if backup.exists():
                os.replace(backup, target)
                sync_dir(target.parent)
            elif not row["existed"] and target.exists():
                target.unlink()
                sync_dir(target.parent)
        for name in reversed(journal["directories"]):
            directory = confined(root, name)
            if directory.exists():
                directory.rmdir()  # Never recursively remove operator content.
    shutil.rmtree(transaction)
    sync_dir(root / ".voltra")


class InstallLock:
    def __init__(self, path):
        self.path = path

    def __enter__(self):
        self.file = open(self.path, "a+b")
        try:
            if os.name == "nt":
                import msvcrt
                self.file.seek(0)
                if self.file.read(1) == b"":
                    self.file.write(b"0")
                    self.file.flush()
                self.file.seek(0)
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.file.close()
            raise InstallError("Another Factorio installation is active") from None
        return self

    def __exit__(self, *args):
        self.file.close()


def install(root, requested, architecture="x64", transport=fetch, cache=None, machine=None, hook=lambda point: None):
    root = Path(root).absolute()
    if root.is_symlink() or root.resolve() != root:
        raise InstallError("Install root must be a real absolute directory without symlink ancestors")
    machine = machine or platform.machine()
    if architecture not in ("x64", "box64") or machine not in ({"x86_64", "AMD64"} if architecture == "x64" else {"aarch64", "arm64"}):
        raise InstallError("Wrong node architecture; Box64 recipe requires ARM64, vanilla requires x64")
    root.mkdir(parents=True, exist_ok=True)
    state = confined(root, ".voltra")
    state.mkdir(mode=0o755, exist_ok=True)
    with InstallLock(confined(root, ".voltra/factorio-install.lock")):
        if (state / "factorio-transaction").exists():
            raise InstallError("Unfinished installation requires --recover")
        with tempfile.TemporaryDirectory(prefix=".factorio-install.", dir=root) as temporary:
            work = Path(temporary)
            version, expected = resolve(requested, work, transport)
            archive = work / "server.tar.xz"
            if cache is not None:
                # Optional existing read-only archive, always independently hashed.
                if Path(cache).stat().st_size > MAX_ARCHIVE:
                    raise InstallError("Cached archive exceeds limit")
                shutil.copyfile(cache, archive)
            else:
                transport("https://factorio.com/get-download/%s/headless/linux64" % version, archive, MAX_ARCHIVE)
            if archive.stat().st_size > MAX_ARCHIVE or digest(archive) != expected:
                raise InstallError("Archive SHA256 mismatch; installed files unchanged")
            unpacked = work / "unpacked"
            unpacked.mkdir()
            files = extract(archive, unpacked, version)
            hook("verified")
            return publish(root, unpacked, files, version, requested, expected, hook)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--version", default=PIN)
    parser.add_argument("--architecture", choices=("x64", "box64"), default="x64")
    parser.add_argument("--cache", help="Existing archive to verify, never trusted without SHA256")
    parser.add_argument("--recover", action="store_true")
    args = parser.parse_args()
    try:
        if args.recover:
            root = Path(args.root).absolute()
            if root.resolve() != root:
                raise InstallError("Recovery root cannot contain symlinks")
            with InstallLock(confined(root, ".voltra/factorio-install.lock")):
                recover(root)
            print("Factorio transaction recovery completed")
        else:
            receipt = install(args.root, args.version, args.architecture, cache=args.cache)
            print("Factorio %s verified and installed. Existing saves/config/mods preserved. Save/config compatibility has not been tested; keep backups." % receipt["version"])
    except (InstallError, OSError, tarfile.TarError) as exc:
        print("Factorio installation stopped: " + str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
