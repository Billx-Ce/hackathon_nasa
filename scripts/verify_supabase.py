"""Live simulated write/read check through FastAPI; never prints credentials."""
import json
import os
import secrets
import socket
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import dotenv_values, set_key

ROOT = Path(__file__).resolve().parents[1]
RECEIPT = ROOT / 'artifacts' / 'supabase-check.json'
SERVER = None
STAGE = 'configuration'


def verify():
    global SERVER, STAGE
    settings = dotenv_values(ROOT / '.env', encoding='utf-8-sig')
    if not all(settings.get(key, '').strip() for key in ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']):
        raise RuntimeError('Falta configuración de Supabase en .env; no se usará memoria temporal.')
    token = settings.get('DEVICE_TOKEN', '')
    if not token or not token.strip():
        token = secrets.token_urlsafe(32)
        set_key(str(ROOT / '.env'), 'DEVICE_TOKEN', token, encoding='utf-8-sig')
        settings['DEVICE_TOKEN'] = token
        print('DEVICE_TOKEN generado y guardado localmente; valor oculto.')
    # Restart only uvicorn main:app processes from this exact workspace.
    try:
        import psutil
        for existing in psutil.process_iter(['cmdline', 'cwd']):
            args = existing.info['cmdline'] or []
            cwd = existing.info['cwd']
            if cwd and Path(cwd).resolve() == ROOT and 'uvicorn' in args and 'main:app' in args:
                existing.terminate()
                existing.wait(timeout=5)
    except (ImportError, OSError):
        pass
    # Dedicated port avoids altering unrelated processes using port 8000.
    port = 8000
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1', port)) == 0:
            port = 8001
    env = os.environ.copy()
    env.update({k: v for k, v in settings.items() if v is not None})
    RECEIPT.parent.mkdir(parents=True, exist_ok=True)
    log = open(RECEIPT.parent / 'local-server.log', 'ab')
    process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', str(port)],
                               cwd=ROOT, env=env, stdout=log, stderr=log,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    SERVER = process
    base = f'http://127.0.0.1:{port}'
    with httpx.Client(base_url=base, timeout=45, trust_env=False) as client:
        for _ in range(60):
            if process.poll() is not None:
                raise RuntimeError('El servidor local no pudo iniciarse. Revisa artifacts/local-server.log.')
            try:
                health = client.get('/api/health')
                if health.status_code == 200:
                    break
            except httpx.TransportError:
                pass
            time.sleep(.25)
        else:
            raise RuntimeError('El servidor no respondió a tiempo.')
        if health.json().get('storage') != 'supabase':
            raise RuntimeError('El servidor no cargó Supabase. Prueba detenida sin escribir.')
        status = client.get('/api/storage/status')
        if status.status_code != 200 or not status.json().get('connected'):
            raise RuntimeError(f'Falló la comprobación de Supabase mediante el servidor (HTTP {status.status_code}); no se envió una medición ni se usó memoria temporal.')
        print('Conexión del servidor a la tabla telemetry verificada.')
        sites = client.get('/api/sites').json()['sites']
        site_id = 'atacama-central'
        if site_id not in {s['id'] for s in sites}:
            raise RuntimeError('El site_id de prueba no está disponible.')
        receipt = json.loads(RECEIPT.read_text(encoding='utf-8')) if RECEIPT.exists() else {}
        station_id = receipt.get('station_id') or 'supabase-check-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:6]
        payload = dict(station_id=station_id, site_id=site_id, temperature_c=24.5, humidity_pct=45.0)
        receipt.update(station_id=station_id, site_id=site_id, base_url=base, server_pid=process.pid, verified=False)
        RECEIPT.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
        url = settings['SUPABASE_URL'].rstrip('/') + '/rest/v1/telemetry'
        key = settings['SUPABASE_SERVICE_ROLE_KEY']
        with httpx.Client(timeout=30, headers={'apikey': key, 'Authorization': 'Bearer ' + key}) as remote:
            params = {'station_id': 'eq.' + station_id, 'select': 'id,station_id,site_id,temperature_c,humidity_pct,simulated,received_at'}
            STAGE = 'direct-read-before-write'
            previous = remote.get(url, params=params)
            if previous.status_code != 200:
                raise RuntimeError(f'No se pudo consultar la tabla antes de escribir (HTTP {previous.status_code}).')
            if not previous.json():
                STAGE = 'write-through-local-server'
                saved = client.post('/api/telemetry', json=payload, headers={'X-Device-Token': token})
                if saved.status_code != 201 or saved.json().get('storage') != 'supabase' or saved.json().get('reading', {}).get('simulated') is not True:
                    raise RuntimeError(f'El servidor no confirmó una escritura simulada en Supabase (HTTP {saved.status_code}).')
            STAGE = 'read-through-local-server'
            history = client.get('/api/telemetry', params={'site_id': site_id})
            if history.status_code != 200 or history.json().get('storage') != 'supabase':
                raise RuntimeError('No se pudo leer el historial desde Supabase mediante el servidor.')
            matches = [r for r in history.json()['readings'] if r.get('station_id') == station_id]
            STAGE = 'direct-read-after-write'
            direct = remote.get(url, params=params)
            if direct.status_code != 200:
                raise RuntimeError(f'Falló la lectura directa de verificación (HTTP {direct.status_code}).')
            rows = direct.json()
            if len(rows) != 1 or len(matches) != 1 or rows[0].get('simulated') is not True or any(rows[0].get(k) != v for k, v in payload.items()):
                raise RuntimeError('La medición recuperada no coincide exactamente con la enviada.')
            receipt.update(verified=True, row_id=rows[0]['id'], simulated=True, received_at=rows[0]['received_at'], verified_at=datetime.now(timezone.utc).isoformat())
            RECEIPT.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
            print(json.dumps({k: receipt[k] for k in ['verified', 'station_id', 'site_id', 'row_id', 'simulated', 'received_at', 'base_url']}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        verify()
    except (RuntimeError, httpx.HTTPError) as error:
        if SERVER is not None:
            SERVER.terminate()
        # HTTP exception strings may contain private URLs; do not print them.
        print(str(error) if isinstance(error, RuntimeError) else f'Fallo de red ({type(error).__name__}) en etapa {STAGE}; detalles sensibles ocultos.')
        sys.exit(1)
