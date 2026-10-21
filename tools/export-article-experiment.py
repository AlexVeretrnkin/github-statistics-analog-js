"""Export verified saved experiment results for the app; never refit models or query a DB."""
import csv
import hashlib
import io
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'output/article-experiment-2026-10-18'
target = root / 'public/research/article-experiment'
manifest = json.loads((source / 'result-manifest.json').read_text())
config_bytes = (source / 'config.json').read_bytes()
assert hashlib.sha256(config_bytes).hexdigest() == manifest['config_sha256'], 'Config checksum mismatch'
config = json.loads(config_bytes)
status = json.loads((source / 'status.json').read_text())
assert status['status'] == 'complete' and status['failed_fits'] == 0
inventory = {x['path']: x for x in manifest['files']}
used = []

def read(name):
    data = (source / name).read_bytes()
    assert hashlib.sha256(data).hexdigest() == inventory[name]['sha256'], f'Checksum mismatch: {name}'
    used.append({'file': name, 'sha256': inventory[name]['sha256']})
    rows = list(csv.DictReader(io.StringIO(data.decode())))
    for row in rows:
        for key, value in row.items():
            if value == '': row[key] = None
            elif value in ['TRUE', 'FALSE']: row[key] = value == 'TRUE'
            else:
                try: row[key] = float(value) if any(c in value for c in '.eE') else int(value)
                except ValueError: pass
    return rows

accuracy = read('accuracy.csv')
frequency = read('ex-post-winner-frequency.csv')
metadata = read('metadata.csv')
parameters = read('parameters.csv')
diagnostics = read('diagnostics.csv')
residuals = read('residuals.csv')
acf = read('acf.csv')
preparation = read('preparation.csv')
history = read('model-inputs.csv')
predictions = read('predictions.csv')
assert len(accuracy) == 120 and all(x['n_origins'] == 24 for x in accuracy)
models = config['models']
series = []
for prep in preparation:
    sid = prep['series_id']
    full = lambda rows: [x for x in rows if x['series_id'] == sid and x.get('phase') == 'full']
    # The archive labels final-history fits as 'full'; reject unknown phase labels.
    fits = full(metadata)
    assert len(fits) == 5, (sid, [x['phase'] for x in metadata if x['series_id'] == sid])
    observed = [x for x in history if x['series_id'] == sid]
    series.append({
        'id': sid, 'metric': observed[0]['metric'], 'framework': observed[0]['framework'],
        'preparation': prep,
        'history': [{'date': x['date'], 'value': x['value']} for x in observed],
        'accuracy': [x for x in accuracy if x['series_id'] == sid],
        'stability': [{'horizon': h, 'model': model,
                       'wins': next((x['tie_weight'] for x in frequency if x['series_id'] == sid and x['horizon'] == h and x['model'] == model), 0)}
                      for h in config['horizons'] for model in models],
        'fits': fits, 'parameters': full(parameters), 'diagnostics': full(diagnostics),
        'residuals': full(residuals), 'acf': full(acf),
        'outlook': full(predictions),
        'backtest': [x for x in predictions if x['series_id'] == sid and x['phase'] == 'backtest' and x['horizon'] in config['horizons']],
    })
assert len(series) == 6
# Series identity is already carried by the parent; avoid repeating it per residual/forecast.
for item in series:
    for key in ['accuracy', 'fits', 'parameters', 'diagnostics', 'residuals', 'acf', 'outlook', 'backtest']:
        item[key] = [{k: v for k, v in row.items() if k not in
                      ['job_id', 'series_id', 'metric', 'framework', 'phase', 'train_start', 'n_train', 'seed']
                      or (key == 'fits' and k in ['train_start', 'n_train', 'seed'])}
                     for row in item[key]]

target.mkdir(parents=True, exist_ok=True)
# Keep full precision in the downloadable tables and numeric JSON.
for name in ['accuracy.csv', 'ex-post-winner-frequency.csv', 'config.json', 'preparation.csv']:
    (target / name).write_bytes((source / name).read_bytes())
for name, rows in [('full-history-parameters.csv', [x for x in parameters if x['phase'] == 'full']),
                   ('full-history-diagnostics.csv', [x for x in diagnostics if x['phase'] == 'full'])]:
    with (target / name).open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys()); writer.writeheader(); writer.writerows(rows)
result = {'id': 'article-experiment-2026-10-18', 'config': config, 'status': status,
          'sourceFiles': used, 'series': series}
(target / 'results.json').write_text(json.dumps(result, separators=(',', ':'), allow_nan=False) + '\n')
(target / 'README.md').write_text('Frozen article experiment through August 2026, exported from the verified local Compose PostgreSQL snapshot dated 2026-09-29. Regenerate with python3 tools/export-article-experiment.py. results.json contains full-history fits/parameters/diagnostics/residuals and scored rolling-origin forecasts; no refitting occurs in the browser. An independent DOI-backed archive remains pending. The complete fitted RDS objects remain in the experiment archive, not in this web payload. Source-file SHA-256 checksums are included in results.json.\n')
print(f'Exported {len(series)} series / {len(accuracy)} accuracy rows; {(target / "results.json").stat().st_size:,} JSON bytes')
