"""Read-only secret audit. Reports file names/categories, never secret values."""
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def git(args, git_dir=None, check=True):
    command = ['git', '-c', 'core.excludesFile=' + os.devnull]
    if git_dir:
        command += ['--git-dir=' + str(git_dir), '--work-tree=' + str(ROOT)]
    result = subprocess.run(command + args, cwd=ROOT, capture_output=True)
    if check and result.returncode:
        raise RuntimeError('Git audit command failed; private output suppressed.')
    return result


def audit(git_dir, real_repository):
    # Learn exact local credentials privately, including accidental local copies.
    credentials = set()
    for path in ROOT.glob('.env*'):
        if not path.is_file():
            continue
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            match = re.match(r'\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*)', line)
            if match and any(word in match[1].upper() for word in ['KEY', 'TOKEN', 'SECRET', 'PASSWORD']):
                value = match[2].strip().strip('\'"')
                if len(value) >= 12 and not any(word in value.lower() for word in ['example', 'reemplazar', 'placeholder', 'test', 'dummy']):
                    credentials.add(value.encode())
    template = ROOT / '.env.example'
    template_valid = True
    for line in template.read_text(encoding='utf-8-sig').splitlines():
        if line.strip() and not line.lstrip().startswith('#'):
            template_valid &= bool(re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*\s*=\s*', line))
    paths = set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], git_dir).stdout.decode().split('\0')) - {''}
    patterns = {
        'private-key': rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
        'provider-token': rb'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sb_secret_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})',
        'jwt': rb'eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}',
    }

    def inspect(content):
        findings = []
        if any(value in content for value in credentials):
            findings.append('matches-local-credential')
        for category, pattern in patterns.items():
            if re.search(pattern, content):
                findings.append(category)
        assignments = re.finditer(rb'''(?i)["']?((?:[a-z_][a-z0-9_]*_)?(?:api_key|key|token|secret|password|service_role_key))["']?\s*[:=]\s*["']([^"'\r\n]{16,})["']''', content)
        for assignment in assignments:
            value = assignment[2].lower()
            if not any(word in value for word in [b'test', b'example', b'reemplazar', b'placeholder', b'dummy', b'fake', b'your_', b'tu-']):
                findings.append('credential-literal-review-required')
                break
        return findings

    findings = []
    for name in sorted(paths):
        path = ROOT / name
        if path.is_file():
            categories = inspect(path.read_bytes())
            if categories:
                findings.append({'file': name, 'categories': categories})
    tracked = set(git(['ls-files', '-z'], git_dir).stdout.decode().split('\0')) - {''}
    tracked_local = [name for name in sorted(tracked) if Path(name).name.startswith('.env') and Path(name).name != '.env.example']
    history_findings = []
    commits = []
    if real_repository:
        commits = git(['rev-list', '--all', '--reflog'], git_dir, check=False).stdout.decode().splitlines()
        seen = set()
        for commit in commits:
            listing = git(['ls-tree', '-rz', commit], git_dir).stdout.split(b'\0')
            for entry in listing:
                if not entry:
                    continue
                metadata, name = entry.split(b'\t', 1)
                mode, kind, oid = metadata.split()
                if kind != b'blob' or oid in seen:
                    continue
                seen.add(oid)
                categories = inspect(git(['cat-file', 'blob', oid.decode()], git_dir).stdout)
                if categories:
                    history_findings.append({'commit': commit[:12], 'file': name.decode(errors='replace'), 'categories': categories})
    local_names = [p.name for p in ROOT.glob('.env*') if p.is_file() and p.name != '.env.example']
    exclusions = {name: git(['check-ignore', '--no-index', '-q', '--', name], git_dir, check=False).returncode == 0 for name in local_names}
    exclusion_checks = {name: git(['check-ignore', '--no-index', '-q', '--', name], git_dir, check=False).returncode == 0
                        for name in ['.env.production', '.env copy.example', 'config/.env.local', 'private.pem', 'credentials.json', 'artifacts/local-server.log']}
    report = {'real_repository': real_repository, 'candidate_files': len(paths), 'template_empty': template_valid,
              'local_env_excluded': exclusions, 'tracked_local_env_files': tracked_local,
              'exclusion_checks': exclusion_checks, 'template_included': '.env.example' in paths,
              'candidate_findings': findings, 'commits_checked': len(commits), 'history_findings': history_findings,
              'ready': template_valid and '.env.example' in paths and all(exclusions.values()) and all(exclusion_checks.values()) and not tracked_local and not findings and not history_findings}
    (ROOT / 'artifacts').mkdir(exist_ok=True)
    (ROOT / 'artifacts' / 'secret-audit.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return report['ready']


if __name__ == '__main__':
    repository = git(['rev-parse', '--git-dir'], check=False)
    if repository.returncode == 0:
        directory = Path(repository.stdout.decode().strip())
        if not directory.is_absolute():
            directory = ROOT / directory
        ready = audit(directory, True)
    else:
        # Apply Git's own ignore rules without initializing the user's workspace.
        with tempfile.TemporaryDirectory(prefix='analog-secret-audit-') as temporary:
            temporary_path = Path(temporary).resolve()
            assert temporary_path.parent == Path(tempfile.gettempdir()).resolve()
            subprocess.run(['git', 'init', '--quiet', str(temporary_path)], check=True, capture_output=True)
            ready = audit(temporary_path / '.git', False)
    raise SystemExit(0 if ready else 1)
