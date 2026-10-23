"""Fail deployment early when scientific or self-hosted browser assets are absent."""
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def check():
    vendor = ROOT / 'static' / 'vendor'
    manifest = json.loads((vendor / 'manifest.json').read_text(encoding='utf-8'))
    for name, entry in manifest.items():
        if hashlib.sha256((vendor / name).read_bytes()).hexdigest() != entry['sha256']:
            raise ValueError('Biblioteca/cartografía ausente o alterada: ' + name)
    directory = ROOT / 'data' / 'viewer'
    catalogue = json.loads((directory / 'catalogue.json').read_text(encoding='utf-8'))
    assert len(catalogue['candidates']) == 3
    assert catalogue['evaluation']['scientific_accuracy'] is None
    distances = [c['pca_distance'] for c in catalogue['candidates']]
    assert distances == sorted(distances)
    for identifier in ['jezero', *[c['id'] for c in catalogue['candidates']]]:
        grid = json.loads((directory / (identifier + '.json')).read_text(encoding='utf-8'))
        assert grid['cell_m'] == 500 and grid['window_km'] == 10
        for key in ['relative_elevation_m', 'slope_deg']:
            assert len(grid[key]) == 20 and all(len(row) == 20 for row in grid[key])
            assert all(math.isfinite(v) for row in grid[key] for v in row)
        source = ROOT / 'data' / 'terrain' / (grid['region_id'] + '.npz')
        assert hashlib.sha256(source.read_bytes()).hexdigest() == grid['provenance']['sha256']
    print('Verified 4 DEM viewer grids, ranking, provenance and local browser assets.')


if __name__ == '__main__':
    check()
