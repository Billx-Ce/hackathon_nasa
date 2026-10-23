import os
import unittest
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient
import main


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {'SUPABASE_URL': '', 'SUPABASE_SERVICE_ROLE_KEY': '', 'DEVICE_TOKEN': 'test-device-token'})
        self.environment.start()
        main.cache.clear()
        main.demo_readings.clear()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        self.environment.stop()

    def test_simulated_measurement_roundtrip_and_auth(self):
        payload = dict(station_id='wokwi-01', site_id='la-joya', temperature_c=24, humidity_pct=45)
        self.assertEqual(self.client.post('/api/telemetry', json=payload).status_code, 401)
        accepted = self.client.post('/api/telemetry', json=payload, headers={'X-Device-Token': 'test-device-token'})
        self.assertEqual(accepted.status_code, 201)
        self.assertTrue(accepted.json()['reading']['simulated'])
        self.assertEqual(len(self.client.get('/api/telemetry').json()['readings']), 1)
        self.assertEqual(len(self.client.get('/api/telemetry?site_id=atacama-control').json()['readings']), 0)

    def test_invalid_sensor_reading_rejected(self):
        payload = dict(station_id='wokwi-01', site_id='la-joya', temperature_c=24, humidity_pct=120)
        self.assertEqual(self.client.post('/api/telemetry', json=payload, headers={'X-Device-Token': 'test-device-token'}).status_code, 422)

    def test_power_provenance_missing_values_and_cache(self):
        raw = {'header': {'fill_value': -999}, 'properties': {'parameter': {
            'T2M': {'20240101': 21, '20240102': -999}, 'RH2M': {'20240101': 45, '20240102': 40}}}}
        response = httpx.Response(200, json=raw, request=httpx.Request('GET', 'https://power.larc.nasa.gov/example'))
        fake = AsyncMock()
        fake.__aenter__.return_value = fake
        fake.get.return_value = response
        with patch.object(main.httpx, 'AsyncClient', return_value=fake):
            result = self.client.get('/api/climate/la-joya').json()
            self.assertEqual(result['source'], 'NASA POWER')
            self.assertEqual(result['kind'], 'earth-historical-daily')
            self.assertIsNone(result['readings'][1]['temperature_c'])
            self.client.get('/api/climate/la-joya')
            self.assertEqual(fake.get.await_count, 1)

    def test_power_network_failure_is_not_fake_data(self):
        fake = AsyncMock()
        fake.__aenter__.return_value = fake
        fake.get.side_effect = httpx.ConnectError('offline')
        with patch.object(main.httpx, 'AsyncClient', return_value=fake):
            self.assertEqual(self.client.get('/api/climate/la-joya').status_code, 502)

    def test_date_validation(self):
        self.assertEqual(self.client.get('/api/climate/la-joya?start=2024-02-01&end=2024-01-01').status_code, 422)
        self.assertEqual(self.client.get('/api/climate/la-joya?start=2020-01-01&end=2024-01-01').status_code, 422)

    def test_station_reception_threshold_utc_and_independent_ages(self):
        from datetime import datetime, timezone
        now = datetime(2026, 10, 23, 12, 0, tzinfo=timezone.utc)
        metadata = [dict(station_id='a', received_at='2026-10-23T11:59:01Z'),
                    dict(station_id='a', received_at='2026-10-23T11:58:00Z'),
                    dict(station_id='b', received_at='2026-10-23T06:59:00-05:00')]
        result = main.telemetry_result('supabase', [], metadata, now)
        self.assertEqual(result['stations'][0]['state'], 'receiving')
        self.assertEqual(result['stations'][0]['elapsed_seconds'], 59)
        self.assertEqual(result['stations'][1]['state'], 'stale')
        self.assertEqual(result['stations'][1]['elapsed_seconds'], 60)
        self.assertTrue(result['stations'][1]['last_received_at'].endswith('+00:00'))
        self.assertEqual(main.telemetry_result('supabase', [], [], now)['stations'], [])

    def test_quiet_station_not_lost_outside_history_window(self):
        fake = AsyncMock()
        fake.__aenter__.return_value = fake
        def response(rows):
            return httpx.Response(200, json=rows, request=httpx.Request('GET', 'https://example.supabase.co/rest/v1/telemetry'))
        latest = dict(station_id='active', received_at='2024-01-01T00:00:00Z')
        old = dict(station_id='quiet', received_at='2023-01-01T00:00:00Z')
        fake.get.side_effect = [response([latest]), response([latest]*1000), response([old])]
        with patch.dict(os.environ, {'SUPABASE_URL': 'https://example.supabase.co', 'SUPABASE_SERVICE_ROLE_KEY': 'test'}), patch.object(main.httpx, 'AsyncClient', return_value=fake):
            result = self.client.get('/api/telemetry').json()
        self.assertEqual({s['station_id'] for s in result['stations']}, {'active', 'quiet'})
        self.assertEqual(fake.get.call_args.kwargs['params']['offset'], 1000)

    def test_climate_limits_and_ambiguous_year_rejected_before_network(self):
        from datetime import datetime, timedelta, timezone
        limits = self.client.get('/api/climate-limits')
        self.assertEqual(limits.status_code, 200)
        self.assertEqual(limits.json()['min_date'], '1981-01-01')
        self.assertEqual(limits.json()['max_days'], 366)
        self.assertEqual(limits.json()['max_date'], (datetime.now(timezone.utc).date()-timedelta(days=1)).isoformat())
        invalid = [('0025-01-01', '0025-01-07'), ('1980-12-31', '1981-01-01'),
                   ('2024-02-30', '2024-03-01'), ('2024-01-07', '2024-01-01'),
                   ('2024-01-01', '2025-01-01'), ('2024-01-01', '9999-01-01'), ('', '2024-01-07'),
                   ('1704067200', '2024-01-07'), ('2024-01-01T00:00:00Z', '2024-01-07')]
        with patch.object(main.httpx, 'AsyncClient') as remote:
            for start, end in invalid:
                with self.subTest(start=start, end=end):
                    self.assertEqual(self.client.get('/api/climate/la-joya', params={'start': start, 'end': end}).status_code, 422)
            remote.assert_not_called()

    def test_366_days_inclusive_supported(self):
        raw = {'properties': {'parameter': {'T2M': {'20240101': 21}, 'RH2M': {'20240101': 45}}}}
        fake = AsyncMock()
        fake.__aenter__.return_value = fake
        fake.get.return_value = httpx.Response(200, json=raw, request=httpx.Request('GET', 'https://power.larc.nasa.gov/example'))
        with patch.object(main.httpx, 'AsyncClient', return_value=fake):
            self.assertEqual(self.client.get('/api/climate/la-joya?start=2024-01-01&end=2024-12-31').status_code, 200)

    def test_readable_catalogue_and_fresh_api_responses(self):
        response = self.client.get('/catalogue')
        self.assertEqual(response.status_code, 200)
        self.assertIn('text/html', response.headers['content-type'])
        self.assertIn('Qué aprende PCA', response.text)
        self.assertEqual(self.client.get('/api/health').headers['cache-control'], 'no-store')
        self.assertEqual(self.client.get('/static/app.js').headers['cache-control'], 'no-store')

    def test_terrain_missing_or_invalid_artifact_returns_no_fake_ranking(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'results.json'
            with patch.object(main, 'TERRAIN_RESULT', path):
                self.assertEqual(self.client.get('/api/terrain').status_code, 503)
                path.write_text('broken', encoding='utf-8')
                self.assertEqual(self.client.get('/api/terrain').status_code, 503)

    def test_real_terrain_endpoint(self):
        if not main.TERRAIN_RESULT.exists():
            self.skipTest('DEM reales todavía no adquiridos.')
        response = self.client.get('/api/terrain')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'exploratory-real-dem')
        self.assertIsNone(response.json()['evaluation']['scientific_accuracy'])
        self.assertEqual(self.client.get('/api/sites').json()['mars_reference']['name'], 'Jezero · región exploratoria')

    def test_viewer_catalogue_grids_and_missing_data(self):
        catalogue = self.client.get('/api/terrains').json()
        self.assertEqual(len(catalogue['candidates']), 3)
        self.assertEqual(len({c['id'] for c in catalogue['candidates']}), 3)
        for terrain_id in ['jezero', *[c['id'] for c in catalogue['candidates']]]:
            response = self.client.get('/api/terrains/' + terrain_id)
            self.assertEqual(response.status_code, 200)
            grid = response.json()
            self.assertEqual(len(grid['relative_elevation_m']), 20)
            self.assertEqual(grid['cell_m'], 500)
        self.assertEqual(self.client.get('/api/terrains/unknown').status_code, 404)
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(main, 'VIEWER_DIR', Path(directory)):
                self.assertEqual(self.client.get('/api/terrains').status_code, 503)

    def test_candidate_telemetry_preserves_simulated_flag(self):
        payload = dict(station_id='wokwi-01', site_id='atacama-central', temperature_c=21, humidity_pct=33)
        response = self.client.post('/api/telemetry', json=payload, headers={'X-Device-Token': 'test-device-token'})
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()['reading']['simulated'])
        self.assertEqual(len(self.client.get('/api/telemetry?site_id=atacama-central').json()['readings']), 1)

    def test_supabase_successful_write_read_and_connection_probe(self):
        fake = AsyncMock()
        fake.__aenter__.return_value = fake
        fake.post.return_value = httpx.Response(201, request=httpx.Request('POST', 'https://example.supabase.co/rest/v1/telemetry'))
        fake.get.return_value = httpx.Response(200, json=[], request=httpx.Request('GET', 'https://example.supabase.co/rest/v1/telemetry'))
        with patch.dict(os.environ, {'SUPABASE_URL': 'https://example.supabase.co', 'SUPABASE_SERVICE_ROLE_KEY': 'server-only-test-key'}), patch.object(main.httpx, 'AsyncClient', return_value=fake):
            response = self.client.post('/api/telemetry', json=dict(station_id='wokwi-01', site_id='atacama-central', temperature_c=21, humidity_pct=33), headers={'X-Device-Token': 'test-device-token'})
            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.json()['storage'], 'supabase')
            self.assertTrue(fake.post.call_args.kwargs['json']['simulated'])
            self.assertEqual(fake.post.call_args.kwargs['headers']['apikey'], 'server-only-test-key')
            self.assertEqual(main.demo_readings, [])
            history = self.client.get('/api/telemetry?site_id=atacama-central')
            self.assertEqual(history.json()['readings'], [])
            self.assertEqual(fake.get.call_args.kwargs['params']['site_id'], 'eq.atacama-central')
            probe = self.client.get('/api/storage/status')
            self.assertTrue(probe.json()['connected'])
            self.assertNotIn('server-only-test-key', probe.text)

    def test_storage_status_does_not_claim_unverified_connection(self):
        self.assertFalse(self.client.get('/api/storage/status').json()['connected'])
        with patch.dict(os.environ, {'SUPABASE_URL': 'https://example.supabase.co'}):
            self.assertEqual(self.client.get('/api/storage/status').status_code, 503)
        fake = AsyncMock()
        fake.__aenter__.return_value = fake
        fake.get.side_effect = httpx.ConnectError('offline')
        with patch.dict(os.environ, {'SUPABASE_URL': 'https://example.supabase.co', 'SUPABASE_SERVICE_ROLE_KEY': 'test'}), patch.object(main.httpx, 'AsyncClient', return_value=fake):
            self.assertEqual(self.client.get('/api/storage/status').status_code, 502)

    def test_storage_failure_does_not_confirm_save(self):
        fake = AsyncMock()
        fake.__aenter__.return_value = fake
        fake.post.side_effect = httpx.ConnectError('offline')
        with patch.dict(os.environ, {'SUPABASE_URL': 'https://example.supabase.co', 'SUPABASE_SERVICE_ROLE_KEY': 'test'}), patch.object(main.httpx, 'AsyncClient', return_value=fake):
            result = self.client.post('/api/telemetry', json=dict(station_id='wokwi-01', site_id='la-joya', temperature_c=24, humidity_pct=45), headers={'X-Device-Token': 'test-device-token'})
            self.assertEqual(result.status_code, 502)
            self.assertEqual(main.demo_readings, [])


if __name__ == '__main__':
    unittest.main()
