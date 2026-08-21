import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { FrameworkPopularityChartComponent } from '../components/framework-popularity-chart/framework-popularity-chart';
import type {
  FrameworkName,
  FrameworkForecastMode,
  FrameworkForecastSeries,
  FrameworkPopularityMetric,
  FrameworkPopularityMetricId,
  FrameworkPopularityResearch,
  FrameworkPopularityScale,
  FrameworkPopularitySeries,
} from '../core/framework-popularity.models';

interface FrameworkSummary {
  change: number | null;
  framework: FrameworkName;
  latestDate: string;
  latestValue: number;
}

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink, FrameworkPopularityChartComponent],
  templateUrl: './framework-popularity.page.html',
  styleUrl: './framework-popularity.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class FrameworkPopularityPageComponent {
  readonly load = input.required<{ research: FrameworkPopularityResearch }>();

  protected readonly selectedMetricId = signal<FrameworkPopularityMetricId>('google-trends');
  protected readonly selectedScale = signal<FrameworkPopularityScale>('absolute');
  protected readonly selectedRange = signal<'5y' | 'all'>('5y');
  protected readonly selectedFrameworks = signal<FrameworkName[]>(['React', 'Angular', 'Vue']);
  protected readonly forecastMode = signal<FrameworkForecastMode>('best');
  protected readonly showForecastInterval = signal(true);

  protected readonly research = computed(() => this.load().research);
  protected readonly selectedMetric = computed<FrameworkPopularityMetric>(() => {
    const metrics = this.research().metrics;
    const metric = metrics.find((item) => item.id === this.selectedMetricId()) ?? metrics[0];

    if (!metric) {
      throw new Error('Framework-popularity research has no metrics.');
    }

    return metric;
  });
  protected readonly visibleSeries = computed<FrameworkPopularitySeries[]>(() => {
    const selected = new Set(this.selectedFrameworks());
    const series = this.selectedMetric().series.filter((item) => selected.has(item.framework));
    const latestDate = series.flatMap((item) => item.points.map((point) => point.date)).sort().at(-1);
    const earliestDate = latestDate && this.selectedRange() === '5y'
      ? `${Number(latestDate.slice(0, 4)) - 5}-${latestDate.slice(5)}`
      : undefined;

    return series.map((item) => {
      const points = item.points.filter((point) => !earliestDate || point.date >= earliestDate);
      return {
        framework: item.framework,
        points: transformPoints(points, this.selectedScale()),
      };
    });
  });
  protected readonly visibleForecasts = computed<FrameworkForecastSeries[]>(() => {
    const mode = this.forecastMode();
    if (mode === 'off') {
      return [];
    }

    const frameworks = new Set(this.selectedFrameworks());
    return this.selectedMetric().forecasts.filter((forecast) =>
      frameworks.has(forecast.framework)
      && (mode === 'best' ? forecast.isBest : forecast.model === mode),
    ).map((forecast) => ({
      ...forecast,
      points: transformForecastPoints(
        forecast.points,
        this.selectedScale(),
        this.getForecastBaseline(forecast.framework),
      ),
    }));
  });
  protected readonly displayUnit = computed(() => {
    if (this.selectedScale() === 'index-100') {
      return 'index';
    }

    if (this.selectedScale() === 'log-10') {
      return 'log₁₀';
    }

    return this.selectedMetric().unit;
  });
  protected readonly summaries = computed<FrameworkSummary[]>(() =>
    this.selectedMetric().series
      .filter((item) => this.selectedFrameworks().includes(item.framework))
      .map((item) => summarizeSeries(item)),
  );
  protected readonly diagnostics = computed(() =>
    this.research().diagnostics.filter((item) => item.metric === this.selectedMetricId()),
  );
  protected readonly forecastHeading = computed(() => {
    const mode = this.forecastMode();

    if (mode === 'best') {
      return 'Models selected by 12-month holdout RMSE';
    }

    return `${mode === 'PROPHET' ? 'Prophet' : mode} forecasts`;
  });

  protected selectMetric(metric: FrameworkPopularityMetricId): void {
    this.selectedMetricId.set(metric);
  }

  protected selectScale(scale: FrameworkPopularityScale): void {
    this.selectedScale.set(scale);
  }

  protected selectRange(range: '5y' | 'all'): void {
    this.selectedRange.set(range);
  }

  protected selectForecastMode(mode: FrameworkForecastMode): void {
    this.forecastMode.set(mode);
  }

  protected toggleForecastInterval(): void {
    this.showForecastInterval.update((visible) => !visible);
  }

  protected toggleFramework(framework: FrameworkName): void {
    this.selectedFrameworks.update((frameworks) =>
      frameworks.includes(framework)
        ? frameworks.filter((item) => item !== framework)
        : [...frameworks, framework],
    );
  }

  protected isFrameworkSelected(framework: FrameworkName): boolean {
    return this.selectedFrameworks().includes(framework);
  }

  protected formatValue(value: number): string {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2, notation: 'compact' });
  }

  protected formatPValue(value: number | null): string {
    return value === null ? 'n/a' : value.toLocaleString(undefined, { maximumSignificantDigits: 3 });
  }

  protected formatRmse(value: number): string {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2, notation: 'compact' });
  }

  protected formatForecastModel(model: FrameworkForecastSeries['model']): string {
    return model === 'PROPHET' ? 'Prophet' : model;
  }

  private getForecastBaseline(framework: FrameworkName): number {
    const points = this.selectedMetric().series.find((series) => series.framework === framework)?.points ?? [];
    return points.find((point) => point.value > 0)?.value ?? 1;
  }
}

function transformPoints(
  points: FrameworkPopularitySeries['points'],
  scale: FrameworkPopularityScale,
): FrameworkPopularitySeries['points'] {
  if (scale === 'absolute') {
    return points;
  }

  if (scale === 'log-10') {
    return points.map((point) => ({ ...point, value: Math.log10(point.value + 1) }));
  }

  const baseline = points.find((point) => point.value > 0)?.value ?? 1;
  return points.map((point) => ({ ...point, value: (point.value / baseline) * 100 }));
}

function summarizeSeries(series: FrameworkPopularitySeries): FrameworkSummary {
  const latest = series.points.at(-1) ?? { date: 'unknown', value: 0 };
  const yearAgo = series.points.at(-13);

  return {
    framework: series.framework,
    latestDate: latest.date,
    latestValue: latest.value,
    change: yearAgo && yearAgo.value !== 0
      ? ((latest.value - yearAgo.value) / yearAgo.value) * 100
      : null,
  };
}

function transformForecastPoints(
  points: FrameworkForecastSeries['points'],
  scale: FrameworkPopularityScale,
  baseline: number,
): FrameworkForecastSeries['points'] {
  const transform = (value: number) => {
    if (scale === 'index-100') {
      return (value / baseline) * 100;
    }

    if (scale === 'log-10') {
      return Math.log10(value + 1);
    }

    return value;
  };

  return points.map((point) => ({
    ...point,
    mean: transform(point.mean),
    lo80: transform(point.lo80),
    hi80: transform(point.hi80),
    lo95: transform(point.lo95),
    hi95: transform(point.hi95),
  }));
}
