"""Export saved numerical outputs used by interactive article views; never refit."""
import csv,json,sys,hashlib
from pathlib import Path
source=Path(sys.argv[1]); root=Path('public/research/article-experiment')
files={'heldout':'figures/heldout-series.csv','indexScores':'supplement-data/index/equal-weight/scores.csv','indexDirections':'supplement-data/index/equal-weight/direction-and-gaps.csv','indexIntervals':'supplement-data/index/intervals/interval-scores.csv','indexPredictions':'supplement-data/index/intervals/interval-predictions.csv','indexSensitivity':'supplement-data/index/construction/direction-stability.csv'}
def value(v):
 if v in ('','NA'): return None
 if v in ('TRUE','FALSE'): return v=='TRUE'
 try: return float(v)
 except ValueError: return v
result={'id':'article-experiment-2026-10-18','sourceFiles':[]}
for key,file in files.items():
 p=source/file
 with p.open() as f: result[key]=[{k:value(v) for k,v in row.items()} for row in csv.DictReader(f)]
 if key == 'indexPredictions': result[key] = [r for r in result[key] if r['block'] == 1]
 if key == 'indexIntervals': result[key] = [r for r in result[key] if r['block'] == 1 and r['scope'] == 'all']
 result['sourceFiles'].append({'file':file,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(root/'explorer.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
