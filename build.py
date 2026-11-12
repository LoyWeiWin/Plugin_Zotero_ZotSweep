#!/usr/bin/env python3
"""Build the self-contained Zotero XPI using only the Python standard library."""
from pathlib import Path
import json
from zipfile import ZipFile, ZIP_DEFLATED
ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'source' if (ROOT / 'source').is_dir() else ROOT
OUTPUT = ROOT / 'dist'
OUTPUT.mkdir(exist_ok=True)
version = json.loads((SOURCE / 'manifest.json').read_text())['version']
name = OUTPUT / f'ZotSweep_v{version}.xpi'
with ZipFile(name, 'w', ZIP_DEFLATED) as archive:
    for entry in ('manifest.json', 'bootstrap.js', 'core.js', 'runtime.js', 'review.xhtml', 'review.js', 'review.css', 'LICENSE'):
        archive.write(SOURCE / entry, entry)
    for path in sorted((SOURCE / 'icons').rglob('*')):
        if path.is_file():
            archive.write(path, path.relative_to(SOURCE).as_posix())
print(name)
