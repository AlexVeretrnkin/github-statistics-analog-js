import {
  getFrameworkPopularityResearch,
  isCompletedCalendarMonth,
} from './framework-popularity';

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

  it('accepts only months completed before the current UTC month', () => {
    const today = new Date('2026-09-19T12:00:00.000Z');

    expect(isCompletedCalendarMonth('2026-08-01', today)).toBe(true);
    expect(isCompletedCalendarMonth('2026-09-01', today)).toBe(false);
    expect(isCompletedCalendarMonth('2026-10-01', today)).toBe(false);
  });
});
