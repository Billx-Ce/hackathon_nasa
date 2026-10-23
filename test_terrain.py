"""Numerical contracts and integrity checks; synthetic surfaces are tests only."""
import hashlib
import json
import unittest
from pathlib import Path

try:
    import numpy as np
except ImportError:
    raise unittest.SkipTest('Instala requirements-terrain.txt para las pruebas numéricas.')

import terrain


class TerrainTests(unittest.TestCase):
    def test_plane_has_expected_slope_and_no_roughness(self):
        y, x = np.indices((20, 20))
        plane = 100 + .1 * x * 500 + .2 * y * 500
        values = terrain.descriptors(plane)
        self.assertAlmostEqual(values[2], np.degrees(np.arctan(np.hypot(.1, .2))))
        self.assertAlmostEqual(values[4], 0)
        self.assertAlmostEqual(values[5], 0)
        self.assertAlmostEqual(values[6], 0)

    def test_absolute_altitude_and_orientation_do_not_define_similarity(self):
        z = np.random.default_rng(42).normal(0, 50, (20, 20))
        np.testing.assert_allclose(terrain.descriptors(z), terrain.descriptors(z + 9000), atol=1e-10)
        np.testing.assert_allclose(terrain.descriptors(z), terrain.descriptors(np.rot90(z)), atol=1e-10)

    def test_scale_controls_slope(self):
        z = np.tile(np.arange(20), (20, 1)) * 500
        self.assertAlmostEqual(terrain.descriptors(z, 500)[2], 45)
        self.assertAlmostEqual(terrain.descriptors(z, 1000)[2], np.degrees(np.arctan(.5)))

    def test_invalid_grids_rejected(self):
        for z, cell in [(np.zeros((2, 2)), 500), (np.full((20, 20), np.nan), 500),
                        (np.full((20, 20), np.inf), 500), (np.zeros((20, 20)), 0)]:
            with self.assertRaises(ValueError):
                terrain.descriptors(z, cell)

    def test_pca_orthonormal_and_retains_required_variance(self):
        x = np.random.default_rng(13).normal(size=(50, 7))
        x[:, 6] = x[:, 0] * 2
        mean, scale, components, variance = terrain.fit_pca(x)
        np.testing.assert_allclose(mean, x.mean(axis=0))
        np.testing.assert_allclose(scale, x.std(axis=0))
        np.testing.assert_allclose(components @ components.T, np.eye(len(components)), atol=1e-12)
        self.assertGreaterEqual(variance[:len(components)].sum()/variance.sum(), .95)
        with self.assertRaises(ValueError):
            terrain.fit_pca(np.ones((20, 7)))

    def test_real_artifact_integrity_and_reproducible_distances(self):
        result_path = terrain.DATA / 'results.json'
        if not result_path.exists():
            self.skipTest('No se han adquirido los DEM reales.')
        result = json.loads(result_path.read_text(encoding='utf-8'))
        for name, manifest in result['provenance'].items():
            path = terrain.DATA / (name + '.npz')
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), manifest['sha256'])
        with np.load(terrain.DATA / 'jezero.npz', allow_pickle=False) as data:
            reference = terrain.descriptors(data['elevation_m'][90:110, 90:110])
        np.testing.assert_allclose(reference, list(result['reference']['features'].values()))
        model = result['model']
        scale, components = np.array(model['scale']), np.array(model['components'])
        previous = -1
        for record in result['ranking']:
            self.assertGreaterEqual(record['col'], 6)  # training ends at col 4, buffer col 5
            values = np.array(list(record['features'].values()))
            self.assertAlmostEqual(record['baseline_distance'], np.linalg.norm((values-reference)/scale))
            self.assertAlmostEqual(record['pca_distance'], np.linalg.norm(((values-reference)/scale) @ components.T))
            self.assertGreaterEqual(record['pca_distance'], previous)
            previous = record['pca_distance']
        self.assertIsNone(result['evaluation']['scientific_accuracy'])

    def test_viewer_uses_exact_scientific_subsets_and_additive_explanation(self):
        directory = terrain.ROOT / 'data' / 'viewer'
        catalogue = json.loads((directory / 'catalogue.json').read_text(encoding='utf-8'))
        self.assertEqual(len(catalogue['candidates']), 3)
        for candidate in catalogue['candidates']:
            grid = json.loads((directory / (candidate['id'] + '.json')).read_text(encoding='utf-8'))
            p = grid['provenance']
            with np.load(terrain.DATA / (grid['region_id'] + '.npz'), allow_pickle=False) as data:
                row, col = p['subset_row'], p['subset_col']
                z = data['elevation_m'][row:row+20, col:col+20].astype(float)
            self.assertGreaterEqual(col, 120)  # outside training + buffer
            self.assertTrue(np.all(z > 0))
            np.testing.assert_allclose(grid['relative_elevation_m'], z-z.mean(), atol=1e-9)
            np.testing.assert_allclose(list(grid['features'].values()), terrain.descriptors(z))
            self.assertAlmostEqual(np.mean(grid['relative_elevation_m']), 0)
            comparison = grid['comparison']
            contributions = sum(d['pca_squared_contribution'] for d in comparison['differences'].values())
            self.assertAlmostEqual(contributions, comparison['pca_distance']**2)
            self.assertAlmostEqual(candidate['pca_distance'], comparison['pca_distance'])


if __name__ == '__main__':
    unittest.main()
