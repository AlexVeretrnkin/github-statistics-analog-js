import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import {forkJoin} from 'rxjs';

import { GithubDashboardService } from '../../core/github-dashboard.service';
import { GithubStatisticsService } from '../../core/github-statistics.service';
import {
  type CategoryPresetOption,
  type ComparisonSeries,
  type IssuesFilters,
  type IssuesTimeseriesResponse,
  type RepositoryLabel,
  type RepositoryLabelAnalysisResponse,
  type SelectedLabelSetView,
} from '../../core/github-statistics.models';
import { IssuesChartComponent } from '../issues-chart/issues-chart';
import { IssuesFiltersComponent } from '../issues-filters/issues-filters';
import { IssuesTableComponent } from '../issues-table/issues-table';
import { LabelAnalysisComponent } from '../label-analysis/label-analysis';
import { SelectedLabelsComponent } from '../selected-labels/selected-labels';

@Component({
  selector: 'app-main',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatExpansionModule,
    MatProgressBarModule,
    RouterLink,
    IssuesFiltersComponent,
    IssuesChartComponent,
    IssuesTableComponent,
    LabelAnalysisComponent,
    SelectedLabelsComponent,
  ],
  templateUrl: './main.html',
  styleUrl: './main.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Main {
  private readonly githubDashboardService = inject(GithubDashboardService);
  private readonly githubStatisticsService = inject(GithubStatisticsService);
  private readonly chartPanel = viewChild<ElementRef<HTMLElement>>('chartPanel');

  protected readonly labelOptions = signal<RepositoryLabel[]>([]);
  protected readonly labelAnalysis = signal<RepositoryLabelAnalysisResponse | null>(null);
  protected readonly loadingLabelAnalysis = signal(false);
  protected readonly loadingLabels = signal(false);
  protected readonly savingChartPanel = signal(false);
  protected readonly loadingStats = signal(false);
  protected readonly comparisonSeries = signal<ComparisonSeries[]>([]);
  protected readonly statistics = signal<IssuesTimeseriesResponse | null>(null);
  protected readonly filters = signal<IssuesFilters>(
    this.githubDashboardService.getInitialFilters(),
  );

  protected readonly repository = computed(() => this.statistics()?.repository ?? null);
  protected readonly series = computed(() => this.comparisonSeries());
  protected readonly categoryPresets = computed<CategoryPresetOption[]>(() =>
    this.githubDashboardService.buildCategoryPresets(this.labelAnalysis()),
  );
  protected readonly selectedLabelSets = computed<SelectedLabelSetView[]>(() =>
    this.githubDashboardService.buildSelectedLabelSets(
      this.filters().comparisonSets,
      this.labelOptions(),
    ),
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
        this.githubDashboardService.createTimeseriesRequest(filters, comparisonSet),
      ),
    );

    forkJoin(requests).subscribe({
      next: (responses) => {
        const [firstResponse] = responses;

        this.statistics.set(firstResponse ?? null);
        this.comparisonSeries.set(
          this.githubDashboardService.buildComparisonSeries(
            filters.comparisonSets,
            responses,
            this.labelOptions(),
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
    this.labelAnalysis.set(null);

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

  protected analyzeLabels(refresh = false): void {
    const { owner, repo } = this.filters();

    this.loadingLabelAnalysis.set(true);

    this.githubStatisticsService.analyzeRepositoryLabels(owner, repo, refresh).subscribe({
      next: (response) => {
        this.labelAnalysis.set(response);
        this.loadingLabelAnalysis.set(false);
      },
      error: (error) => {
        console.error('Failed to analyze labels', error);
        this.labelAnalysis.set(null);
        this.loadingLabelAnalysis.set(false);
      },
    });
  }

  protected addCategoryPreset(preset: CategoryPresetOption): void {
    this.filters.update((currentFilters) => ({
      ...currentFilters,
      comparisonSets: [
        ...currentFilters.comparisonSets,
        this.githubDashboardService.createCategoryPresetSet(preset),
      ],
    }));
  }

  protected async saveChartPanelAsPng(): Promise<void> {
    const chartPanel = this.chartPanel()?.nativeElement;

    if (!chartPanel) {
      return;
    }

    this.savingChartPanel.set(true);

    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(chartPanel, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');

      link.href = dataUrl;
      link.download = 'issue-comparison-chart-panel.png';
      link.click();
    } finally {
      this.savingChartPanel.set(false);
    }
  }
}
