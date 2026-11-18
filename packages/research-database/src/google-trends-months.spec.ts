import { googleTrendsCompletedMonths } from './google-trends-months.js';

const dates = ['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01'];
const rows = dates.map((date, index) => ({ framework: 'React', date, interest: index * 10 }));

describe('Google Trends monthly coverage', () => {
  it('includes a fully covered October and excludes the incomplete trailing and leading months', () => {
    expect(googleTrendsCompletedMonths(rows, '2026-11-01')).toEqual([
      { framework: 'React', period: '2026-10-01', interest: 25 },
    ]);
  });
  it('requires all weekly intervals intersecting the month, including the week at its start', () => {
    for (const date of ['2026-09-27', '2026-10-11']) {
      expect(googleTrendsCompletedMonths(rows.filter(row => row.date !== date), '2026-11-01')).toEqual([]);
    }
  });
  it('accepts the final week only with explicit complete-week coverage', () => {
    const withoutNovember = rows.slice(0, -1);
    expect(googleTrendsCompletedMonths(withoutNovember, '2026-11-01')).toEqual([]);
    expect(googleTrendsCompletedMonths(withoutNovember, '2026-11-01', '2026-10-31')).toEqual([
      { framework: 'React', period: '2026-10-01', interest: 25 },
    ]);
    expect(googleTrendsCompletedMonths(rows, '2026-10-01', '2026-11-07')).toEqual([]);
  });
});
