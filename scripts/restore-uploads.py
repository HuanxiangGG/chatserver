#!/usr/bin/env python3
"""Restore only regular files/directories into a new isolated directory."""
import os
import pathlib
import shutil
import sys
import tarfile

def restore(archive, destination):
    target = pathlib.Path(destination)
    if not target.name.startswith('harbor_restore_') or target.exists() or target.is_symlink():
        raise ValueError('Choose a NEW directory named harbor_restore_*')
    parent = target.parent.resolve(strict=True)
    target = parent / target.name
    with tarfile.open(archive, 'r:gz') as source:
        members = source.getmembers()
        total = 0
        for member in members:
            path = pathlib.PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
                raise ValueError('Archive contains an unsafe path or non-regular entry')
            total += member.size
        if shutil.disk_usage(parent).free < total * 2 + 512 * 1024 * 1024:
            raise ValueError('Insufficient disk space for isolated restore')
        target.mkdir(mode=0o700)
        for member in members:
            path = target.joinpath(*pathlib.PurePosixPath(member.name).parts)
            if member.isdir():
                path.mkdir(mode=0o700, parents=True, exist_ok=True)
            else:
                path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with source.extractfile(member) as incoming, path.open('xb') as outgoing:
                    shutil.copyfileobj(incoming, outgoing)
                path.chmod(0o600)
    return target

if __name__ == '__main__':
    try:
        if len(sys.argv) != 3:
            raise ValueError('Usage: restore-uploads.py uploads.tar.gz NEW_harbor_restore_directory')
        os.umask(0o077)
        print('Restored into isolated directory:', restore(sys.argv[1], sys.argv[2]))
    except Exception:
        print('Isolated upload restore failed; original uploads were not modified.', file=sys.stderr)
        sys.exit(1)
