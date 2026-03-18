import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { forkJoin } from 'rxjs';

import {
  GithubStatisticsService,
  type IssuesTimeseriesRequest,
} from '../../core/github-statistics.service';
import {
  type ComparisonSeries,
  type IssuesFilters,
  type IssuesTimeseriesResponse,
  type LabelComparisonSet,
  type RepositoryLabel,
} from '../../core/github-statistics.models';
import { IssuesChartComponent } from '../issues-chart/issues-chart';
import { IssuesFiltersComponent } from '../issues-filters/issues-filters';
import { IssuesTableComponent } from '../issues-table/issues-table';
import {
  SelectedLabelsComponent,
  type SelectedLabelSetView,
} from '../selected-labels/selected-labels';

@Component({
  selector: 'app-main',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatProgressBarModule,
    IssuesFiltersComponent,
    IssuesChartComponent,
    IssuesTableComponent,
    SelectedLabelsComponent,
  ],
  templateUrl: './main.html',
  styleUrl: './main.scss',
})
export class Main {
  private readonly githubStatisticsService = inject(GithubStatisticsService);

  protected readonly labelOptions = signal<RepositoryLabel[]>([]);
  protected readonly loadingLabels = signal(false);
  protected readonly loadingStats = signal(false);
  protected readonly comparisonSeries = signal<ComparisonSeries[]>([]);
  protected readonly statistics = signal<IssuesTimeseriesResponse | null>(null);
  protected readonly filters = signal<IssuesFilters>(getInitialFilters());

  protected readonly repository = computed(() => this.statistics()?.repository ?? null);
  protected readonly series = computed(() => this.comparisonSeries());
  protected readonly selectedLabelSets = computed<SelectedLabelSetView[]>(() =>
    this.filters().comparisonSets.map((comparisonSet, index) => ({
      id: comparisonSet.id,
      name: getComparisonSetName(index),
      accentColor: getComparisonSetColor(index),
      labels: mapLabelsForComparisonSet(comparisonSet, this.labelOptions()),
    })),
  );

  constructor() {
    const initialFilters = this.filters();

    this.loadLabels({
      owner: initialFilters.owner,
      repo: initialFilters.repo,
    });
    this.applyFilters(initialFilters);
  }

  protected applyFilters(filters: IssuesFilters): void {
    this.filters.set(filters);
    this.loadingStats.set(true);

    const requests = filters.comparisonSets.map((comparisonSet) =>
      this.githubStatisticsService.getIssuesTimeseries(
        createTimeseriesRequest(filters, comparisonSet),
      ),
    );

    forkJoin(requests).subscribe({
      next: (responses) => {
        const [firstResponse] = responses;

        this.statistics.set(firstResponse ?? null);
        this.comparisonSeries.set(
          filters.comparisonSets.map((comparisonSet, index) =>
            mapResponseToSeries({
              comparisonSet,
              index,
              response: responses[index],
              labelOptions: this.labelOptions(),
            }),
          ),
        );
        this.loadingStats.set(false);
      },
      error: (error) => {
        console.error('Failed to load issue statistics', error);
        this.statistics.set(null);
        this.comparisonSeries.set([]);
        this.loadingStats.set(false);
      },
    });
  }

  protected loadLabels(params: { owner: string; repo: string }): void {
    this.loadingLabels.set(true);

    this.githubStatisticsService.getRepositoryLabels(params.owner, params.repo).subscribe({
      next: (response) => {
        this.labelOptions.set(response.labels);
        this.loadingLabels.set(false);
      },
      error: (error) => {
        console.error('Failed to load repository labels', error);
        this.labelOptions.set([]);
        this.loadingLabels.set(false);
      },
    });
  }

}

function mapResponseToSeries({
  comparisonSet,
  index,
  response,
  labelOptions,
}: {
  comparisonSet: LabelComparisonSet;
  index: number;
  response: IssuesTimeseriesResponse;
  labelOptions: RepositoryLabel[];
}): ComparisonSeries {
  return {
    id: comparisonSet.id,
    name: getComparisonSetName(index),
    color: getComparisonSetColor(index).replace('#', ''),
    labels: mapLabelsForComparisonSet(comparisonSet, labelOptions),
    months: response.months,
  };
}

function getInitialFilters(): IssuesFilters {
  const now = new Date();
  const currentMonth = formatMonth(now);
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

  return {
    owner: 'facebook',
    repo: 'react',
    from: formatMonth(startDate),
    to: currentMonth,
    comparisonSets: [
      {
        id: createComparisonSetId(),
        labels: [],
      },
    ],
  };
}

function formatMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function createTimeseriesRequest(
  filters: IssuesFilters,
  comparisonSet: LabelComparisonSet,
): IssuesTimeseriesRequest {
  return {
    owner: filters.owner,
    repo: filters.repo,
    from: filters.from,
    to: filters.to,
    labels: comparisonSet.labels,
  };
}

function mapLabelsForComparisonSet(
  comparisonSet: LabelComparisonSet,
  labelOptions: RepositoryLabel[],
): RepositoryLabel[] {
  const labelsByName = new Map(labelOptions.map((label) => [label.name, label] as const));

  return comparisonSet.labels.map((labelName) => {
    const existingLabel = labelsByName.get(labelName);

    return existingLabel ?? {
      id: labelName,
      name: labelName,
      color: '8da2c0',
      description: null,
    };
  });
}

function getComparisonSetName(index: number): string {
  return `Set ${index + 1}`;
}

function getComparisonSetColor(index: number): string {
  return COMPARISON_SET_COLORS[index % COMPARISON_SET_COLORS.length];
}

function createComparisonSetId(): string {
  return `set-${Math.random().toString(36).slice(2, 10)}`;
}

const COMPARISON_SET_COLORS = ['#193cb8', '#d97706', '#0f766e', '#b91c1c', '#7c3aed'];
