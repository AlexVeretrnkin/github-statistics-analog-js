import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BaseChartDirective } from 'ng2-charts';
import { Chart, type ChartConfiguration, type ChartDataset, registerables } from 'chart.js';

import type {
  FrameworkForecastSeries,
  FrameworkPopularitySeries,
} from '../../core/framework-popularity.models';

Chart.register(...registerables);

const FRAMEWORK_COLORS: Record<string, string> = {
  React: '#087ea4',
  Angular: '#dd0031',
  Vue: '#42b883',
};

@Component({
  selector: 'app-framework-popularity-chart',
  standalone: true,
  imports: [BaseChartDirective],
  templateUrl: './framework-popularity-chart.html',
  styleUrl: './framework-popularity-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FrameworkPopularityChartComponent {
  readonly series = input<FrameworkPopularitySeries[]>([]);
  readonly forecasts = input<FrameworkForecastSeries[]>([]);
  readonly showInterval = input(true);
  readonly unit = input('value');

  protected readonly chartData = computed<ChartConfiguration<'line'>['data']>(() => {
    const series = this.series();
    const forecasts = this.forecasts();
    const labels = [...new Set([
      ...series.flatMap((item) => item.points.map((point) => point.date)),
      ...forecasts.flatMap((item) => item.points.map((point) => point.date)),
    ])].sort();

    const historicalDatasets = series.map((item) => {
      const values = new Map(item.points.map((point) => [point.date, point.value]));
      const color = FRAMEWORK_COLORS[item.framework] ?? '#193cb8';

      return {
        label: item.framework,
        data: labels.map((label) => values.get(label) ?? null),
        borderColor: color,
        backgroundColor: color,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: color,
        pointBorderWidth: 2,
        pointRadius: labels.length > 72 ? 0 : 2,
        pointHoverRadius: 5,
        borderWidth: 2.5,
        tension: 0.24,
        spanGaps: false,
        order: 1,
      } satisfies ChartDataset<'line'>;
    });

    const forecastDatasets = forecasts.flatMap((forecast) => {
      const history = series.find((item) => item.framework === forecast.framework);
      const lastHistoricalPoint = history?.points.at(-1);
      const color = FRAMEWORK_COLORS[forecast.framework] ?? '#193cb8';
      const forecastPoints = lastHistoricalPoint
        ? [{ date: lastHistoricalPoint.date, mean: lastHistoricalPoint.value }, ...forecast.points]
        : forecast.points;
      const meanValues = new Map(forecastPoints.map((point) => [point.date, point.mean]));
      const lowerValues = new Map(forecast.points.map((point) => [point.date, point.lo80]));
      const upperValues = new Map(forecast.points.map((point) => [point.date, point.hi80]));
      const intervalDatasets: ChartDataset<'line'>[] = this.showInterval() ? [
        {
          label: `${forecast.framework} 80% lower`,
          data: labels.map((label) => lowerValues.get(label) ?? null),
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          pointRadius: 0,
          borderWidth: 0,
          tension: 0.2,
          spanGaps: false,
          order: 4,
        },
        {
          label: `${forecast.framework} 80% interval`,
          data: labels.map((label) => upperValues.get(label) ?? null),
          borderColor: 'transparent',
          backgroundColor: toRgba(color, 0.1),
          pointRadius: 0,
          borderWidth: 0,
          fill: '-1',
          tension: 0.2,
          spanGaps: false,
          order: 4,
        },
      ] : [];

      return [
        ...intervalDatasets,
        {
          label: `${forecast.framework} · ${formatModelName(forecast.model)} forecast`,
          data: labels.map((label) => meanValues.get(label) ?? null),
          borderColor: color,
          backgroundColor: color,
          borderDash: [8, 6],
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
          tension: 0.24,
          spanGaps: false,
          order: 2,
        },
      ] satisfies ChartDataset<'line'>[];
    });

    return {
      labels,
      datasets: [...historicalDatasets, ...forecastDatasets],
    };
  });

  protected readonly chartOptions = computed<ChartConfiguration<'line'>['options']>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          usePointStyle: true,
          padding: 24,
          filter: (item) => !item.text.includes('80%'),
        },
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const label = context.dataset.label ?? 'Series';

            return label.includes('80%')
              ? ''
              : `${label}: ${Number(context.raw).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${this.unit()}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { maxTicksLimit: 12, maxRotation: 0 },
      },
      y: {
        beginAtZero: true,
        ticks: {
          callback: (value) => Number(value).toLocaleString(undefined, { notation: 'compact' }),
        },
      },
    },
  }));
}

function toRgba(hexColor: string, alpha: number): string {
  const normalized = hexColor.replace('#', '');
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function formatModelName(model: FrameworkForecastSeries['model']): string {
  return model === 'PROPHET' ? 'Prophet' : model;
}
