"""Create the downloadable Mac application ZIP while retaining symlinks and modes."""
import argparse
import json
import os
import stat
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text())['version'].split('-')[0]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--build', type=Path, default=root.parent / 'app-builds/Replay Lab-darwin-arm64')
parser.add_argument('--output', type=Path, default=root.parent / f'Replay-Lab-{version}-Mac-arm64.zip')
args = parser.parse_args()
prefix = Path(f'Replay-Lab-{version}-Mac-arm64')
excluded = {'__pycache__', '.venv', '.git'}
links = 0

def add(archive, source, destination):
    global links
    if source.is_symlink():
        item = zipfile.ZipInfo(destination.as_posix())
        item.create_system = 3
        item.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(item, os.readlink(source))
        links += 1
    elif source.is_dir():
        archive.write(source, destination)
        for child in sorted(source.iterdir()):
            if child.name not in excluded:
                add(archive, child, destination / child.name)
    else:
        archive.write(source, destination)

assert (args.build / 'Replay Lab.app/Contents/MacOS/Replay Lab').is_file()
with zipfile.ZipFile(args.output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    add(archive, args.build / 'Replay Lab.app', prefix / 'Replay Lab.app')
    add(archive, args.build / 'LICENSE', prefix / 'Electron-LICENSE')
    add(archive, args.build / 'LICENSES.chromium.html', prefix / 'LICENSES.chromium.html')
    for name in ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'DESKTOP_README_CN.md', 'TEST_RESULTS_0.57.0.md','PROSODY_0.56_CN.md','CAMERA_WORKBENCH_0.57_CN.md']:
        add(archive, root / name, prefix / name)
    archive.writestr(str(prefix / 'START_HERE.txt'),
        'Replay Lab ' + version + ' · Mac 桌面测试版\n\n'
        '适用：Apple Silicon（M 系列）Mac，macOS 13 或更新系统。\n'
        '把 Replay Lab.app 拖入“应用程序”，双击打开。\n'
        '首次打开与测试限制请看 DESKTOP_README_CN.md。\n\n'
        'VoiceBridge 为可选语音服务，已有服务可继续使用。应用本体不附带声音模型。\n'
        '完整源码另附于 replay-lab-' + version + '-dev-source.zip。\n')
    for name in ['bridge', 'INSTALL_VOICE_BRIDGE.command', 'START_VOICE_BRIDGE.command', 'VOICE_BRIDGE_CN.md']:
        add(archive, root / name, prefix / 'VoiceBridge' / name)

with zipfile.ZipFile(args.output) as archive:
    assert archive.testzip() is None, 'ZIP CRC check failed'
    app_executable = archive.getinfo(str(prefix / 'Replay Lab.app/Contents/MacOS/Replay Lab'))
    assert (app_executable.external_attr >> 16) & 0o111, 'App executable mode missing'
    assert archive.read(app_executable)[:4] == b'\xcf\xfa\xed\xfe', 'Not a 64-bit Mach-O executable'
    assert links > 0, 'Framework symlinks missing'
    for name in ['INSTALL_VOICE_BRIDGE.command', 'START_VOICE_BRIDGE.command']:
        assert (archive.getinfo(str(prefix / 'VoiceBridge' / name)).external_attr >> 16) & 0o111
print(f'{args.output}: {args.output.stat().st_size} bytes; {links} symlinks preserved; CRC verified')
