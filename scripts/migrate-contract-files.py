#!/usr/bin/env python3
"""SEC-001 offline migration. Defaults to dry run; Python 3.11+, POSIX only.
Stop contract writers before applying. Never follow directory/file symlinks.
"""
import argparse
import hashlib
import os
from pathlib import Path
import re
import stat

NAME = re.compile(r'contract-([1-9][0-9]*)-(preview|signed)\.pdf', re.I)
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def directory(path, create=False):
    """Walk from filesystem root using directory descriptors, never symlinks."""
    path = Path(os.path.abspath(path))
    fd = os.open('/', DIR_FLAGS)
    try:
        for part in path.parts[1:]:
            if create:
                try:
                    os.mkdir(part, 0o700, dir_fd=fd)
                except FileExistsError:
                    pass
            next_fd = os.open(part, DIR_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd
    except BaseException:
        os.close(fd)
        raise


def digest(fd, name):
    file_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    with os.fdopen(file_fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            raise ValueError(f'Unsafe file (not a single-link regular file): {name}')
        result = hashlib.file_digest(stream, 'sha256').hexdigest()
        after = os.fstat(stream.fileno())
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError(f'File changed during read: {name}')
        return result, before


def migrate(root, apply=False):
    root = Path(os.path.abspath(root))
    source = root / 'data/uploads'
    target = root / 'data/private/contracts'
    src = directory(source)
    dst = None
    try:
        try:
            dst = directory(target)
        except FileNotFoundError:
            pass
        plan = []
        destinations = {}
        # Preflight all files before any mutation. Unexpected contract-prefixed
        # entries require investigation rather than silently remaining public.
        for name in sorted(os.listdir(src)):
            if not name.lower().startswith('contract-'):
                continue
            match = NAME.fullmatch(name)
            if not match:
                raise ValueError(f'Unrecognized legacy contract filename: {name}')
            canonical = f'contract-{match[1]}-{match[2].lower()}.pdf'
            checksum, original = digest(src, name)
            if canonical in destinations and destinations[canonical] != checksum:
                raise ValueError(f'Conflicting legacy files: {canonical}')
            destinations[canonical] = checksum
            if dst is not None:
                try:
                    existing, _ = digest(dst, canonical)
                    if checksum != existing:
                        raise ValueError(f'Destination differs; source preserved: {canonical}')
                except FileNotFoundError:
                    pass
            plan.append((name, canonical, checksum, original))
        for name, canonical, checksum, _ in plan:
            print(f'{"APPLY" if apply else "DRY-RUN"} {name} -> private/contracts/{canonical} sha256={checksum}')
        if not apply or not plan:
            return len(plan)
        if dst is None:
            dst = directory(target, create=True)
        for name, canonical, checksum, original in plan:
            current, current_stat = digest(src, name)
            if current != checksum or (current_stat.st_dev, current_stat.st_ino) != (original.st_dev, original.st_ino):
                raise ValueError(f'Source changed after preflight: {name}')
            try:
                out = os.open(canonical, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=dst)
            except FileExistsError:
                out = None
            if out is not None:
                # Partial copy on failure remains private; source is retained.
                with os.fdopen(out, 'wb') as output:
                    inp = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=src)
                    with os.fdopen(inp, 'rb') as stream:
                        info = os.fstat(stream.fileno())
                        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or (info.st_dev, info.st_ino) != (original.st_dev, original.st_ino):
                            raise ValueError(f'Source replaced before copy: {name}')
                        while chunk := stream.read(1024 * 1024):
                            output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())
            copied, _ = digest(dst, canonical)
            remaining, remaining_stat = digest(src, name)
            if copied != checksum or remaining != checksum or (remaining_stat.st_dev, remaining_stat.st_ino) != (original.st_dev, original.st_ino):
                raise ValueError(f'Integrity verification failed; source retained: {name}')
            os.fsync(dst)
            os.unlink(name, dir_fd=src)
            os.fsync(src)
        return len(plan)
    finally:
        os.close(src)
        if dst is not None:
            os.close(dst)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True, help='Exact backend process.cwd(), not necessarily repository root')
    parser.add_argument('--apply', action='store_true', help='Copy, verify, then remove public source (writers must be stopped)')
    args = parser.parse_args()
    try:
        count = migrate(args.root, args.apply)
        print(f'{count} legacy contract file(s); {"applied" if args.apply else "no changes made"}.')
    except (OSError, ValueError) as error:
        parser.exit(1, f'Migration aborted: {error}\n')
