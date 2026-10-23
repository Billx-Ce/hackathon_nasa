"""Export small scientific grids and fixed held-out candidates for the browser."""
import hashlib
import json
from pathlib import Path

import numpy as np
import terrain

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'data' / 'viewer'
# Fixed locations, not the top three picked after seeing PCA distances.
# All are in the held-out eastern sector, and their footprints do not overlap.
CANDIDATES = [
    ('la-joya-este', 'La Joya · sector este', 'la-joya', 5, 6, 'Perú'),
    ('atacama-central', 'Atacama · sector central', 'atacama-control', 5, 6, 'Chile'),
    ('atacama-noreste', 'Atacama · sector noreste', 'atacama-control', 1, 8, 'Chile'),
]


def grid_payload(identifier, name, region_id, row, col, result, latitude, longitude):
    provenance = result['provenance'][region_id]
    path = terrain.DATA / (region_id + '.npz')
    if hashlib.sha256(path.read_bytes()).hexdigest() != provenance['sha256']:
        raise ValueError('Checksum incorrecto: ' + region_id)
    with np.load(path, allow_pickle=False) as source:
        z = source['elevation_m'][row:row+20, col:col+20].astype(float)
    features = terrain.descriptors(z)
    relative = z - z.mean()
    # Display slope at edges uses one-sided differences. Scientific descriptors
    # retain central differences only in the 18x18 interior (terrain.py).
    dy, dx = np.gradient(z, terrain.CELL, edge_order=2)
    slope = np.degrees(np.arctan(np.hypot(dx, dy)))
    from rasterio.warp import transform
    left, top = -50000 + col*500, 50000 - row*500
    # Geographic corners only for Earth locator; Mars retains its own metric CRS.
    corners = None
    if region_id != 'jezero':
        xs, ys = transform(provenance['target_crs'], 'EPSG:4326',
                           [left, left+10000, left+10000, left, left],
                           [top, top, top-10000, top-10000, top])
        corners = list(map(list, zip(xs, ys)))
    return dict(id=identifier, name=name, region_id=region_id, latitude=latitude, longitude=longitude,
                cell_m=500, window_km=10, rows=20, cols=20,
                # Cell centers are 0.25..9.75km. Outer cell edges delimit 10km.
                mesh_span_km=9.5, vertical_reference='window mean = 0 m',
                relative_elevation_m=relative.tolist(), slope_deg=slope.tolist(),
                features=dict(zip(terrain.FEATURES, features.tolist())), corners=corners,
                provenance={**provenance, 'subset_row': row, 'subset_col': col,
                            'subset_transform': [500, 0, left, 0, -500, top]})


def prepare():
    result = json.loads((terrain.DATA / 'results.json').read_text(encoding='utf-8'))
    model = result['model']
    ref = np.array(list(result['reference']['features'].values()))
    scale, components = np.array(model['scale']), np.array(model['components'])
    OUT.mkdir(parents=True, exist_ok=True)
    reference = grid_payload('jezero', 'Jezero · llanura central', 'jezero', 90, 90, result, 18.38, 77.58)
    write('jezero', reference)
    candidates = []
    for identifier, name, region, row, col, country in CANDIDATES:
        record = next(r for r in result['ranking'] if r['region_id'] == region and r['row'] == row and r['col'] == col)
        payload = grid_payload(identifier, name, region, row*20, col*20, result, record['latitude'], record['longitude'])
        values = np.array(list(payload['features'].values()))
        delta = (values-ref)/scale
        component_delta = delta @ components.T
        projected_delta = component_delta @ components
        # Signed additive contributions sum to squared PCA distance. Negative
        # values mean correlated features partly cancel; they are not importance percentages.
        contributions = delta * projected_delta
        payload['comparison'] = dict(pca_distance=float(np.linalg.norm(component_delta)),
                                     baseline_distance=float(np.linalg.norm(delta)),
                                     differences={key: dict(mars=float(ref[i]), earth=float(values[i]),
                                                           delta=float(values[i]-ref[i]), standardized_delta=float(delta[i]),
                                                           pca_squared_contribution=float(contributions[i]))
                                                  for i, key in enumerate(terrain.FEATURES)})
        write(identifier, payload)
        candidates.append(dict(id=identifier, name=name, country=country, region_id=region,
                               latitude=record['latitude'], longitude=record['longitude'],
                               **{k: payload['comparison'][k] for k in ['pca_distance', 'baseline_distance']},
                               features=payload['features']))
    candidates.sort(key=lambda c: c['pca_distance'])
    catalogue = dict(reference=dict(id='jezero', name=reference['name'], latitude=18.38, longitude=77.58),
                     candidates=candidates, evaluation=result['evaluation'],
                     generated_at=result['generated_at'], method=result['method'], notice=result['notice'],
                     selection='Three fixed held-out windows, not the three best of the search. Two Earth source regions.',
                     model=model)
    write('catalogue', catalogue)
    print('Prepared reference +', len(candidates), 'candidates; PCA order:', [c['id'] for c in candidates])


def write(name, payload):
    target = OUT / (name + '.json')
    target.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')


if __name__ == '__main__':
    prepare()
