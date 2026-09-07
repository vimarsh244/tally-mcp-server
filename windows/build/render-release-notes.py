#!/usr/bin/env python3
"""
Fills in the release notes template for a Windows release.

Kept as a script rather than inline workflow shell so it can be run and checked
locally, which is cheaper than learning about a typo from a CI run.

    python3 windows/build/render-release-notes.py \
        --version 7.6.0 --tag v7.6.0 \
        --repo-url https://github.com/owner/repo \
        --installer-dir installers --out notes.md
"""

import argparse
import hashlib
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
WINDOWS_DIR = HERE.parent


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        # read in chunks, because an installer is tens of megabytes
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def human_size(path):
    megabytes = path.stat().st_size / (1024 * 1024)
    return f'{megabytes:.1f} MB'


def find_installer(directory):
    matches = sorted(directory.glob('*.exe'))
    if not matches:
        sys.exit(f'no installer in {directory}')
    if len(matches) > 1:
        sys.exit(f'more than one installer in {directory}: {[m.name for m in matches]}')
    return matches[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--repo-url', required=True)
    parser.add_argument('--installer-dir', required=True, type=pathlib.Path)
    parser.add_argument('--template', type=pathlib.Path, default=WINDOWS_DIR / 'release-notes.md')
    parser.add_argument('--pins', type=pathlib.Path, default=HERE / 'dependencies.json')
    parser.add_argument('--out', type=pathlib.Path)
    args = parser.parse_args()

    pins = json.loads(args.pins.read_text())
    installer = find_installer(args.installer_dir)

    values = {
        'VERSION': args.version,
        'TAG': args.tag,
        'REPO_URL': args.repo_url,
        'DOWNLOAD_BASE': f'{args.repo_url}/releases/download/{args.tag}',
        'FILE': installer.name,
        'SHA': sha256(installer),
        'SIZE': human_size(installer),
        'NODE': pins['node']['version'],
        'WINSW': pins['winsw']['version'],
    }

    notes = args.template.read_text()
    for key, value in values.items():
        notes = notes.replace('{{' + key + '}}', value)

    # a placeholder that survived means the template and this script disagree,
    # and a release carrying '{{SHA_X64}}' verbatim helps nobody
    leftover = re.findall(r'\{\{[A-Z_0-9]+\}\}', notes)
    if leftover:
        sys.exit(f'unreplaced placeholder in the notes: {sorted(set(leftover))}')

    if args.out:
        args.out.write_text(notes)
        print(f'wrote {args.out}', file=sys.stderr)
    else:
        sys.stdout.write(notes)


if __name__ == '__main__':
    main()
