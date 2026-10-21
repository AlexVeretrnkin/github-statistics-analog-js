import {
  getFrameworkPopularityResearch,
  isCompletedCalendarMonth,
} from './framework-popularity';
import { buildFrameworkRetrospectives } from './framework-retrospectives';

describe('framework popularity research', () => {
  it('normalizes all three archived signals for React, Angular, and Vue', async () => {
    const research = await getFrameworkPopularityResearch();

    expect(research.metrics.map((metric) => metric.id)).toEqual([
      'google-trends',
      'npm-downloads',
      'github-stars',
    ]);

    for (const metric of research.metrics) {
      expect(metric.series.map((series) => series.framework)).toEqual([
        'React',
        'Angular',
        'Vue',
      ]);
      expect(metric.series.every((series) => series.points.length > 0)).toBe(true);
      expect(metric.forecasts).toHaveLength(9);
      expect(new Set(metric.forecasts.map((forecast) => forecast.model))).toEqual(
        new Set(['ARIMA', 'ETS', 'PROPHET']),
      );
      expect(metric.forecasts.filter((forecast) => forecast.isBest)).toHaveLength(3);
      expect(metric.forecasts.every((forecast) => forecast.points.length === 24)).toBe(true);
    }
  });

  it('reports the official GitHub star-history provenance', async () => {
    const research = await getFrameworkPopularityResearch();

    expect(research.provenanceNotes.some((note) => note.includes('privacy-safe')))
      .toBe(true);
  });

  it('exposes forecast checks for every available popularity signal', async () => {
    const research = await getFrameworkPopularityResearch();

    expect(research.retrospectives.map((study) => study.metric)).toEqual([
      'google-trends',
      'npm-downloads',
      'github-stars',
    ]);
    expect(research.retrospectives.every((study) => study.series.length === 3)).toBe(true);

    const npm = research.retrospectives.find((study) => study.metric === 'npm-downloads');
    const react = npm?.series.find((series) => series.framework === 'React');
    const angular = npm?.series.find((series) => series.framework === 'Angular');

    expect(npm?.evidence).toBe('reconstructed');
    expect(react?.statistics.wape).toBeCloseTo(35.643110072310776, 10);
    expect(react?.statistics.coverage80).toBeCloseTo(100 * 4 / 11, 10);
    expect(angular?.statistics.wape).toBeCloseTo(8.15846191512144, 10);
    expect(angular?.statistics.coverage80).toBe(100);
  });

  it('calculates retrospective scores from the points plotted in every study', async () => {
    const research = await getFrameworkPopularityResearch();
    for (const study of research.retrospectives) {
      for (const series of study.series) {
        const points = series.points.filter(point => point.observed !== null);
        expect(series.statistics.evaluatedMonths).toBe(points.length);
        if (!points.length) {
          expect(series.statistics.rmse).toBeNull();
          continue;
        }
        const errors = points.map(point => point.observed! - point.forecast);
        const absoluteError = errors.reduce((sum, error) => sum + Math.abs(error), 0);
        const total = points.reduce((sum, point) => sum + Math.abs(point.observed!), 0);
        expect(series.statistics.rmse).toBeCloseTo(Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / points.length), 10);
        expect(series.statistics.mae).toBeCloseTo(absoluteError / points.length, 10);
        expect(series.statistics.wape).toBeCloseTo(100 * absoluteError / total, 10);
        expect(series.statistics.meanError).toBeCloseTo(errors.reduce((sum, error) => sum + error, 0) / points.length, 10);
        expect(series.statistics.coverage80).toBeCloseTo(100 * points.filter(point => point.observed! >= point.lo80 && point.observed! <= point.hi80).length / points.length, 10);
      }
    }
  });

  it('keeps the frozen GitHub comparison unchanged when operational forecasts are refreshed or missing', async () => {
    const research = await getFrameworkPopularityResearch();
    const github = research.metrics.find(metric => metric.id === 'github-stars')!;
    const original = buildFrameworkRetrospectives([github]).find(study => study.metric === 'github-stars')!;
    const refreshed = {
      ...github,
      forecasts: github.forecasts.map(forecast => ({
        ...forecast,
        points: forecast.points.map(point => ({ ...point, date: '2030-01', mean: 999999 })),
      })),
    };
    for (const metric of [refreshed, { ...github, forecasts: [] }]) {
      expect(buildFrameworkRetrospectives([metric]).find(study => study.metric === 'github-stars')).toEqual(original);
    }
    expect(original.originDate).toBe('2025-09');
    for (const series of original.series) {
      expect(series.points).toHaveLength(11);
      expect(series.points[0].date).toBe('2025-10');
      expect(series.points.at(-1)?.date).toBe('2026-08');
    }
    expect(original.series.find(series => series.framework === 'Angular')?.statistics.rmse)
      .toBeCloseTo(92.55801002361653, 10);
  });

  it('accepts only months completed before the current UTC month', () => {
    const today = new Date('2026-09-19T12:00:00.000Z');

    expect(isCompletedCalendarMonth('2026-08-01', today)).toBe(true);
    expect(isCompletedCalendarMonth('2026-09-01', today)).toBe(false);
    expect(isCompletedCalendarMonth('2026-10-01', today)).toBe(false);
  });
});
