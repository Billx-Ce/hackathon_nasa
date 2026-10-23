"""One-time download of pinned browser libraries and public geographic context."""
import hashlib
import json
from pathlib import Path
import httpx

OUT = Path(__file__).resolve().parents[1] / 'static' / 'vendor'
FILES = {
    'three.module.js': 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
    'OrbitControls.js': 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js',
    'THREE-LICENSE.txt': 'https://cdn.jsdelivr.net/npm/three@0.170.0/LICENSE',
    'leaflet.js': 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
    'leaflet.css': 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
    'LEAFLET-LICENSE.txt': 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/LICENSE',
    'world.geojson': 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson',
}

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}
    with httpx.Client(timeout=90, follow_redirects=True) as client:
        for name, url in FILES.items():
            response = client.get(url)
            response.raise_for_status()
            content = response.content
            (OUT / name).write_bytes(content)
            manifest[name] = dict(url=url, sha256=hashlib.sha256(content).hexdigest())
            print(name, len(content), flush=True)
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
