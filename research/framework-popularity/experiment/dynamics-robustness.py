"""Descriptive sensitivity of completed weighted index backtests.
Usage: python3 dynamics-robustness.py NEW_OUTPUT RUN25 RUN50 RUN75
Only evaluation subsets change; no observations are removed from training.
"""
import csv
import hashlib
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

out = Path(sys.argv[1])
assert not out.exists(), 'Choose a new output directory'
runs = [Path(p) for p in sys.argv[2:]]
assert len(runs) == 3
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
read = lambda p: list(csv.DictReader(p.open()))
data, provenance = [], []
weights = []
for run in runs:
    m = json.loads((run / 'manifest.json').read_text())
    assert m['status'] == 'complete'
    for f in m['files']:
        assert sha(run / f['path']) == f['sha256'], (run, f['path'])
    cfg = json.loads((run / 'config.json').read_text())
    weights.append(cfg['weight'])
    assert cfg['offset'] == 1 and cfg['base'] == ['2022-09-01', '2023-08-01']
    assert sha(run/'paired-observations.csv') == sha(runs[0]/'paired-observations.csv')
    provenance.append({'path': str(run.resolve()), 'weight': cfg['weight'], 'manifest_sha256': sha(run/'manifest.json')})
    for r in read(run/'predictions.csv'):
        r.update(weight=cfg['weight'], horizon=int(r['horizon']))
        for k in ('actual','point','actual_log','point_log'):
            r[k] = float(r[k])
        if r['horizon'] in (1,3,6,12):
            data.append(r)
assert sorted(weights) == [.25,.5,.75] and len(data) == 8640
panel = read(runs[0]/'paired-observations.csv')
# Rule depends on observed component changes, not weights, predictions, or errors.
shock = {}
for f in ('React','Angular','Vue'):
    p = sorted((r for r in panel if r['framework']==f), key=lambda r:r['date'])
    for prev, cur in zip(p,p[1:]):
        g = [math.log1p(float(cur[k]))-math.log1p(float(prev[k])) for k in ('downloads','stars')]
        shock[f,cur['date']] = (max(map(abs,g)), *g)
mask, mask_rows = {}, []
for f in ('React','Angular','Vue'):
    for h in (1,3,6,12):
        dates = sorted({r['date'] for r in data if r['framework']==f and r['horizon']==h})
        assert len(dates)==24
        selected = sorted(dates,key=lambda t:(-shock[f,t][0],t))[:3]
        mask[f,h] = set(selected)
        for rank,t in enumerate(selected,1):
            score,gd,gs = shock[f,t]
            mask_rows.append(dict(framework=f,horizon=h,date=t,rank=rank,shock_score=score,
                                  downloads_mom_pct=100*math.expm1(gd),stars_mom_pct=100*math.expm1(gs)))
origins = sorted({r['origin'] for r in data}); assert len(origins)==24
scopes = {'all':24,'early':12,'late':12,'without_top3_changes':21}
groups = defaultdict(list)
for r in data:
    base = (r['weight'],r['framework'],r['horizon'],r['model'],r['route'])
    groups[base+('all',)].append(r)
    groups[base+('early' if r['origin'] in origins[:12] else 'late',)].append(r)
    if r['date'] not in mask[r['framework'],r['horizon']]:
        groups[base+('without_top3_changes',)].append(r)
scores = []
for (w,f,h,m,route,scope),g in sorted(groups.items()):
    assert len(g)==scopes[scope]
    errors=[abs(r['actual']-r['point']) for r in g]
    scores.append(dict(weight=w,framework=f,horizon=h,model=m,route=route,scope=scope,n=len(g),
        mae=statistics.mean(errors),rmse=math.sqrt(statistics.mean(e*e for e in errors)),
        wape_pct=100*sum(errors)/sum(r['actual'] for r in g),
        log_mae=statistics.mean(abs(r['actual_log']-r['point_log']) for r in g)))
assert len(scores)==1440
cells=defaultdict(list)
for r in scores:
    cells[r['weight'],r['framework'],r['horizon'],r['scope']].append(r)
winners=[]; wins={}
label=lambda r:r['model'] if r['model'] in ('NAIVE','SNAIVE') else r['model']+'/'+r['route']
for key,g in sorted(cells.items()):
    w,f,h,scope=key
    best=min(r['wape_pct'] for r in g)
    tied=[r for r in g if math.isclose(r['wape_pct'],best,rel_tol=0,abs_tol=1e-9)]
    names=sorted(set(map(label,tied)))
    wins[key]=set(names)
    naive=next(r for r in g if r['model']=='NAIVE' and r['route']=='direct')
    seasonal=next(r for r in g if r['model']=='SNAIVE' and r['route']=='direct')
    cats={('baseline' if r['model'] in ('NAIVE','SNAIVE') else r['route']) for r in tied}
    winners.append(dict(weight=w,framework=f,horizon=h,scope=scope,winners='; '.join(names),
        category='; '.join(sorted(cats)),best_wape_pct=best,naive_wape_pct=naive['wape_pct'],
        snaive_wape_pct=seasonal['wape_pct'],improvement_vs_naive_pct=100*(1-best/naive['wape_pct'])))
    for r in g:
        r['improvement_vs_naive_pct']=100*(1-r['mae']/naive['mae'])
        r['improvement_vs_snaive_pct']=100*(1-r['mae']/seasonal['mae'])
# Error concentration on both fixed change-selected dates and model-specific largest errors.
concentration=[]
for (w,f,h,m,route,scope),g in sorted(groups.items()):
    if scope!='all':continue
    ae=[abs(r['actual']-r['point']) for r in g]; total=sum(ae)
    selected=sum(e for r,e in zip(g,ae) if r['date'] in mask[f,h])
    concentration.append(dict(weight=w,framework=f,horizon=h,model=m,route=route,
        top3_changes_ae_share_pct=100*selected/total if total else 0,
        top3_errors_ae_share_pct=100*sum(sorted(ae,reverse=True)[:3])/total if total else 0))
# Paired route differences within each period/subset, without independence assumptions.
paired=[]
for w,f,h,scope in sorted(cells):
    for m in ('SARIMA','ETS','PROPHET','NAIVE','SNAIVE'):
        a=sorted(groups[w,f,h,m,'direct',scope],key=lambda r:r['origin'])
        b=sorted(groups[w,f,h,m,'components',scope],key=lambda r:r['origin'])
        assert [r['origin'] for r in a]==[r['origin'] for r in b]
        delta=[abs(y['point']-y['actual'])-abs(x['point']-x['actual']) for x,y in zip(a,b)]
        if m in ('NAIVE','SNAIVE'): assert max(map(abs,delta))<1e-9
        paired.append(dict(weight=w,framework=f,horizon=h,scope=scope,model=m,n=len(a),
            components_wins=sum(e< -1e-9 for e in delta),ties=sum(abs(e)<=1e-9 for e in delta),
            direct_wins=sum(e>1e-9 for e in delta),mean_ae_components_minus_direct=statistics.mean(delta)))
# Check new all-origin scoring against each independently verified source result.
for run in runs:
    w=json.loads((run/'config.json').read_text())['weight']
    for r in read(run/'scores.csv'):
        s=next(s for s in cells[w,r['framework'],int(r['horizon']),'all'] if s['model']==r['model'] and s['route']==r['route'])
        for metric in ('mae','rmse','wape_pct','log_mae'): assert math.isclose(s[metric],float(r[metric]),rel_tol=1e-11,abs_tol=1e-11)
out.mkdir(parents=True)
def write(name,rows):
    with (out/name).open('w') as fp:
        writer=csv.DictWriter(fp,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
write('scores-by-subset.csv',scores);write('winners.csv',winners);write('largest-component-changes.csv',mask_rows)
write('error-concentration.csv',concentration);write('paired-route-comparison.csv',paired)
summary=[]
for w in sorted(weights):
    for scope in scopes:
        count=Counter(r['category'] for r in winners if r['weight']==w and r['scope']==scope)
        summary.append(dict(weight=w,scope=scope,components=count['components'],direct=count['direct'],baseline=count['baseline'],mixed_ties=sum(n for k,n in count.items() if ';' in k)))
write('winner-counts.csv',summary)
# Keep the full-sample 50/50 winner fixed to distinguish rank flips from large gaps.
transfer=[]
for f in ('React','Angular','Vue'):
    for h in (1,3,6,12):
        reference=min(cells[.5,f,h,'all'],key=lambda r:r['wape_pct'])
        for w in sorted(weights):
            for scope in scopes:
                g=cells[w,f,h,scope]
                fixed=next(r for r in g if r['model']==reference['model'] and r['route']==reference['route'])
                best=min(r['wape_pct'] for r in g)
                transfer.append(dict(weight=w,framework=f,horizon=h,scope=scope,
                    reference_model=reference['model'],reference_route=reference['route'],
                    reference_wape_pct=fixed['wape_pct'],best_wape_pct=best,
                    gap_to_best_pp=max(0,fixed['wape_pct']-best),
                    reference_improvement_vs_naive_pct=fixed['improvement_vs_naive_pct']))
write('fixed-reference-model.csv',transfer)
lines=['# Стійкість прогнозування індексу динаміки','',
'## Протокол','',
'Три ваги downloads/stars: 25/75, 50/50, 75/25. Усі інші налаштування фіксовані. '
'Компонентні моделі не залежать від ваг і повторно використані після перевірки контрольних сум та коду фіту. '
'Для двох нових ваг виконано 720 нових прямих навчань. Кожен сценарій має 1080 об’єктів моделей. '
'Ранні origins: вересень 2023 — серпень 2024; пізні: вересень 2024 — серпень 2025. '
'У кожній половині 12 origins. Це описове розбиття; цільові місяці довгих горизонтів і навчальні вікна перекриваються.','',
'Для кожної пари фреймворк/горизонт обрано три з 24 цільових місяців із найбільшим '
'max(|Δlog(1+downloads)|, |Δlog(1+stars)|) проти попереднього місяця. '
'Це правило не залежить від похибок, ваг чи моделі; вибір зроблено ретроспективно за спостереженнями. '
'Окремий підрахунок без цих трьох місяців містить 21 origin. Навчальні дані й прогнози не змінюються. '
'Місяці з великими змінами не оголошуються помилками даних. '
'Окремо виміряно частку абсолютної похибки на цих датах та частку трьох найбільших похибок кожної моделі.','',
'## Кількість найкращих результатів за WAPE (12 пар фреймворк/горизонт)','',
'| Вага downloads | Період/підмножина | Компонентний | Прямий | Naïve |',
'|---|---|---:|---:|---:|']
for r in summary:lines.append(f"| {r['weight']:.2f} | {r['scope']} | {r['components']} | {r['direct']} | {r['baseline']} |")
lines+=['','## Переможці на всіх 24 origins','','| Фреймворк | h | w=0.25 | w=0.50 | w=0.75 |','|---|---:|---|---|---|']
for f in ('React','Angular','Vue'):
    for h in (1,3,6,12):lines.append('| '+' | '.join([f,str(h)]+['; '.join(sorted(wins[w,f,h,'all'])) for w in sorted(weights)])+' |')
lines+=['','## Ранні та пізні origins, основна вага 50/50','','| Фреймворк | h | Ранні | Пізні |','|---|---:|---|---|']
for f in ('React','Angular','Vue'):
    for h in (1,3,6,12):lines.append('| '+' | '.join([f,str(h)]+['; '.join(sorted(wins[.5,f,h,scope])) for scope in ('early','late')])+' |')
lines+=['','## Зміни переможців та вплив великих змін компонентів','']
for w in sorted(weights):
    changed=sum(wins[w,f,h,'all']!=wins[.5,f,h,'all'] for f in ('React','Angular','Vue') for h in (1,3,6,12))
    periods=sum(wins[w,f,h,'early']!=wins[w,f,h,'late'] for f in ('React','Angular','Vue') for h in (1,3,6,12))
    trimmed=sum(wins[w,f,h,'all']!=wins[w,f,h,'without_top3_changes'] for f in ('React','Angular','Vue') for h in (1,3,6,12))
    lines.append(f'- w={w:g}: набір переможців відрізняється від w=0.5 у {changed}/12 пар; між ранніми й пізніми origins — у {periods}/12; після виключення трьох найбільших змін зі скорингу — у {trimmed}/12.')
lines+=['','Перевірка величини відмінностей: якщо зберегти модель/підхід, що мав найменшу WAPE '
        'при 50/50 на всіх origins, його відставання від найкращого варіанта в кожному новому '
        'сценарії наведено у fixed-reference-model.csv. Це описова діагностика, не перевірка '
        'моделі, відібраної до оцінювання. Різниця WAPE нижче вимірюється у відсоткових пунктах.','',
        '| Вага downloads | Сценарій | Медіана відставання, в.п. | Найбільше відставання, в.п. |',
        '|---|---|---:|---:|']
for w in sorted(weights):
    for scope in scopes:
        gap=[r['gap_to_best_pp'] for r in transfer if r['weight']==w and r['scope']==scope]
        lines.append(f'| {w:g} | {scope} | {statistics.median(gap):.2f} | {max(gap):.2f} |')
lines+=['','Для переможців основного сценарію 50/50:','','| Фреймворк | h | Модель/підхід | Частка AE на 3 великих змінах, % | WAPE усі | WAPE без 3 дат |','|---|---:|---|---:|---:|---:|']
for f in ('React','Angular','Vue'):
    for h in (1,3,6,12):
        r=min(cells[.5,f,h,'all'],key=lambda r:r['wape_pct'])
        c=next(c for c in concentration if c['weight']==.5 and c['framework']==f and c['horizon']==h and c['model']==r['model'] and c['route']==r['route'])
        t=next(t for t in cells[.5,f,h,'without_top3_changes'] if t['model']==r['model'] and t['route']==r['route'])
        lines.append(f"| {f} | {h} | {label(r)} | {c['top3_changes_ae_share_pct']:.1f} | {r['wape_pct']:.2f} | {t['wape_pct']:.2f} |")
lines+=['','## Межі інтерпретації','',
'Вага змінює саму прогнозну ціль. Нижча абсолютна WAPE за іншої ваги не обґрунтовує вибір ваги; '
'порівнюємо переваги методів щодо однакової цілі та відповідних naïve-базових моделей всередині сценарію. '
'Ранжування ex-post, без тверджень про статистичну значущість чи універсально найкращу модель. '
'Точність не підтверджує змістову валідність індексу як міри використання.','',
'Виключення дат стосується лише скорингу: воно не оцінює причинний вплив сплесків у навчанні '
'(зокрема Vue у грудні 2022). Сплески між origin і цільовим місяцем також не виділені окремо. '
'Зміна WAPE залежить від обох сум у її формулі; для прозорості наведено частку абсолютної похибки '
'та повні MAE/RMSE/log-MAE. Вибір трьох дат є діагностичним сценарієм, не формальним виявленням аномалій.','',
'Повні результати: scores-by-subset.csv, paired-route-comparison.csv, winners.csv, '
'error-concentration.csv. Точні дати й зміни компонентів: largest-component-changes.csv.']
(out/'REPORT_UK.md').write_text('\n'.join(lines)+'\n')
(out/Path(__file__).name).write_bytes(Path(__file__).read_bytes())
(out/'config.json').write_text(json.dumps(dict(inputs=provenance,scopes=scopes,shock_rule='top 3 of 24 target dates by max absolute component log1p MoM change; ties by date',training_modified=False),indent=2))
files=sorted(p for p in out.iterdir() if p.is_file())
(out/'manifest.json').write_text(json.dumps(dict(status='complete',scoring_groups=len(scores),files=[dict(path=p.name,sha256=sha(p)) for p in files]),indent=2))
print('Verified sensitivity report:',out/'REPORT_UK.md')
