import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResearchExperiment } from '../../app/core/research-experiment.models';

const root = join(process.cwd(), 'public/research/article-experiment');
const data: ResearchExperiment = JSON.parse(readFileSync(join(root, 'results.json'), 'utf8'));

describe('published article experiment', () => {
  it('recalculates all displayed point and interval scores from the exact paired predictions', () => {
    expect(data.series).toHaveLength(6);
    expect(data.status).toMatchObject({ fits: 750, failed_fits: 0 });
    let checked = 0;
    for (const series of data.series) {
      expect(series.accuracy).toHaveLength(20);
      for (const row of series.accuracy) {
        const predictions = series.backtest.filter(p => p.model === row.model && p.horizon === row.horizon);
        expect(predictions).toHaveLength(24);
        const abs = predictions.map(p => Math.abs(p.actual! - p.point));
        const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
        const check = (actual: number, expected: number) => expect(Math.abs(actual - expected) / Math.max(1, Math.abs(expected))).toBeLessThan(1e-10);
        check(row.mae, mean(abs));
        check(row.rmse, Math.sqrt(mean(abs.map(x => x * x))));
        check(row.wape_pct, 100 * abs.reduce((a,b) => a+b) / predictions.reduce((a,p) => a + p.actual!, 0));
        for (const level of [80, 95] as const) {
          const alpha = 1 - level / 100;
          check(row[`coverage${level}`], mean(predictions.map(p => p.actual! >= p[`lo${level}`] && p.actual! <= p[`hi${level}`] ? 1 : 0)));
          check(row[`width${level}`], mean(predictions.map(p => p[`hi${level}`] - p[`lo${level}`])));
          check(row[`interval_score${level}`], mean(predictions.map(p => p[`hi${level}`] - p[`lo${level}`] + 2 / alpha * Math.max(p[`lo${level}`] - p.actual!, 0) + 2 / alpha * Math.max(p.actual! - p[`hi${level}`], 0))));
        }
        checked++;
      }
      for (const h of data.config.horizons) {
        const counts = new Map(data.config.models.map(m => [m, 0]));
        for (const origin of new Set(series.backtest.map(p => p.origin))) {
          const rows = series.backtest.filter(p => p.origin === origin && p.horizon === h);
          expect(rows).toHaveLength(5);
          const min = Math.min(...rows.map(p => Math.abs(p.point - p.actual!)));
          const wins = rows.filter(p => Math.abs(p.point - p.actual!) === min);
          for (const w of wins) counts.set(w.model, counts.get(w.model)! + 1 / wins.length);
        }
        for (const s of series.stability.filter(s => s.horizon === h)) expect(s.wins).toBeCloseTo(counts.get(s.model)!, 10);
      }
    }
    expect(checked).toBe(120);
  });

  it('preserves exact-fit diagnostics, temporal boundaries and the h=12 naive identity', () => {
    for (const series of data.series) {
      expect(series.fits).toHaveLength(5);
      expect(series.diagnostics).toHaveLength(5);
      expect(series.outlook).toHaveLength(120);
      for (const p of series.backtest) {
        expect(p.origin >= '2023-09-01' && p.origin <= '2025-08-01').toBe(true);
        expect(p.date > p.origin).toBe(true);
        expect(p.date <= '2026-08-01').toBe(true);
        expect(p.lo95 <= p.lo80 && p.hi80 <= p.hi95).toBe(true);
        if (p.horizon === 12 && p.model === 'NAIVE') {
          expect(p.point).toBe(series.backtest.find(q => q.model === 'SNAIVE' && q.origin === p.origin && q.horizon === 12)?.point);
        }
      }
      for (const d of series.diagnostics) {
        expect(series.residuals.filter(r => r.model === d.model && r.residual !== null)).toHaveLength(d.n_residuals);
        expect(d.lag).toBe(Math.max(d.fitdf + 3, Math.min(24, Math.floor(d.n_residuals / 5))));
      }
    }
  });
});
