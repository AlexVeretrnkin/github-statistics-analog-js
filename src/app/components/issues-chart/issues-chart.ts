import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BaseChartDirective } from 'ng2-charts';
import {
  Chart,
  type ChartConfiguration,
  type ChartDataset,
  registerables,
} from 'chart.js';

import { type ComparisonSeries } from '../../core/github-statistics.models';

Chart.register(...registerables);

@Component({
  selector: 'app-issues-chart',
  standalone: true,
  imports: [CommonModule, BaseChartDirective],
  templateUrl: './issues-chart.html',
  styleUrl: './issues-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IssuesChartComponent {
  readonly series = input<ComparisonSeries[]>([]);

  protected readonly chartData = computed<ChartConfiguration<'bar' | 'line'>['data']>(() => {
    const series = this.series();
    const monthLabels = series[0]?.months.map((item) => item.month) ?? [];

    return {
      labels: monthLabels,
      datasets: series.flatMap((currentSeries) => [
        {
          type: 'bar',
          label: `${currentSeries.name} open`,
          data: currentSeries.months.map((item) => item.open),
          backgroundColor: toChartColor(currentSeries.color, 0.24),
          borderColor: `#${currentSeries.color}`,
          borderWidth: 1,
          borderRadius: 10,
          maxBarThickness: 22,
          stack: currentSeries.id,
          yAxisID: 'y',
          order: 2,
        },
        {
          type: 'bar',
          label: `${currentSeries.name} closed`,
          data: currentSeries.months.map((item) => item.closed),
          backgroundColor: toChartColor(currentSeries.color, 0.52),
          borderColor: `#${currentSeries.color}`,
          borderWidth: 1,
          borderRadius: 10,
          maxBarThickness: 22,
          stack: currentSeries.id,
          yAxisID: 'y',
          order: 2,
        },
        {
          type: 'line',
          label: `${currentSeries.name} total`,
          data: currentSeries.months.map((item) => item.total),
          borderColor: `#${currentSeries.color}`,
          backgroundColor: `#${currentSeries.color}`,
          tension: 0.28,
          pointRadius: 4,
          pointHoverRadius: 5,
          pointBackgroundColor: '#ffffff',
          pointBorderWidth: 2,
          fill: false,
          yAxisID: 'yLine',
          order: 1,
        },
      ]) satisfies ChartDataset<'bar' | 'line'>[],
    };
  });

  protected readonly chartOptions = computed<ChartConfiguration<'bar' | 'line'>['options']>(() => {
    const maxTotal = Math.max(
      0,
      ...this.series().flatMap((currentSeries) =>
        currentSeries.months.map((month) => month.total),
      ),
    );
    const yAxisMax = maxTotal > 0 ? Math.ceil(maxTotal * 1.12) : undefined;

    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          top: 18,
          right: 8,
          bottom: 4,
          left: 4,
        },
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            usePointStyle: true,
            boxWidth: 12,
          },
        },
        tooltip: {
          callbacks: {
            label: (context) => `${context.dataset.label}: ${context.formattedValue}`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: {
            display: false,
          },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          max: yAxisMax,
          ticks: {
            precision: 0,
          },
        },
        yLine: {
          beginAtZero: true,
          max: yAxisMax,
          position: 'right',
          display: false,
          grid: {
            drawOnChartArea: false,
          },
          ticks: {
            precision: 0,
          },
        },
      },
    };
  });
}

function toChartColor(hexColor: string, alpha: number): string {
  const normalized = hexColor.replace('#', '');
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
