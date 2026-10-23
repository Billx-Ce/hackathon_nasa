"""Offline, reproducible regional terrain experiment. Never consumes POWER or IoT."""
import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data' / 'terrain'
MOLA = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif'
REGIONS = [
    dict(id='jezero', name='Jezero · región exploratoria', body='Mars', latitude=18.38, longitude=77.58),
    dict(id='la-joya', name='Región de La Joya', body='Earth', latitude=-16.5, longitude=-71.9),
    dict(id='atacama-control', name='Región de Atacama', body='Earth', latitude=-24.1, longitude=-69.9),
]
CELL = 500
SIZE = 200
PATCH = 20
FEATURES = ['relief_p95_p05_m', 'elevation_std_m', 'slope_mean_deg',
            'slope_p90_deg', 'slope_std_deg', 'laplacian_rms_m', 'detrended_rms_m']


def descriptors(z, cell=CELL):
    """Interior central differences; absolute planetary altitude is excluded."""
    z = np.asarray(z, dtype=float)
    if z.ndim != 2 or min(z.shape) < 5 or not np.isfinite(z).all() or cell <= 0:
        raise ValueError('Ventana incompleta, no finita o escala inválida.')
    z = z - z.mean()
    dx = (z[1:-1, 2:] - z[1:-1, :-2]) / (2 * cell)
    dy = (z[2:, 1:-1] - z[:-2, 1:-1]) / (2 * cell)
    slope = np.degrees(np.arctan(np.hypot(dx, dy)))
    lap = z[1:-1, 2:] + z[1:-1, :-2] + z[2:, 1:-1] + z[:-2, 1:-1] - 4*z[1:-1, 1:-1]
    y, x = np.indices(z.shape)
    design = np.column_stack([x.ravel(), y.ravel(), np.ones(z.size)])
    residual = z.ravel() - design @ np.linalg.lstsq(design, z.ravel(), rcond=None)[0]
    return np.array([np.percentile(z, 95)-np.percentile(z, 5), z.std(), slope.mean(),
                     np.percentile(slope, 90), slope.std(), np.sqrt(np.mean(lap**2)),
                     np.sqrt(np.mean(residual**2))])


def acquire():
    """Read MOLA ranges and Earth tiles; average onto local metric AEQD grids."""
    import httpx
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.merge import merge
    from rasterio.transform import from_origin
    from rasterio.vrt import WarpedVRT
    from rasterio.warp import transform_bounds, reproject
    DATA.mkdir(parents=True, exist_ok=True)
    for region in REGIONS:
        lat, lon = region['latitude'], region['longitude']
        shape = (SIZE, SIZE)
        dst_transform = from_origin(-50000, 50000, CELL, CELL)
        sphere = '+R=3396190' if region['body'] == 'Mars' else '+datum=WGS84'
        crs = f'+proj=aeqd +lat_0={lat} +lon_0={lon} {sphere} +units=m +no_defs'
        sources = []
        out = np.full(shape, np.nan, dtype='float32')
        if region['body'] == 'Mars':
            with rasterio.open(MOLA) as src:
                with WarpedVRT(src, crs=crs, transform=dst_transform, width=SIZE, height=SIZE,
                               resampling=Resampling.average, dtype='float32', nodata=float('nan')) as vrt:
                    out = vrt.read(1)
                source_crs, native_resolution = src.crs.to_wkt(), list(src.res)
            sources.append(dict(url=MOLA, product='MGS MOLA global DEM 463m', vertical_datum='Mars areoid'))
        else:
            bounds = transform_bounds(crs, 'EPSG:4326', -50000, -50000, 50000, 50000, densify_pts=41)
            tiles = []
            with httpx.Client(timeout=120, follow_redirects=True) as client:
                for south in range(math.floor(bounds[1]), math.floor(bounds[3])+1):
                    for west in range(math.floor(bounds[0]), math.floor(bounds[2])+1):
                        name = f'{"N" if south >= 0 else "S"}{abs(south):02d}{"E" if west >= 0 else "W"}{abs(west):03d}'
                        url = f'https://elevation-tiles-prod.s3.amazonaws.com/skadi/{name[:3]}/{name}.hgt.gz'
                        path = DATA / (name + '.hgt.gz')
                        if not path.exists():
                            response = client.get(url)
                            response.raise_for_status()
                            path.write_bytes(response.content)
                        sources.append(dict(url=url, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                                            product='Mapzen Skadi (global source mosaic)', vertical_datum='WGS84/EGM96 geoid'))
                        tiles.append(rasterio.open('/vsigzip/' + str(path.resolve()).replace('\\', '/')))
            try:
                mosaic, transform = merge(tiles, bounds=bounds, nodata=-32768)
                reproject(mosaic[0], out, src_transform=transform, src_crs=tiles[0].crs,
                          src_nodata=-32768, dst_transform=dst_transform, dst_crs=crs,
                          dst_nodata=float('nan'), resampling=Resampling.average)
                source_crs, native_resolution = tiles[0].crs.to_wkt(), list(tiles[0].res)
            finally:
                for tile in tiles:
                    tile.close()
        if not np.isfinite(out).all():
            raise ValueError(f'{region["id"]}: datos faltantes; no se interpolan silenciosamente.')
        path = DATA / (region['id'] + '.npz')
        np.savez_compressed(path, elevation_m=out)
        manifest = dict(region=region, retrieved_at=datetime.now(timezone.utc).isoformat(), sources=sources,
                        source_crs=source_crs, native_resolution=native_resolution,
                        native_resolution_unit='m at equator' if region['body'] == 'Mars' else 'degree',
                        target_crs=crs, transform=list(dst_transform)[:6], cell_m=CELL, shape=list(shape),
                        resampling='GDAL average', missing_fraction=float((~np.isfinite(out)).mean()),
                        sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        (DATA / (region['id'] + '.json')).write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        print('Acquired', region['id'], float(out.min()), float(out.max()), flush=True)


def fit_pca(x):
    mean, scale = x.mean(axis=0), x.std(axis=0)
    scale = np.where(scale < 1e-10, 1, scale)
    standardized = (x-mean)/scale
    _, singular, vectors = np.linalg.svd(standardized, full_matrices=False)
    variance = singular**2 / max(1, len(x)-1)
    if variance.sum() <= 0:
        raise ValueError('No existe variación para entrenar PCA.')
    count = int(np.searchsorted(np.cumsum(variance)/variance.sum(), .95)+1)
    return mean, scale, vectors[:count], variance


def analyze():
    manifests, arrays = {}, {}
    for region in REGIONS:
        name = region['id']
        manifest = json.loads((DATA / (name + '.json')).read_text(encoding='utf-8'))
        path = DATA / (name + '.npz')
        if manifest['sha256'] != hashlib.sha256(path.read_bytes()).hexdigest():
            raise ValueError('Checksum incorrecto: ' + name)
        if manifest['cell_m'] != CELL or manifest['shape'] != [SIZE, SIZE]:
            raise ValueError('Escala incompatible: ' + name)
        manifests[name] = manifest
        with np.load(path, allow_pickle=False) as data:
            arrays[name] = data['elevation_m'].copy()
    train, train_groups, test, records, excluded = [], [], [], [], []
    # Spatial holdout: western 50km training, 10km buffer, eastern 40km evaluation.
    # La Joya and its southern pampas share one regional crop, never independent groups.
    for region in REGIONS[1:]:
        z = arrays[region['id']]
        for row in range(10):
            for col in range(10):
                patch = z[row*PATCH:(row+1)*PATCH, col*PATCH:(col+1)*PATCH]
                if np.min(patch) <= 0:
                    excluded.append(dict(region_id=region['id'], row=row, col=col,
                                         reason='Contains elevation <= 0 m; conservative ocean/coast exclusion, not a land mask'))
                    continue
                values = descriptors(patch)
                if col < 5:
                    train.append(values)
                    train_groups.append(region['id'])
                elif col >= 6:
                    test.append(values)
                    records.append(dict(region_id=region['id'], row=row, col=col,
                                        center_east_m=-50000+(col+.5)*10000,
                                        center_north_m=50000-(row+.5)*10000,
                                        features=dict(zip(FEATURES, values.tolist()))))
    train, test = np.array(train), np.array(test)
    if len(train) < 20 or len(test) < 10:
        raise ValueError('Insuficientes ventanas válidas para el experimento.')
    reference = descriptors(arrays['jezero'][90:110, 90:110])
    mean, scale, components, variance = fit_pca(train)
    test_z, ref_z = (test-mean)/scale, (reference-mean)/scale
    projected, ref_projected = test_z @ components.T, ref_z @ components.T
    base = np.linalg.norm(test_z-ref_z, axis=1)
    learned = np.linalg.norm(projected-ref_projected, axis=1)
    base_order, order = np.argsort(base), np.argsort(learned)
    for i, record in enumerate(records):
        record.update(pca_distance=float(learned[i]), baseline_distance=float(base[i]))
    reconstruction = projected @ components
    base_ranks, learned_ranks = np.argsort(base_order), np.argsort(order)
    from rasterio.warp import transform
    for record in records:
        longitude, latitude = transform(manifests[record['region_id']]['target_crs'], 'EPSG:4326',
                                        [record['center_east_m']], [record['center_north_m']])
        record.update(latitude=latitude[0], longitude=longitude[0])
    stability = []
    for group in sorted(set(train_groups)):
        subset = train[np.array(train_groups) == group]
        gmean, gscale, gcomponents, _ = fit_pca(subset)
        distances = np.linalg.norm(((test-reference)/gscale) @ gcomponents.T, axis=1)
        stability.append(dict(training_region=group, training_windows=len(subset),
                              top5_overlap_with_pooled=len(set(np.argsort(distances)[:5]) & set(order[:5]))/5))
    evaluation = dict(training_windows=len(train), heldout_windows=len(test), buffer_km=10,
                      pca_components=len(components), explained_training_variance=float(variance[:len(components)].sum()/variance.sum()),
                      heldout_reconstruction_rmse_standardized=float(np.sqrt(np.mean((test_z-reconstruction)**2))),
                      rank_correlation_with_baseline=float(np.corrcoef(base_ranks, learned_ranks)[0, 1]),
                      top5_overlap_with_baseline=len(set(order[:5]) & set(base_order[:5]))/5,
                      reference_outside_training_range=[FEATURES[i] for i in range(len(FEATURES)) if reference[i] < train[:, i].min() or reference[i] > train[:, i].max()],
                      scientific_accuracy=None,
                      train_on_single_region_sensitivity=stability,
                      interpretation='Evaluación interna de compresión y acuerdo con la base. No mide validez de análogos.')
    result = dict(status='exploratory-real-dem', generated_at=datetime.now(timezone.utc).isoformat(),
                  method='StandardScaler + PCA (95% training variance) + Euclidean retrieval; no whitening',
                  reference=dict(region=REGIONS[0], window_km=10, features=dict(zip(FEATURES, reference.tolist()))),
                  grid=dict(cell_m=CELL, region_km=100, window_km=10), provenance=manifests,
                  evaluation=evaluation, ranking=[records[i] for i in order],
                  baseline_ranking=[records[i] for i in base_order],
                  excluded_windows=excluded,
                  model=dict(feature_names=FEATURES, mean=mean.tolist(), scale=scale.tolist(), components=components.tolist()),
                  notice='Menor distancia indica parecido en siete descriptores a esta escala. No es porcentaje, probabilidad, equivalencia geológica ni aptitud para una base.')
    target = DATA / 'results.json'
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    temporary.replace(target)
    print(json.dumps(evaluation, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['acquire', 'analyze'])
    args = parser.parse_args()
    acquire() if args.command == 'acquire' else analyze()
