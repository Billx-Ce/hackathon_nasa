"""Analog Explorer: contexto terrestre, IoT simulado y experimento de relieve."""
import asyncio
import json
import os
import secrets
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env', encoding='utf-8-sig')
app = FastAPI(title='Analog Explorer', version='0.2.0')
app.mount('/static', StaticFiles(directory=ROOT / 'static'), name='static')
TERRAIN_RESULT = ROOT / 'data' / 'terrain' / 'results.json'
VIEWER_DIR = ROOT / 'data' / 'viewer'


def read_artifact(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        raise HTTPException(503, 'Datos de relieve no disponibles. Ejecuta prepare_viewer.py.')

# Áreas propuestas para estudiar. No se presentan como análogos demostrados.
SITES = [
    dict(id='la-joya', name='La Joya, Perú', latitude=-16.5, longitude=-71.9),
    dict(id='pampas-la-joya', name='Pampas al sur de La Joya, Perú', latitude=-16.7, longitude=-71.9),
    dict(id='atacama-control', name='Atacama, Chile · referencia documentada', latitude=-24.1, longitude=-69.9),
]
try:
    SITES += [{k: candidate[k] for k in ('id', 'name', 'latitude', 'longitude')}
              for candidate in read_artifact(VIEWER_DIR / 'catalogue.json')['candidates']]
except HTTPException:
    pass  # Legacy climate / IoT still works if the prepared viewer is absent.
SITE_IDS = {s['id'] for s in SITES}
cache = {}
power_lock = asyncio.Lock()
demo_readings = []


def supabase_config():
    url = os.getenv('SUPABASE_URL', '').rstrip('/')
    key = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
    if bool(url) != bool(key):
        raise HTTPException(503, 'Configuración de Supabase incompleta.')
    return url, key


@app.get('/')
def home():
    return FileResponse(ROOT / 'static' / 'index.html', headers={'Cache-Control': 'no-store'})


@app.get('/catalogue')
def readable_catalogue():
    return FileResponse(ROOT / 'static' / 'catalogue.html', headers={'Cache-Control': 'no-store'})


@app.middleware('http')
async def fresh_application_state(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith('/api/') or request.url.path in {'/static/app.js', '/static/viewers.js', '/static/experience.js', '/static/telemetry.js', '/static/catalogue.js', '/static/style.css'}:
        response.headers['Cache-Control'] = 'no-store'
    return response


@app.get('/api/health')
def health():
    url, key = supabase_config()
    return {'status': 'ok', 'target': 'Mars', 'storage': 'supabase' if url and key else 'temporary-memory',
            'terrain_model': 'offline-exploratory-pca' if TERRAIN_RESULT.exists() else 'pending-real-elevation-data', 'device_configured': bool(os.getenv('DEVICE_TOKEN'))}


@app.get('/api/sites')
def sites():
    return {'sites': SITES, 'status': 'candidates-not-validated',
            'mars_reference': {'name': 'Jezero · región exploratoria', 'latitude': 18.38, 'longitude': 77.58}}


@app.get('/api/terrains')
def terrain_catalogue():
    return read_artifact(VIEWER_DIR / 'catalogue.json')


@app.get('/api/terrains/{terrain_id}')
def terrain_grid(terrain_id: str):
    catalogue = terrain_catalogue()
    allowed = {'jezero', *(candidate['id'] for candidate in catalogue['candidates'])}
    if terrain_id not in allowed:
        raise HTTPException(404, 'Terreno desconocido.')
    return read_artifact(VIEWER_DIR / (terrain_id + '.json'))


@app.get('/api/storage/status')
async def storage_status():
    url, key = supabase_config()
    if not url:
        return {'storage': 'temporary-memory', 'connected': False, 'message': 'Supabase sin configurar. Historial temporal.'}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(url + '/rest/v1/telemetry', params={'select': 'id', 'limit': 0},
                                        headers={'apikey': key, 'Authorization': f'Bearer {key}'})
            response.raise_for_status()
        return {'storage': 'supabase', 'connected': True, 'message': 'Tabla de Supabase accesible. Escritura pendiente de verificar con una lectura.'}
    except httpx.HTTPError:
        raise HTTPException(502, 'Supabase configurado, pero no se pudo consultar la tabla de telemetría.')


@app.get('/api/terrain')
def terrain_results():
    """Serve a computed artifact; requests never train a model or fabricate a fallback."""
    try:
        return json.loads(TERRAIN_RESULT.read_text(encoding='utf-8'))
    except FileNotFoundError:
        raise HTTPException(503, 'Aún no hay resultados. Ejecuta la adquisición y el análisis de relieve.')
    except (OSError, ValueError):
        raise HTTPException(503, 'El artefacto de relieve no se puede leer. Regenera el análisis.')


def climate_limits():
    return {'min_date': '1981-01-01', 'max_date': (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat(),
            'max_days': 366, 'time_standard': 'UTC',
            'notice': 'Fechas históricas. La disponibilidad más reciente depende de NASA POWER.'}


@app.get('/api/climate-limits')
def supported_climate_period():
    return climate_limits()


@app.get('/api/climate/{site_id}')
async def climate(site_id: str, start: str = Query('2024-01-01', pattern=r'^\d{4}-\d{2}-\d{2}$'), end: str = Query('2024-01-07', pattern=r'^\d{4}-\d{2}-\d{2}$')):
    site = next((s for s in SITES if s['id'] == site_id), None)
    if not site:
        raise HTTPException(404, 'Sitio desconocido.')
    try:
        start, end = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError:
        raise HTTPException(422, 'Introduce fechas de calendario válidas con el formato AAAA-MM-DD.')
    limits = climate_limits()
    if start > end:
        raise HTTPException(422, 'La fecha inicial no puede ser posterior a la fecha final.')
    if start < date.fromisoformat(limits['min_date']) or end > date.fromisoformat(limits['max_date']) or (end - start).days >= limits['max_days']:
        raise HTTPException(422, f"Usa fechas entre {limits['min_date']} y {limits['max_date']}, con un máximo de 366 días inclusive. Verifica el año completo.")
    cache_key = (site_id, start.isoformat(), end.isoformat())
    async with power_lock:
        if cache_key in cache and time.monotonic() - cache[cache_key][0] < 86400:
            return cache[cache_key][1]
        params = dict(parameters='T2M,RH2M', community='AG', latitude=site['latitude'],
                      longitude=site['longitude'], start=start.strftime('%Y%m%d'),
                      end=end.strftime('%Y%m%d'), format='JSON', **{'time-standard': 'UTC'})
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                response = await client.get('https://power.larc.nasa.gov/api/temporal/daily/point', params=params)
                response.raise_for_status()
                raw = response.json()
            data = raw['properties']['parameter']
            missing = raw.get('header', {}).get('fill_value', -999)
            def clean(value):
                return None if value is None or value == missing else value
            rows = [{'date': datetime.strptime(day, '%Y%m%d').date().isoformat(),
                     'temperature_c': clean(data['T2M'][day]),
                     'humidity_pct': clean(data.get('RH2M', {}).get(day))} for day in sorted(data['T2M'])]
        except (httpx.HTTPError, KeyError, ValueError, TypeError):
            raise HTTPException(502, 'NASA POWER no está disponible o devolvió datos inesperados. Intenta más tarde.')
        result = {'site': site, 'source': 'NASA POWER', 'source_url': str(response.url),
                  'time_standard': 'UTC', 'kind': 'earth-historical-daily',
                  'retrieved_at': datetime.now(timezone.utc).isoformat(), 'readings': rows,
                  'notice': 'Contexto terrestre. No representa clima de Marte ni datos IoT.'}
        if len(cache) >= 64:
            cache.pop(next(iter(cache)))
        cache[cache_key] = (time.monotonic(), result)
        return result


class Reading(BaseModel):
    station_id: str = Field(min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')
    site_id: str
    temperature_c: float = Field(ge=-40, le=80, allow_inf_nan=False)
    humidity_pct: float = Field(ge=0, le=100, allow_inf_nan=False)


@app.post('/api/telemetry', status_code=201)
async def receive(reading: Reading, x_device_token: str = Header(default='')):
    token = os.getenv('DEVICE_TOKEN', '')
    if not token:
        raise HTTPException(503, 'Configura DEVICE_TOKEN en el servidor antes de conectar Wokwi.')
    if not secrets.compare_digest(token, x_device_token):
        raise HTTPException(401, 'Token de dispositivo incorrecto.')
    if reading.site_id not in SITE_IDS:
        raise HTTPException(422, 'Sitio desconocido.')
    row = {**reading.model_dump(), 'simulated': True, 'received_at': datetime.now(timezone.utc).isoformat()}
    url, key = supabase_config()
    if url:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post(url + '/rest/v1/telemetry', json=row,
                    headers={'apikey': key, 'Authorization': f'Bearer {key}', 'Prefer': 'return=minimal'})
                response.raise_for_status()
        except httpx.HTTPError:
            raise HTTPException(502, 'No se pudo guardar en Supabase. No se confirmó la lectura.')
    else:
        demo_readings.append(row)
        del demo_readings[:-500]
    return {'saved': True, 'storage': 'supabase' if url else 'temporary-memory', 'reading': row}


@app.get('/api/telemetry')
async def telemetry(site_id: str = 'la-joya'):
    if site_id not in SITE_IDS:
        raise HTTPException(422, 'Sitio desconocido.')
    url, key = supabase_config()
    if not url:
        history = [r for r in demo_readings if r['site_id'] == site_id]
        return telemetry_result('temporary-memory', history[-100:], history)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(url + '/rest/v1/telemetry',
                params={'site_id': f'eq.{site_id}', 'select': '*', 'order': 'received_at.desc', 'limit': 100},
                headers={'apikey': key, 'Authorization': f'Bearer {key}'})
            response.raise_for_status()
            readings = list(reversed(response.json()))
            # Scan lightweight metadata so a quiet station is not hidden by
            # another station's 100 newest readings. No generated replacements.
            metadata = []
            offset = 0
            while True:
                page = await client.get(url + '/rest/v1/telemetry',
                    params={'site_id': f'eq.{site_id}', 'select': 'station_id,received_at',
                            'order': 'received_at.desc,id.desc', 'offset': offset, 'limit': 1000},
                    headers={'apikey': key, 'Authorization': f'Bearer {key}'})
                page.raise_for_status()
                batch = page.json()
                metadata.extend(batch)
                if len(batch) < 1000:
                    break
                offset += len(batch)
        return telemetry_result('supabase', readings, metadata)
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        raise HTTPException(502, 'No se pudo consultar Supabase.')


def telemetry_result(storage, readings, metadata, now=None):
    now = now or datetime.now(timezone.utc)
    latest = {}
    for row in metadata:
        timestamp = datetime.fromisoformat(row['received_at'].replace('Z', '+00:00'))
        if timestamp.tzinfo is None or timestamp > now:
            raise ValueError('Hora de recepción inválida.')
        station = row['station_id']
        latest[station] = max(latest.get(station, timestamp), timestamp)
    stations = []
    for station, timestamp in sorted(latest.items()):
        age = (now-timestamp).total_seconds()
        stations.append({'station_id': station, 'last_received_at': timestamp.astimezone(timezone.utc).isoformat(),
                         'elapsed_seconds': age, 'state': 'receiving' if age < 60 else 'stale'})
    return {'storage': storage,
            'connection_state': 'unconfigured' if storage != 'supabase' else ('connected-with-readings' if readings else 'connected-empty'),
            'server_time': now.isoformat(), 'expected_interval_seconds': 10, 'stale_after_seconds': 60,
            'stations': stations, 'readings': readings}
