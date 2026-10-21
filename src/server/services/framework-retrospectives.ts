import githubArticleSnapshot from './github-ets-2025-09.json';

import type {
  FrameworkForecastSeries,
  FrameworkName,
  FrameworkPopularityMetric,
  FrameworkRetrospectivePoint,
  FrameworkRetrospectiveSeries,
  FrameworkRetrospectiveStatistics,
  FrameworkRetrospectiveStudy,
} from '../../app/core/framework-popularity.models';

const FRAMEWORKS: FrameworkName[] = ['Angular', 'React', 'Vue'];
const ARTICLE_DATES = [
  '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
  '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
];

interface ArticleSeriesSnapshot {
  forecast: number[];
  framework: FrameworkName;
  hi80: number[];
  lo80: number[];
  observed: number[];
}

const NPM_ARTICLE_SNAPSHOT: ArticleSeriesSnapshot[] = [
  {
    framework: 'Angular',
    forecast: [
      19_251_949, 18_832_683, 18_479_642, 19_200_537, 19_449_683, 20_495_000,
      20_807_524, 21_025_052, 21_861_717, 22_843_834, 22_107_103,
    ],
    observed: [
      18_162_117, 17_556_725, 17_031_959, 17_465_368, 18_761_986, 23_226_420,
      22_245_463, 22_464_152, 24_650_047, 24_770_343, 24_369_359,
    ],
    lo80: [
      17_751_707, 17_068_977, 16_435_688, 16_634_253, 16_439_864, 16_876_586,
      16_656_295, 16_342_722, 16_476_185, 16_666_570, 15_591_325,
    ],
    hi80: [
      20_799_421, 20_663_590, 20_616_292, 21_909_007, 22_654_588, 24_383_978,
      25_313_797, 26_160_146, 27_831_144, 29_766_900, 29_493_417,
    ],
  },
  {
    framework: 'React',
    forecast: millions([210, 213.78, 222, 242, 252, 272, 296, 307, 332, 363, 379.48]),
    observed: [
      204_370_780, 214_020_736, 236_129_342, 275_446_152, 333_340_617,
      464_131_240, 526_277_028, 562_038_855, 599_915_446, 689_332_252,
      677_704_677,
    ],
    lo80: millions([197, 196, 195, 198, 205, 215, 228, 240, 252, 265, 275]),
    hi80: millions([222, 232, 255, 300, 330, 365, 390, 405, 430, 460, 485]),
  },
  {
    framework: 'Vue',
    forecast: millions([35, 35, 36.5, 38, 40, 42, 43.5, 46, 50, 53, 55]),
    observed: [
      30_854_330, 30_703_451, 31_650_196, 33_224_273, 35_679_795, 48_387_281,
      48_343_912, 52_309_836, 56_268_278, 61_075_864, 59_765_937,
    ],
    lo80: millions([31, 31, 32, 33, 34, 35, 37, 36, 38, 39, 40]),
    hi80: millions([39, 39, 41, 44, 46, 48, 51, 55, 62, 67, 73]),
  },
];

const GITHUB_OBSERVED: Record<FrameworkName, number[]> = {
  React: [1_020, 920, 1_190, 920, 930, 1_320, 1_020, 910, 1_050, 1_000, 2_102],
  Angular: [284, 296, 255, 284, 342, 294, 220, 232, 385, 351, 542],
  Vue: [330, 310, 360, 315, 270, 350, 300, 245, 235, 250, 317],
};

export function buildFrameworkRetrospectives(
  metrics: FrameworkPopularityMetric[],
): FrameworkRetrospectiveStudy[] {
  const google = metrics.find((metric) => metric.id === 'google-trends');
  const github = metrics.find((metric) => metric.id === 'github-stars');

  return [
    google ? buildOperationalStudy(google) : undefined,
    buildNpmArticleStudy(),
    github ? buildGithubArticleStudy() : undefined,
  ].filter((study): study is FrameworkRetrospectiveStudy => study !== undefined);
}

function buildNpmArticleStudy(): FrameworkRetrospectiveStudy {
  return {
    metric: 'npm-downloads',
    title: 'Retrospective check of the 2025 npm forecast',
    description: 'Reconstructed September 2025-origin ARIMA paths compared with the eleven monthly observations that followed.',
    evidence: 'reconstructed',
    originDate: '2025-09',
    evaluationStart: ARTICLE_DATES[0],
    evaluationEnd: ARTICLE_DATES.at(-1) ?? ARTICLE_DATES[0],
    unit: 'downloads / month',
    scale: 'linear',
    note: 'The numeric NPM forecast was reconstructed from the archived procedure, so it is weaker evidence than an immutable archived forecast.',
    series: NPM_ARTICLE_SNAPSHOT.map((snapshot) => {
      const points = ARTICLE_DATES.map((date, index) => ({
        date,
        forecast: snapshot.forecast[index],
        observed: snapshot.observed[index],
        lo80: snapshot.lo80[index],
        hi80: snapshot.hi80[index],
      }));
      return {
        framework: snapshot.framework,
        model: 'ARIMA',
        points,
        statistics: calculateStatistics(points),
      };
    }),
  };
}

function buildGithubArticleStudy(): FrameworkRetrospectiveStudy {
  return {
    metric: 'github-stars',
    title: 'Retrospective check of the frozen 2025 GitHub forecast',
    description: 'The original ETS paths were frozen after September 2025 and compared with the official history reconstructed later.',
    evidence: 'frozen',
    originDate: githubArticleSnapshot.originDate,
    evaluationStart: ARTICLE_DATES[0],
    evaluationEnd: ARTICLE_DATES.at(-1) ?? ARTICLE_DATES[0],
    unit: 'new stars / month',
    scale: 'logarithmic',
    note: 'This comparison crosses from archived training history to GitHub\'s official reconstructed history, so it is not a same-source validation.',
    series: FRAMEWORKS.map((framework) => {
      const forecast = githubArticleSnapshot.forecasts.find((item) => item.framework === framework);
      // Match only the preserved forecast dates; never substitute a later forecast by position.
      const points = ARTICLE_DATES.flatMap((date, index) => {
        const point = forecast?.points.find((candidate) => candidate.date === date);
        return point ? [{
          date,
          forecast: point.mean,
          observed: GITHUB_OBSERVED[framework][index],
          lo80: point.lo80,
          hi80: point.hi80,
        }] : [];
      });
      return {
        framework,
        model: 'ETS',
        points,
        statistics: calculateStatistics(points),
      };
    }),
  };
}

function buildOperationalStudy(metric: FrameworkPopularityMetric): FrameworkRetrospectiveStudy {
  const seriesByFramework = new Map(metric.series.map((series) => [series.framework, series]));
  const bestForecasts = metric.forecasts.filter((forecast) => forecast.isBest);
  const series = bestForecasts.map((forecast) => operationalSeries(
    forecast,
    seriesByFramework.get(forecast.framework)?.points ?? [],
  ));
  const firstDate = bestForecasts.flatMap((forecast) => forecast.points).at(0)?.date ?? 'unknown';
  const observedDates = series
    .flatMap((item) => item.points)
    .filter((point) => point.observed !== null)
    .map((point) => point.date)
    .sort();

  return {
    metric: metric.id,
    title: `${metric.label} forecast check`,
    description: observedDates.length
      ? 'The stored operational forecast is evaluated automatically as completed-month observations become available.'
      : 'The stored operational forecast is ready; accuracy will appear automatically when matching completed-month observations arrive.',
    evidence: 'operational',
    originDate: previousMonth(firstDate),
    evaluationStart: firstDate,
    evaluationEnd: observedDates.at(-1) ?? 'awaiting observations',
    unit: metric.unit,
    scale: 'linear',
    note: 'Operational checks use only exact date overlaps and never refit the stored forecast with later observations.',
    series,
  };
}

function operationalSeries(
  forecast: FrameworkForecastSeries,
  observations: Array<{ date: string; value: number }>,
): FrameworkRetrospectiveSeries {
  const observedByDate = new Map(observations.map((point) => [point.date, point.value]));
  const points = forecast.points.map((point) => ({
    date: point.date,
    forecast: point.mean,
    observed: observedByDate.get(point.date) ?? null,
    lo80: point.lo80,
    hi80: point.hi80,
  }));

  return {
    framework: forecast.framework,
    model: forecast.model,
    points,
    statistics: calculateStatistics(points),
  };
}

function calculateStatistics(points: FrameworkRetrospectivePoint[]): FrameworkRetrospectiveStatistics {
  const evaluated = points.filter((point) => point.observed !== null);
  if (evaluated.length === 0) {
    return {
      coverage80: null,
      evaluatedMonths: 0,
      mae: null,
      meanError: null,
      rmse: null,
      wape: null,
    };
  }

  const errors = evaluated.map((point) => (point.observed ?? 0) - point.forecast);
  const absoluteError = errors.reduce((sum, error) => sum + Math.abs(error), 0);
  const observedTotal = evaluated.reduce((sum, point) => sum + Math.abs(point.observed ?? 0), 0);

  return {
    evaluatedMonths: evaluated.length,
    rmse: Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / evaluated.length),
    mae: absoluteError / evaluated.length,
    wape: observedTotal === 0 ? null : (absoluteError / observedTotal) * 100,
    coverage80: (evaluated.filter((point) => {
      const observed = point.observed ?? 0;
      return observed >= point.lo80 && observed <= point.hi80;
    }).length / evaluated.length) * 100,
    meanError: errors.reduce((sum, error) => sum + error, 0) / evaluated.length,
  };
}

function previousMonth(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    return 'unknown';
  }

  const date = new Date(`${value}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function millions(values: number[]): number[] {
  return values.map((value) => value * 1_000_000);
}
