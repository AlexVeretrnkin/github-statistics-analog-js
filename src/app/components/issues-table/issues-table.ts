import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatTableModule } from '@angular/material/table';

import { type ComparisonSeries } from '../../core/github-statistics.models';

@Component({
  selector: 'app-issues-table',
  standalone: true,
  imports: [CommonModule, MatTableModule],
  templateUrl: './issues-table.html',
  styleUrl: './issues-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IssuesTableComponent {
  readonly series = input<ComparisonSeries[]>([]);

  protected readonly displayedColumns = computed(() => {
    const dataColumns = this.series().flatMap((series) => [
      `${series.id}-total`,
      `${series.id}-open`,
      `${series.id}-closed`,
    ]);

    return ['month', ...dataColumns];
  });

  protected readonly rows = computed(() => {
    const series = this.series();
    const monthLabels = series[0]?.months.map((item) => item.month) ?? [];

    return monthLabels.map((month, index) => ({
      month,
      values: Object.fromEntries(
        series.flatMap((currentSeries) => [
          [`${currentSeries.id}-total`, currentSeries.months[index]?.total ?? 0],
          [`${currentSeries.id}-open`, currentSeries.months[index]?.open ?? 0],
          [`${currentSeries.id}-closed`, currentSeries.months[index]?.closed ?? 0],
        ]),
      ),
    }));
  });

  protected getSeriesName(columnId: string): string {
    return this.series().find((series) => columnId.startsWith(series.id))?.name ?? columnId;
  }

  protected getSeriesColor(columnId: string): string {
    return this.series().find((series) => columnId.startsWith(series.id))?.color ?? '8da2c0';
  }

  protected getMetricLabel(columnId: string): string {
    if (columnId.endsWith('-open')) {
      return 'Open';
    }

    if (columnId.endsWith('-closed')) {
      return 'Closed';
    }

    return 'Total';
  }
}
