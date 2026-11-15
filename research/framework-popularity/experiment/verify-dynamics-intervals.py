"""Verify interval scores and report; usage: SCRIPT INTERVAL_DIR BACKTEST_DIR."""
import csv, hashlib, json, math, statistics, sys
from collections import defaultdict
from pathlib import Path
out, source = map(Path,sys.argv[1:])
read=lambda p:list(csv.DictReader(p.open()))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest=json.loads((out/'manifest.json').read_text());assert manifest['status']=='complete' and manifest['jobs']==360
for f in manifest['files']:assert sha(out/f['path'])==f['sha256']
cfg=json.loads((out/'config.json').read_text());assert cfg['source_manifest_sha256']==sha(source/'manifest.json')
d=read(out/'interval-predictions.csv');assert len(d)==25920
points={(r['framework'],r['origin'],r['model'],r['route'],r['horizon']):r for r in read(source/'predictions.csv')}
groups=defaultdict(list);seen=set()
for r in d:
    key=tuple(r[k] for k in ('framework','origin','model','route','block','horizon'));assert key not in seen;seen.add(key)
    for k in ('actual','point','lo80','hi80','lo95','hi95'):r[k]=float(r[k]);assert math.isfinite(r[k]) and r[k]>0
    assert r['lo95']<=r['lo80']<=r['hi80']<=r['hi95']
    route='direct' if r['route']=='direct' else 'components'
    p=points[r['framework'],r['origin'],r['model'],route,r['horizon']]
    assert r['date']==p['date'] and math.isclose(r['point'],float(p['point']),rel_tol=1e-12) and math.isclose(r['actual'],float(p['actual']),rel_tol=1e-12)
    base=tuple(r[k] for k in ('framework','model','route','block','horizon'))
    groups[base+('all',)].append(r)
    groups[base+('early' if r['origin']<='2024-08-01' else 'late',)].append(r)
scores=read(out/'interval-scores.csv');assert len(scores)==2160
lookup={}
for s in scores:
    key=tuple(s[k] for k in ('framework','model','route','block','horizon','scope'))
    g=groups[key];assert len(g)==int(s['n'])==(24 if s['scope']=='all' else 12)
    level=s['level'];alpha=1-int(level)/100
    widths=[r['hi'+level]-r['lo'+level] for r in g]
    covered=sum(r['lo'+level]<=r['actual']<=r['hi'+level] for r in g)
    loss=[width+2/alpha*max(r['lo'+level]-r['actual'],0)+2/alpha*max(r['actual']-r['hi'+level],0) for r,width in zip(g,widths)]
    expected=dict(covered=covered,coverage=covered/len(g),mean_width=statistics.mean(widths),mean_interval_score=statistics.mean(loss),normalized_width_pct=100*sum(widths)/sum(r['actual'] for r in g),normalized_interval_score_pct=100*sum(loss)/sum(r['actual'] for r in g))
    for k,v in expected.items():assert math.isclose(float(s[k]),v,rel_tol=1e-10,abs_tol=1e-9),(key,k)
    lookup[key+(level,)]=s
# Naive paired component and direct distributions must coincide, not only point predictions.
idx={tuple(r[k] for k in ('framework','origin','model','route','block','horizon')):r for r in d}
for r in d:
    if r['model'] in ('NAIVE','SNAIVE') and r['route']=='direct':
        c=idx[r['framework'],r['origin'],r['model'],'components',r['block'],r['horizon']]
        for k in ('lo80','hi80','lo95','hi95'):assert math.isclose(r[k],c[k],rel_tol=1e-10)
point_scores=read(source/'scores.csv')
selected=[]
for f in ('React','Angular','Vue'):
    for h in ('1','3','6','12'):
        g=[r for r in point_scores if r['framework']==f and r['horizon']==h]
        selected.append(min(g,key=lambda r:float(r['wape_pct'])))
lines=['# Прогнозні інтервали індексу динаміки','',
'## Метод і межі','',
'Вага downloads/stars 50/50, та сама фіксована база, 24 origins і 5 родин моделей. '
'4000 сценаріїв на origin/модель; номінальні рівні 80% і 95%. '
'Основний варіант — вибір окремих місяців залишків із поверненням; додатковий — '
'кругові блоки по три місяці. Для компонентів використані ті самі історичні індекси місяців, '
'що зберігає емпіричну спільну залежність. Ресемплінг здійснюється лише з навчальної історії. '
'Перші 12 залишків вилучено з bootstrap-пулу для всіх моделей, решту центровано; '
'вихідні спостереження не вилучалися з навчання.','',
'SARIMA й адитивний ETS: сценарії поширюються через оцінену модель. '
'Для швидкості використана афінна реакція на інновації, перевірена проти simulate() '
'на кожному збереженому фіті. Центр збережено рівним раніше отриманому точковому прогнозу. '
'Persistence накопичує інновації, seasonal naïve повторює сезон із новими інноваціями. '
'Для Prophet залишковий шум додається до фіксованої прогнозної траєкторії: '
'це **не нативні інтервали Prophet і не повна невизначеність майбутнього тренду**.','',
'Усі інтервали умовні: параметри, обрана специфікація та кінцевий стан зафіксовані. '
'Невизначеність оцінювання параметрів і вибору моделі не врахована. '
'Bootstrap передбачає придатність історичних залишків для майбутнього; блоки довжини 3 '
'є перевіркою чутливості, а не гарантією врахування всієї часової залежності. '
'Жодні фактичні значення після origin не використовувалися для побудови чи калібрування інтервалів.','',
'Контроль components_independent переставляє цілі сценарії stars між симуляціями. '
'Маргінальні набори сценаріїв незмінні, але спільна залежність з downloads руйнується. '
'Інтервали отримано з квантилів симульованого індексу, а не множенням меж компонентів.','',
'## Покриття для моделей із найменшою точковою WAPE у попередньому експерименті','',
'Вибір моделей тут зроблено за попередніми точковими результатами на цих самих origins; '
'це описова таблиця, не незалежна перевірка відібраної моделі. Основний bootstrap: окремі місяці.','',
'| Фреймворк | h | Модель/підхід | Покриття 80% | Покриття 95% | Середня ширина 95%, % середнього факту |',
'|---|---:|---|---:|---:|---:|']
for r in selected:
    base=(r['framework'],r['model'],r['route'],'1',r['horizon'],'all')
    s80=lookup[base+('80',)];s95=lookup[base+('95',)]
    lines.append(f"| {r['framework']} | {r['horizon']} | {r['model']}/{r['route']} | {s80['covered']}/24 | {s95['covered']}/24 | {float(s95['normalized_width_pct']):.1f} |")
lines+=['','## Чутливість до блоків та залежності компонентів','',
'| Фреймворк | h | Покриття 95%, блок 1 | Покриття 95%, блок 3 | Зміна ширини при незалежних компонентах, % |',
'|---|---:|---:|---:|---:|']
for r in selected:
    f,m,route,h=(r[k] for k in ('framework','model','route','horizon'))
    a=lookup[f,m,route,'1',h,'all','95'];b=lookup[f,m,route,'3',h,'all','95']
    effect='—'
    if route=='components':
        independent=lookup[f,m,'components_independent','1',h,'all','95']
        effect=f"{100*(float(independent['mean_width'])/float(a['mean_width'])-1):+.1f}"
    lines.append(f"| {f} | {h} | {a['covered']}/24 | {b['covered']}/24 | {effect} |")
lines+=['','## Річний прогноз: чи однакове покриття у двох половинах перевірки?','',
        'Ті самі моделі, обрані за точковою WAPE; основний bootstrap, номінальний рівень 95%. '
        'Останні дві колонки рахують виходи факту за межі за всі 24 origins.','',
        '| Фреймворк | Перші 12 | Останні 12 | Факт нижче нижньої межі | Факт вище верхньої межі |',
        '|---|---:|---:|---:|---:|']
for r in selected:
    if r['horizon']!='12':continue
    f=r['framework'];base=(f,r['model'],r['route'],'1','12')
    early,late=[lookup[base+(scope,'95')]['covered'] for scope in ('early','late')]
    g=groups[base+('all',)]
    lines.append(f"| {f} | {early}/12 | {late}/12 | {sum(x['actual']<x['lo95'] for x in g)} | {sum(x['actual']>x['hi95'] for x in g)} |")
lines+=['','Для статті: подавати покриття разом із шириною. Пропуски фактичних значень для React '
        'і повне покриття з дуже широкими межами для Vue демонструють різні обмеження того самого '
        'підходу. Така перевірка не дає підстав стверджувати, що інтервали відкалібровано для всіх рядів.',
        '','## Як оцінювати результат','',
'95% є номінальним рівнем, а не підтвердженою гарантією. Крок емпіричного покриття '
'за 24 origins становить 4,17 відсоткового пункта; спостереження перекриваються, '
'тому проста біноміальна інтерпретація некоректна. Результати для ранніх і пізніх '
'12 origins наведено окремо в interval-scores.csv.','',
'Interval score = ширина + 2/alpha × штраф за вихід факту за кожну межу; менше — краще. '
'Ширина без покриття не визначає якість. Для порівняння фреймворків наводимо також '
'нормовані ширину та score, але не об’єднуємо похибки різних рядів. '
'Заміна довжини блока після перегляду покриття була б вибором за тестовими даними; '
'обидва варіанти звітуються без оголошення одного відкаліброваним.','',
'Незалежна перевірка Python підтвердила 25 920 рядків інтервалів, '
'2160 наборів метрик, вкладеність меж, незмінність фактичних і точкових прогнозів, '
'збіг прямих і парних компонентних інтервалів naïve-моделей та контрольні суми. '
'Залишки, seed, індекси bootstrap, перестановки та матриці реакцій збережено в audit/*.rds.','',
'Джерела методики: [forecast simulate](https://pkg.robjhyndman.com/forecast/reference/simulate.ets.html), '
'[Forecasting: Principles and Practice](https://otexts.com/fpp3/prediction-intervals.html).']
(out/'REPORT_UK.md').write_text('\n'.join(lines)+'\n')
(out/Path(__file__).name).write_bytes(Path(__file__).read_bytes())
(out/'verification.json').write_text(json.dumps(dict(status='passed',predictions=25920,score_groups=2160),indent=2))
manifest['files']=[dict(path=str(p.relative_to(out)),sha256=sha(p)) for p in sorted(out.rglob('*')) if p.is_file() and p.name!='manifest.json']
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Verified intervals and report:',out/'REPORT_UK.md')
