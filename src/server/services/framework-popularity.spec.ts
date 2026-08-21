import { getFrameworkPopularityResearch } from './framework-popularity';

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

  it('keeps GitHub-star provenance explicitly deferred', async () => {
    const research = await getFrameworkPopularityResearch();

    expect(research.provenanceNotes.some((note) => note.includes('later provenance review')))
      .toBe(true);
  });
});
