"""Validate staged deployment files in a fresh LF checkout, without secrets."""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(args, cwd=ROOT, **kwargs):
    return subprocess.run(args, cwd=cwd, check=True, **kwargs)


if __name__ == '__main__':
    # A staged tree includes the proposed fix without creating a commit or
    # touching the user's branch. checkout-index exports tracked files only.
    with tempfile.TemporaryDirectory(prefix='analog-render-check-') as directory:
        target = Path(directory).resolve()
        assert target.parent == Path(tempfile.gettempdir()).resolve()
        # First export staged blobs with LF checkout behavior, like Linux Render.
        run(['git', '-c', 'core.autocrlf=false', 'checkout-index', '--all', '--prefix=' + target.as_posix() + '/'])
        if any(p.name.startswith('.env') and p.name != '.env.example' for p in target.rglob('*')):
            raise RuntimeError('Local environment file in staged export; private contents suppressed.')
        run([sys.executable, 'scripts/check_assets.py'], cwd=target)
        # Repeat using a standalone Git repo so the second checkout resolves
        # attributes from its own committed tree, not the developer worktree.
        run(['git', 'init', '--quiet'], cwd=target)
        run(['git', '-c', 'core.autocrlf=false', 'add', '--all'], cwd=target)
        run(['git', '-c', 'user.name=Local validation', '-c', 'user.email=validation@example.invalid',
             '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Temporary deployment validation'], cwd=target)
        clean = target / 'clean'
        run(['git', 'clone', '--quiet', '--no-hardlinks', '--no-checkout', str(target), str(clean)])
        run(['git', '-c', 'core.autocrlf=false', 'checkout', '--quiet', 'HEAD'], cwd=clean)
        run([sys.executable, 'scripts/check_assets.py'], cwd=clean)
        env = os.environ.copy()
        for key in ('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DEVICE_TOKEN'):
            env.pop(key, None)
        run([sys.executable, '-m', 'unittest', '-q'], cwd=clean, env=env)
        print('PASS: staged export and independent clean Git checkout with autocrlf=false; no local .env exported.')
