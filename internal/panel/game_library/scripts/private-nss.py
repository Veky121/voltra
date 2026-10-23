"""MIT. Per-native-process NSS identity for arbitrary unprivileged container UIDs."""
import os
import hashlib
import subprocess
import tempfile
from pathlib import Path
from additional_survival_install import private_bytes

PACKAGE_SHA256 = '8bdc077d4f69f152da4ebd75f3a60ecbfa7e449e7a73915f11f269699aee4163'
FILES = {
    'libnss_wrapper.so': ('usr/lib/x86_64-linux-gnu/libnss_wrapper.so', '42a364bee90385ee5e14ffdd734e72a76e61a3b7bd32214cb8232fbd392355b2'),
    'copyright': ('usr/share/doc/libnss-wrapper/copyright', '8ad646968023de9a62351eba9ff206961f62afb5708cfb43d9c35f8262b559af'),
}
PACKAGE_RECEIPT = ('Debian bookworm libnss-wrapper amd64 1.1.12-1\nSHA256 ' + PACKAGE_SHA256 + '\n').encode()


def provision(root):
    """Use authenticated Bookworm apt metadata plus a fixed package digest."""
    root = Path(root).resolve()
    destination = root / '.voltra/nss'
    if destination.is_symlink() or not destination.resolve().is_relative_to(root):
        raise ValueError('Private NSS directory escapes the server volume')
    valid = all((destination / name).is_file() and not (destination / name).is_symlink()
                and hashlib.sha256((destination / name).read_bytes()).hexdigest() == digest
                for name, (_, digest) in FILES.items())
    receipt = destination / 'package.txt'
    if valid and receipt.is_file() and not receipt.is_symlink() and receipt.read_bytes() == PACKAGE_RECEIPT:
        return
    with tempfile.TemporaryDirectory(prefix='voltra-nss-') as temporary:
        directory = Path(temporary)
        subprocess.run(['apt-get', 'download', 'libnss-wrapper:amd64=1.1.12-1'], cwd=directory, check=True)
        package = directory / 'libnss-wrapper_1.1.12-1_amd64.deb'
        if hashlib.sha256(package.read_bytes()).hexdigest() != PACKAGE_SHA256:
            raise ValueError('Private NSS package digest mismatch')
        subprocess.run(['dpkg-deb', '-x', str(package), str(directory / 'extracted')], check=True)
        for target, (source, digest) in FILES.items():
            content = (directory / 'extracted' / source).read_bytes()
            if hashlib.sha256(content).hexdigest() != digest:
                raise ValueError('Private NSS extracted file digest mismatch')
            private_bytes(destination / target, content)
        private_bytes(receipt, PACKAGE_RECEIPT)


def native_environment(root, environment, binary, allowed_binary, existing_preload=()):
    root = Path(root).resolve()
    if any(c.isspace() or c == ':' for c in str(root)):
        raise ValueError('Native NSS identity needs a plain confined directory')
    binary = Path(binary).resolve()
    allowed = (root / allowed_binary).resolve()
    if binary != allowed or not binary.is_relative_to(root) or not binary.is_file():
        raise ValueError('NSS identity is restricted to the selected native executable')
    directory = root / '.voltra/nss'
    library = directory / 'libnss_wrapper.so'
    if directory.is_symlink() or library.is_symlink() or not library.is_file() or not library.resolve().is_relative_to(root):
        raise ValueError('Private NSS library is missing or escapes the server volume')
    passwd, group = directory / 'passwd', directory / 'group'
    for path in (passwd, group):
        if path.is_symlink():
            raise ValueError('Private NSS identity must not be a symbolic link')
    uid, gid = os.getuid(), os.getgid()
    private_bytes(passwd, f'voltra:x:{uid}:{gid}:Native server:{root}:/bin/sh\n'.encode())
    private_bytes(group, f'voltra:x:{gid}:\n'.encode())
    preloads = [str(library)]
    for value in existing_preload:
        path = Path(value).resolve()
        if not path.is_relative_to(root) or not path.is_file() or any(c.isspace() or c == ':' for c in str(path)):
            raise ValueError('Additional native preloads must be explicit private files')
        preloads.append(str(path))
    result = dict(environment)
    result.update(LD_PRELOAD=':'.join(preloads), NSS_WRAPPER_PASSWD=str(passwd), NSS_WRAPPER_GROUP=str(group))
    return result
