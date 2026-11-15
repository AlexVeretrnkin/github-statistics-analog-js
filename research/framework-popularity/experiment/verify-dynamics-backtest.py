"""Independent stdlib verification and Ukrainian report for the R backtest.
Usage: python3 verify-dynamics-backtest.py OUTPUT_DIR
"""
import csv
from collections import Counter
import hashlib
import json
import math
import statistics
import sys
from pathlib import Path

out = Path(sys.argv[1])
weight = json.loads((out / 'config.json').read_text())['weight']
assert 0 < weight < 1
read = lambda name: list(csv.DictReader((out / name).open()))
manifest = json.loads((out / 'manifest.json').read_text())
assert manifest['status'] == 'complete' and manifest['fits'] == 1080
for item in manifest['files']:
    assert hashlib.sha256((out / item['path']).read_bytes()).hexdigest() == item['sha256'], item['path']
status = read('fit-status.csv')
assert len(status) == 1080 and all(r['status'] == 'ok' for r in status)
panel = read('paired-observations.csv')
values = {}
for framework in ('React', 'Angular', 'Vue'):
    p = [r for r in panel if r['framework'] == framework]
    base = [r for r in p if '2022-09-01' <= r['date'] <= '2023-08-01']
    assert len(p) == 96 and len(base) == 12
    bd = statistics.mean(float(r['downloads']) for r in base)
    bs = statistics.mean(float(r['stars']) for r in base)
    for r in p:
        values[framework, r['date']] = 100 * (
            ((float(r['downloads']) + 1) / (bd + 1)) ** weight *
            ((float(r['stars']) + 1) / (bs + 1)) ** (1 - weight))
predictions = read('predictions.csv')
assert len(predictions) == 8640
keys = [(r['framework'], r['origin'], r['model'], r['route'], r['horizon']) for r in predictions]
assert len(set(keys)) == len(keys)
for r in predictions:
    f, date, h = r['framework'], r['date'], int(r['horizon'])
    origin_month = int(r['origin'][:4]) * 12 + int(r['origin'][5:7])
    assert int(date[:4]) * 12 + int(date[5:7]) - origin_month == h
    assert math.isclose(float(r['actual']), values[f, date], rel_tol=1e-12)
    assert math.isclose(100 * math.exp(float(r['point_log'])), float(r['point']), rel_tol=1e-12)
    if r['model'] in ('NAIVE', 'SNAIVE'):
        lagdate = r['origin'] if r['model'] == 'NAIVE' else f'{int(date[:4])-1}{date[4:]}'
        assert math.isclose(float(r['point']), values[f, lagdate], rel_tol=1e-12)
scores = read('scores.csv')
assert len(scores) == 120
for s in scores:
    group = [r for r in predictions if all(r[k] == s[k] for k in ('framework','model','route','horizon'))]
    assert len(group) == 24
    errors = [float(r['point']) - float(r['actual']) for r in group]
    expected = {'mae': statistics.mean(abs(e) for e in errors),
                'rmse': math.sqrt(statistics.mean(e*e for e in errors)),
                'wape_pct': 100 * sum(abs(e) for e in errors) / sum(float(r['actual']) for r in group),
                'log_mae': statistics.mean(abs(float(r['point_log'])-float(r['actual_log'])) for r in group)}
    for key, value in expected.items():
        assert math.isclose(value, float(s[key]), rel_tol=1e-11, abs_tol=1e-11)
lines = ['# Rolling-origin перевірка індексу динаміки', '',
    '## Дизайн', '',
    f'Фіксовано геометричний індекс, ваги downloads/stars {weight*100:g}/{(1-weight)*100:g}, c=1 та базу вересень 2022 — серпень 2023. '
    'Спільне навчання від вересня 2018: 61–84 місяці, розширюване вікно. '
    '24 origins від вересня 2023 до серпня 2025 позначають завершені місяці; горизонти 1, 3, 6, 12 місяців. '
    'Оцінювання використовує спостереження до серпня 2026 включно.', '',
    'Прямий підхід прогнозує log(I/100). Компонентний підхід окремо прогнозує логарифми '
    'нормованих downloads і stars, потім зважено усереднює їх і виконує експоненціювання. '
    'На обох компонентах використано ту саму родину моделей; змішані пари моделей не перебиралися.', '',
    'SARIMA: auto.arima, AICc, stepwise, exact likelihood approximation=FALSE, CSS-ML. '
    'ETS: AICc, likelihood, additive.only=TRUE для всіх трьох цілей; це відрізняється від '
    'попереднього експерименту на лічильниках. Prophet: MAP, linear trend, yearly Fourier=10, '
    '25 changepoints у перших 80%, priors 0.05/10; без MCMC. '
    'Також persistence та seasonal naïve. Усього 1080 збережених навчань.', '',
    'Оцінюються точкові прогнози після експоненціювання, без поправки до математичного сподівання '
    'і без обрізання прогнозів компонентів. Інтервали не оцінювалися: потрібна спільна модель '
    'невизначеності компонентів. WAPE та MAE дають однакове ранжування всередині кожної пари '
    'фреймворк/горизонт. Похибки різних фреймворків не об’єднуються.', '',
    '## Найнижча WAPE за кожним горизонтом (описове ex-post порівняння)', '',
    '| Фреймворк | h | Найкращий варіант | WAPE, % | Persistence, % | Seasonal naïve, % |',
    '|---|---:|---|---:|---:|---:|']
winning_routes = Counter()
for f in ('React','Angular','Vue'):
    for h in ('1','3','6','12'):
        cell = [s for s in scores if s['framework']==f and s['horizon']==h]
        best = min(cell, key=lambda s: float(s['wape_pct']))
        winning_routes['baseline' if best['model'] in ('NAIVE', 'SNAIVE') else best['route']] += 1
        tied = [s for s in cell if math.isclose(float(s['wape_pct']),float(best['wape_pct']),abs_tol=1e-9)]
        label = '; '.join(dict.fromkeys(s['model'] + (' (обидва підходи)' if s['model'] in ('NAIVE','SNAIVE') else ' / '+s['route']) for s in tied))
        naive = next(s for s in cell if s['model']=='NAIVE' and s['route']=='direct')
        seasonal = next(s for s in cell if s['model']=='SNAIVE' and s['route']=='direct')
        lines.append(f"| {f} | {h} | {label} | {float(best['wape_pct']):.2f} | {float(naive['wape_pct']):.2f} | {float(seasonal['wape_pct']):.2f} |")
lines += ['', '## Стабільність між origins', '',
    'У таблиці — кількість із 24 origins, де компонентний прогноз мав меншу абсолютну похибку '
    'за прямий прогноз тієї самої родини. Повні різниці середньої та медіанної похибок '
    'збережено в origin-comparison.csv.', '',
    '| Фреймворк | Модель | h=1 | h=3 | h=6 | h=12 |', '|---|---|---:|---:|---:|---:|']
comparison = read('origin-comparison.csv')
assert len(comparison) == 60
for c in comparison:
    group = [r for r in predictions if all(r[k] == c[k] for k in ('framework', 'model', 'horizon'))]
    by_origin = {}
    for r in group:
        by_origin.setdefault(r['origin'], {})[r['route']] = abs(float(r['point']) - float(r['actual']))
    delta = [v['components'] - v['direct'] for v in by_origin.values()]
    assert len(delta) == 24
    assert int(c['components_wins']) == sum(v < -1e-9 for v in delta)
    assert int(c['direct_wins']) == sum(v > 1e-9 for v in delta)
    assert int(c['ties']) == sum(abs(v) <= 1e-9 for v in delta)
    assert math.isclose(float(c['mean_ae_components_minus_direct']), statistics.mean(delta), abs_tol=1e-10)
    assert math.isclose(float(c['median_ae_difference']), statistics.median(delta), abs_tol=1e-10)
for f in ('React','Angular','Vue'):
    for model in ('SARIMA','ETS','PROPHET'):
        counts = [next(r['components_wins'] for r in comparison if r['framework']==f and r['model']==model and r['horizon']==h) for h in ('1','3','6','12')]
        lines.append('| '+ ' | '.join([f,model]+[n+'/24' for n in counts])+' |')
lines += ['', '## Інтерпретація цього запуску', '',
    f'За WAPE найкращі результати отримано компонентним підходом у {winning_routes["components"]} із 12 пар '
    f'фреймворк/горизонт, прямим у {winning_routes["direct"]}, naïve-моделями у {winning_routes["baseline"]}. '
    'На h=12 persistence і seasonal naïve математично збігаються; це не дві '
    'незалежні перемоги. Перевага компонування над прямим Prophet не означає '
    'переваги Prophet над іншими моделями.', '',
    'Отже, результати підтримують дослідження обох стратегій прогнозування, але '
    'не універсальне правило «компонентний підхід завжди кращий». Похибки індексу '
    'не можна безпосередньо порівнювати з похибками сирих downloads чи stars як '
    'доказ покращення: це різні цілі, а агрегація може компенсувати їхні зміни.', '',
    '## Межі висновків та перевірки', '',
    'Переможці визначені після перегляду цих самих origins; це не незалежна перевірка '
    'попередньо відібраної моделі. Горизонти й навчальні вікна перекриваються, тому кількості '
    'виграшів не є незалежними випробуваннями або тестом статистичної значущості. '
    'Заморожений знімок містить ретроспективно відновлену GitHub-історію, а не історичні vintages.', '',
    'Точність прогнозів не доводить валідність індексу як міри використання. Ваги не оптимізувалися. '
    'Для обох naïve-моделей прямий і компонентний підходи збігаються математично; '
    'це перевірено на всіх прогнозах. Незалежна перевірка Python підтвердила 8640 прогнозних '
    'рядків, усі 120 наборів метрик, фактичні цілі, календарні горизонти, naïve-прогнози '
    'та контрольні суми файлів.', '',
    'Файли: scores.csv — усі числові результати; predictions.csv — прогнози та факти; '
    'parameters.csv і fits/*.rds — параметри, специфікації, seeds, повідомлення та об’єкти моделей.']
(out/'REPORT_UK.md').write_text('\n'.join(lines)+'\n')
(out/'verify-dynamics-backtest.py').write_bytes(Path(__file__).read_bytes())
(out/'verification.json').write_text(json.dumps({'status':'passed','predictions':8640,'score_groups':120,'fits':1080},indent=2))
files = sorted(p for p in out.rglob('*') if p.is_file() and p.name != 'manifest.json')
manifest['files'] = [{'path':str(p.relative_to(out)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Independent verification passed; REPORT_UK.md generated.')
