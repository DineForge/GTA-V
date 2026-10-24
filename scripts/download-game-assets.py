"""Download and verify the release payload, without running a site build."""
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from download_game import digest, extract_payload, target_path

ROOT = Path(__file__).resolve().parents[1]
STAGING = Path(os.environ.get('BTA_GAME_STAGING_DIR', str(Path.home() / '.cache' / 'bta-game-assets'))).resolve()

def main():
    manifest = json.loads((ROOT / 'download-manifest.json').read_text())
    inventory = json.loads((ROOT / 'file-inventory.json').read_text())
    if STAGING == ROOT or ROOT in STAGING.parents:
        raise ValueError('Game staging must be outside the repository to keep deploy source archives small.')
    cache = STAGING / '.downloads'
    cache.mkdir(parents=True, exist_ok=True)
    def install(part):
        records = [r for r in inventory['files'] if r['part'] == part['name'] and r['path'].startswith('mirror/playgta5.com/')]
        if all(target_path(STAGING, r['path']).is_file() and digest(target_path(STAGING, r['path'])) == r['sha256'] for r in records):
            print('Verified existing assets:', part['name'], flush=True)
            return
        archive = cache / part['name']
        if not archive.exists():
            print('Downloading:', part['name'], flush=True)
            subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error', '--retry', '4', '--output', str(archive), part['url']], check=True)
        if archive.stat().st_size != part['bytes'] or digest(archive) != part['sha256']:
            raise ValueError('Archive checksum mismatch: ' + part['name'])
        extract_payload(archive, STAGING, records, windows=False)
        archive.unlink()
        print('Verified release assets:', part['name'], flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(install, manifest['parts']))

if __name__ == '__main__':
    main()
