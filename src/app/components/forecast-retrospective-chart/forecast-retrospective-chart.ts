import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BaseChartDirective } from 'ng2-charts';
import { Chart, type ChartConfiguration, type ChartDataset, registerables } from 'chart.js';

import type {
  FrameworkRetrospectiveSeries,
} from '../../core/framework-popularity.models';

Chart.register(...registerables);

const FORECAST_COLOR = '#1769c2';

@Component({
  selector: 'app-forecast-retrospective-chart',
  standalone: true,
  imports: [BaseChartDirective],
  templateUrl: './forecast-retrospective-chart.html',
  styleUrl: './forecast-retrospective-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForecastRetrospectiveChartComponent {
  readonly scale = input<'linear' | 'logarithmic'>('linear');
  readonly series = input<FrameworkRetrospectiveSeries[]>([]);
  readonly showInterval = input(true);
  readonly unit = input('value');

  protected readonly rows = computed(() => this.series().map((series) => ({
    framework: series.framework,
    data: this.buildData(series),
    options: this.buildOptions(series),
  })));

  private buildData(series: FrameworkRetrospectiveSeries): ChartConfiguration<'line'>['data'] {
    const labels = series.points.map((point) => point.date);
    const intervalDatasets: ChartDataset<'line'>[] = this.showInterval() ? [
      {
        label: '80% lower bound',
        data: series.points.map((point) => point.lo80),
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        borderWidth: 0,
        pointRadius: 0,
        tension: 0.18,
        order: 4,
      },
      {
        label: '80% prediction interval',
        data: series.points.map((point) => point.hi80),
        borderColor: 'transparent',
        backgroundColor: 'rgba(93, 173, 226, 0.22)',
        borderWidth: 0,
        fill: '-1',
        pointRadius: 0,
        tension: 0.18,
        order: 4,
      },
    ] : [];

    return {
      labels,
      datasets: [
        ...intervalDatasets,
        {
          label: `${series.model} forecast`,
          data: series.points.map((point) => point.forecast),
          borderColor: FORECAST_COLOR,
          backgroundColor: FORECAST_COLOR,
          borderDash: [7, 6],
          borderWidth: 2.25,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.18,
          order: 2,
        },
        {
          label: 'Observed',
          data: series.points.map((point) => point.observed),
          borderColor: '#172033',
          backgroundColor: '#172033',
          borderWidth: 2.25,
          pointBackgroundColor: '#172033',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointRadius: 3.75,
          pointHoverRadius: 6,
          spanGaps: false,
          tension: 0.12,
          order: 1,
        },
      ],
    };
  }

  private buildOptions(series: FrameworkRetrospectiveSeries): ChartConfiguration<'line'>['options'] {
    const values = series.points.flatMap((point) => [
      point.forecast,
      ...(point.observed === null ? [] : [point.observed]),
      ...(this.showInterval() ? [point.lo80, point.hi80] : []),
    ]).filter((value) => Number.isFinite(value) && value > 0);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: series.framework,
          align: 'center',
          color: '#172033',
          font: { size: 15, weight: 700 },
          padding: { bottom: 14 },
        },
        tooltip: {
          filter: (item) => !item.dataset.label?.includes('bound')
            && !item.dataset.label?.includes('interval'),
          callbacks: {
            label: (context) => {
              const value = Number(context.raw);
              return `${context.dataset.label}: ${value.toLocaleString(undefined, {
                maximumFractionDigits: 2,
                notation: Math.abs(value) >= 10_000 ? 'compact' : 'standard',
              })} ${this.unit()}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 6, maxRotation: 0, color: '#788396' },
        },
        y: {
          type: this.scale(),
          beginAtZero: false,
          min: Number.isFinite(minimum) ? minimum * 0.9 : undefined,
          max: Number.isFinite(maximum) ? maximum * 1.05 : undefined,
          grid: { color: 'rgba(23, 32, 51, 0.08)' },
          ticks: {
            color: '#788396',
            maxTicksLimit: 5,
            callback: (value) => Number(value).toLocaleString(undefined, {
              maximumFractionDigits: 1,
              notation: Math.abs(Number(value)) >= 10_000 ? 'compact' : 'standard',
            }),
          },
        },
      },
    };
  }
}
