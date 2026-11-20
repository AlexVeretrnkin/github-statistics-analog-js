"""Check compiled article links against the app presets (no network requests).

Usage: python3 tools/verify-article-pdf-links.py ARTICLE_SOURCE_DIR [REPORT.json]
Requires Poppler's pdfinfo and Node with TypeScript stripping support.
This verifies destinations and parameters, not browser rendering or deployment.
"""
import json
from pathlib import Path
import subprocess
import sys
from urllib.parse import parse_qsl, urlparse

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
presets = json.loads(subprocess.check_output([
    'node', '--experimental-strip-types', '--input-type=module', '-e',
    "import {articleResultLinks} from './src/app/core/article-result-links.ts'; "
    'console.log(JSON.stringify(articleResultLinks));',
], cwd=root, text=True))
experiment = json.loads((root / 'public/research/article-experiment/results.json').read_text())


def state(fragment, params):
    return fragment, tuple(sorted(params))


expected = {state(p['fragment'], p['queryParams'].items()) for p in presets.values()}
for series in experiment['series']:
    expected.add(state('residuals', {
        'experiment': experiment['id'], 'series': series['id'], 'model': 'all',
    }.items()))

links = []
actual = set()
for name in ['manuscript', 'supplement-residuals']:
    output = subprocess.check_output(['pdfinfo', '-url', str(source / (name + '.pdf'))], text=True)
    for line in output.splitlines()[1:]:
        page, kind, uri = line.split(None, 2)
        if '/framework-popularity?' not in uri:
            continue
        url = urlparse(uri)
        assert url.scheme == 'https' and url.netloc == 'github-statistics-analog-js-1097704636754.europe-west1.run.app', uri
        assert url.path == '/framework-popularity', uri
        target = state(url.fragment, parse_qsl(url.query))
        assert target in expected, f'Unexpected PDF destination: {uri}'
        actual.add(target)
        links.append({'pdf': name, 'page': int(page), 'url': uri})

assert actual == expected, f'Missing PDF destinations: {expected - actual}'
assert len(links) == 41, f'Expected one link for each of 41 tables/figures; found {len(links)}'
assert sum(urlparse(r['url']).fragment == 'residuals' for r in links) == 7
if len(sys.argv) > 2:
    report = Path(sys.argv[2])
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(links, indent=2) + '\n')
print(f'Checked {len(links)} PDF links, {len(actual)} unique states; all 7 residual links select three models.')
