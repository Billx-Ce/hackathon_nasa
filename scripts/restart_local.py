"""Restart this workspace's local Uvicorn server without printing .env values."""
import os
import subprocess
import sys
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]

if __name__ == '__main__':
    import psutil
    for process in psutil.process_iter(['cmdline', 'cwd']):
        try:
            args = process.info['cmdline'] or []
            cwd = process.info['cwd']
            if cwd and Path(cwd).resolve() == ROOT and 'uvicorn' in args and 'main:app' in args:
                process.terminate()
                process.wait(timeout=5)
        except (psutil.Error, OSError):
            continue
    environment = os.environ.copy()
    environment.update({key: value for key, value in dotenv_values(ROOT / '.env', encoding='utf-8-sig').items() if value is not None})
    (ROOT / 'artifacts').mkdir(exist_ok=True)
    with open(ROOT / 'artifacts' / 'local-server.log', 'ab') as log:
        server = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000'],
                                  cwd=ROOT, env=environment, stdout=log, stderr=log,
                                  creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    print(f'Servidor local reiniciado (PID {server.pid}); variables cargadas sin mostrarlas.')
