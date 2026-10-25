"""MIT. Checksum-bound ZIP/gzip/XZ installation with owned-file rollback."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tarfile
import tempfile
import urllib.parse
import urllib.request
import zipfile
import steam_template
from fantasy_worlds_runtime import confined, publish_stream, read_json

MAX_ARCHIVE = 8 * 1024**3
MAX_EXPANDED = 32 * 1024**3
MAX_FILES = 100000


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def checksum(value):
    if not isinstance(value, str) or len(value) != 64 or any(c not in '0123456789abcdefABCDEF' for c in value):
        raise ValueError('Supply an independently verified archive SHA256')
    return value.lower()


def url(value):
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None or parsed.password is not None or parsed.fragment:
        raise ValueError('Download URL must use HTTPS without embedded credentials or fragments')
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Invalid download URL')
    return value


class HTTPSOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        url(newurl)
        return super().redirect_request(request, fp, code, message, headers, newurl)


def download(value, expected, target):
    expected, value = checksum(expected), url(value)
    # URL values remain data, including query parameters. Never invoke curl or
    # include source URLs in console output or saved receipt metadata.
    with urllib.request.build_opener(HTTPSOnly()).open(value, timeout=120) as response, target.open('xb') as output:
        url(response.geturl())
        length = response.headers.get('Content-Length')
        if length and (not length.isdecimal() or int(length) > MAX_ARCHIVE):
            raise ValueError('Publisher archive exceeds download limit')
        count, identity = 0, hashlib.sha256()
        while block := response.read(1024 * 1024):
            count += len(block)
            if count > MAX_ARCHIVE:
                raise ValueError('Publisher archive exceeds download limit')
            identity.update(block); output.write(block)
    if identity.hexdigest() != expected:
        raise ValueError('Publisher archive checksum mismatch')


def member_path(name):
    path = PurePosixPath(name)
    if not name or path.is_absolute() or '\\' in name or ':' in name or '..' in path.parts or any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise ValueError('Unsafe archive member path')
    normalized = path.as_posix()
    if normalized in ('', '.'):
        return None
    if path.parts[0].casefold() == '.voltra':
        raise ValueError('Archive may not replace adapter control files')
    return normalized


def extract(archive, target):
    seen, directories, spellings, total = set(), set(), {}, 0
    def write(name, size, mode, source, directory=False):
        nonlocal total
        relative = member_path(name)
        if relative is None:
            if directory: return
            raise ValueError('Invalid archive file name')
        identity = relative.casefold()
        parts = PurePosixPath(relative).parts
        for index in range(1, len(parts) + 1):
            spelling = PurePosixPath(*parts[:index]).as_posix()
            previous = spellings.setdefault(spelling.casefold(), spelling)
            if previous != spelling:
                raise ValueError('Case-colliding archive path component')
        if identity in seen or identity in directories and not directory:
            raise ValueError('Duplicate or case-colliding archive member')
        if directory:
            directories.add(identity)
            if len(directories) > MAX_FILES:
                raise ValueError('Archive has too many directories')
            confined(target, relative).mkdir(parents=True, exist_ok=True)
            return
        seen.add(identity); total += size
        if len(seen) > MAX_FILES or size < 0 or total > MAX_EXPANDED:
            raise ValueError('Archive expansion exceeds limits')
        path = confined(target, relative)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb') as output:
            count = 0
            while block := source.read(1024 * 1024):
                count += len(block)
                if count > size:
                    raise ValueError('Archive member exceeds declared size')
                output.write(block)
        if count != size:
            raise ValueError('Truncated archive member')
        path.chmod((mode & 0o777) or 0o644)
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as source:
            if len(source.infolist()) > MAX_FILES:
                raise ValueError('Archive has too many entries')
            for entry in source.infolist():
                if stat.S_ISLNK(entry.external_attr >> 16) or entry.flag_bits & 1:
                    raise ValueError('Archive links and encryption are unsupported')
                if entry.is_dir():
                    write(entry.filename, 0, 0, None, True)
                else:
                    with source.open(entry) as stream:
                        write(entry.filename, entry.file_size, entry.external_attr >> 16, stream)
    else:
        with archive.open('rb') as stream: magic = stream.read(6)
        if not (magic.startswith(b'\x1f\x8b') or magic == b'\xfd7zXZ\x00'):
            raise ValueError('Expected ZIP, gzip tar or XZ tar archive')
        with tarfile.open(archive, 'r:*') as source:
            for entry in source:
                if not (entry.isfile() or entry.isdir()):
                    raise ValueError('Archive links and special files are unsupported')
                if entry.isdir(): write(entry.name, 0, 0, None, True)
                else:
                    with source.extractfile(entry) as stream:
                        write(entry.name, entry.size, entry.mode, stream)


def publish_tree(root, staged, install_relative, preserve, archive_identity=None):
    receipt_relative = '.voltra/sandbox-servers/generic-files.json'
    receipt = confined(root, receipt_relative)
    old = read_json(receipt) if receipt.exists() else {}
    tracked = old.get('files', {})
    if not isinstance(tracked, dict):
        raise ValueError('Invalid generic installer ownership receipt')
    exclusions = [tuple(p.casefold() for p in PurePosixPath(value).parts) for value in preserve]
    changes, identities = [], {}
    with tempfile.TemporaryDirectory(prefix='.voltra-generic-rollback-',dir=root) as backup:
        empty_directories = []
        for directory in sorted(path for path in staged.rglob('*') if path.is_dir()):
            relative = (PurePosixPath(install_relative) / directory.relative_to(staged).as_posix()).as_posix()
            parts = tuple(p.casefold() for p in PurePosixPath(relative).parts)
            if any(parts[:len(excluded)] == excluded for excluded in exclusions): continue
            destination = confined(root, relative)
            if destination.exists() and not destination.is_dir():
                raise ValueError('Archive directory collides with existing operator file')
            empty_directories.append(relative)
        for source in sorted(staged.rglob('*')):
            if not source.is_file(): continue
            relative = (PurePosixPath(install_relative) / source.relative_to(staged).as_posix()).as_posix()
            parts = tuple(p.casefold() for p in PurePosixPath(relative).parts)
            if any(parts[:len(excluded)] == excluded for excluded in exclusions): continue
            target, expected = confined(root, relative), digest(source)
            if target.exists():
                actual = digest(target)
                if actual == expected:
                    identities[relative] = expected; continue
                if tracked.get(relative) != actual:
                    raise ValueError('Modified or unmanaged program collision; operator file preserved')
                saved = Path(backup) / str(len(changes)); shutil.copyfile(target, saved)
                metadata = target.stat()
            else: saved, metadata = None, None
            identities[relative] = expected
            changes.append((relative, source, saved, metadata))
        record = Path(backup) / 'new-receipt'
        record.write_text(json.dumps({'schema_version': 1, 'files': identities, 'directories': empty_directories, 'archive': archive_identity}, indent=2) + '\n')
        saved, metadata = None, None
        if receipt.exists():
            saved = Path(backup) / 'old-receipt'; shutil.copyfile(receipt, saved); metadata = receipt.stat()
        changes.append((receipt_relative, record, saved, metadata))
        published = []
        try:
            for relative in empty_directories:
                with steam_template._publication_parent(root, relative + '/.voltra-directory-check', create=True):
                    pass
            for relative, source, saved, metadata in changes:
                reserved = {}
                with source.open('rb') as stream:
                    def writer(output):
                        shutil.copyfileobj(stream, output)
                        reserved['inode'] = os.fstat(output.fileno())
                    try:
                        steam_template._publish(root, relative, writer, default_mode=0o600 if relative == receipt_relative else source.stat().st_mode & 0o777)
                    except BaseException:
                        target = confined(root, relative)
                        current = target.stat() if target.exists() else None
                        inode = reserved.get('inode')
                        if current and inode and (current.st_dev, current.st_ino) == (inode.st_dev, inode.st_ino):
                            published.append((relative, saved, metadata, inode))
                        raise
                published.append((relative, saved, metadata, confined(root, relative).stat()))
        except BaseException as failure:
            errors = []
            for relative, saved, metadata, inode in reversed(published):
                try:
                    target = confined(root, relative); current = target.stat()
                    if (current.st_dev, current.st_ino) != (inode.st_dev, inode.st_ino):
                        raise ValueError('Generic rollback destination changed')
                    if saved is None: target.unlink()
                    else:
                        with saved.open('rb') as stream:
                            publish_stream(root, relative, lambda output: shutil.copyfileobj(stream, output), metadata=metadata)
                except BaseException as error: errors.append(error)
            if errors:
                raise RuntimeError('Generic publication failed; all owned rollback destinations attempted with errors') from failure
            raise
