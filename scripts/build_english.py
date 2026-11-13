"""Build the English interface from the shared Spanish UI and translation catalogue.

Run after editing shared UI assets; generated files are committed for deployment.
Only presentation files are translated. Scientific JSON and API field names stay intact.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build():
    translations = json.loads((ROOT / 'static/translations.en.json').read_text(encoding='utf-8'))
    target = ROOT / 'static/en'
    target.mkdir(exist_ok=True)
    for name in ['index.html', 'catalogue.html', 'app.js', 'experience.js', 'telemetry.js', 'viewers.js', 'catalogue.js']:
        source = (ROOT / 'static' / name).read_text(encoding='utf-8')
        # Longest first prevents short labels from changing longer sentences.
        pattern = '|'.join(re.escape(key) for key in sorted(translations, key=len, reverse=True))
        source = re.sub(pattern, lambda match: translations[match[0]], source)
        source = source.replace("'es-PE'", "'en-US'")
        if name.endswith('.html'):
            source = source.replace('lang="es"', 'lang="en"')
            for asset in ['app.js', 'catalogue.js']:
                source = source.replace('/static/' + asset, '/static/en/' + asset)
            source = source.replace('href="/catalogue', 'href="/catalogue?lang=en')
            source = source.replace('href="/"', 'href="/?lang=en"').replace('href="/#', 'href="/?lang=en#')
        source = source.replace("'/catalogue#", "'/catalogue?lang=en#")
        source = source.replace('`/?candidate=', '`/?lang=en&candidate=')
        if name in ('app.js', 'catalogue.js'):
            source = "import {translateData} from '/static/translate-data.js';\n" + source
            source = source.replace('await response.json()', 'translateData(await response.json())')
            source = source.replace('return response.json();', 'return translateData(await response.json());')
        (target / name).write_text(source, encoding='utf-8')
    print('Built English interface and catalogue.')


if __name__ == '__main__':
    build()
