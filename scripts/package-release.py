"""Package source, built runtime and instructions, excluding local caches/models.

Run after npm test and npm run test:bridge. An existing ZIP is never overwritten.
"""
import argparse
import json
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text())['version']
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=root.parent / f'replay-lab-{version}-mlx-bridge.zip')
args = parser.parse_args()
excluded = {'node_modules', '__pycache__', '.venv', '.git', 'test-0.54.1.log'}
count = 0
with zipfile.ZipFile(args.output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        if (any(part in excluded or part.startswith('.') for part in relative.parts)
                or path.is_symlink() or not path.is_file()
                or path.suffix in {'.zip', '.pyc', '.npy', '.safetensors'}):
            continue
        archive.write(path, Path(f'replay-lab-{version}') / relative)
        count += 1
print(f'{args.output}: {count} files, {args.output.stat().st_size} bytes')
