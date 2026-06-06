import { Injectable } from '@angular/core';

import type { IssuesTimeseriesRequest } from './github-statistics.service';
import {
  type CategoryPresetOption,
  type ComparisonSeries,
  type IssuesFilters,
  type IssuesTimeseriesResponse,
  type LabelComparisonSet,
  type LabelResearchCategory,
  type RepositoryLabel,
  type RepositoryLabelAnalysisResponse,
  type SelectedLabelSetView,
} from './github-statistics.models';

const COMPARISON_SET_COLORS = ['#193cb8', '#d97706', '#0f766e', '#b91c1c', '#7c3aed'];

@Injectable({
  providedIn: 'root',
})
export class GithubDashboardService {
  getInitialFilters(): IssuesFilters {
    const now = new Date();
    const currentMonth = this.formatMonth(now);
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

    return {
      owner: 'facebook',
      repo: 'react',
      from: this.formatMonth(startDate),
      to: currentMonth,
      comparisonSets: [
        {
          category: undefined,
          id: this.createComparisonSetId(),
          labels: [],
          name: 'All issues',
          source: 'manual',
        },
      ],
    };
  }

  createTimeseriesRequest(
    filters: IssuesFilters,
    comparisonSet: LabelComparisonSet,
  ): IssuesTimeseriesRequest {
    const repository = this.resolveComparisonRepository(filters, comparisonSet);

    return {
      owner: repository.owner,
      repo: repository.repo,
      from: filters.from,
      to: filters.to,
      labels: comparisonSet.labels,
    };
  }

  createCategoryPresetSet(preset: CategoryPresetOption): LabelComparisonSet {
    return {
      category: preset.category,
      id: this.createComparisonSetId(),
      labels: preset.labels,
      name: preset.name,
      source: 'analysis-category',
    };
  }

  buildCategoryPresets(
    analysis: RepositoryLabelAnalysisResponse | null,
  ): CategoryPresetOption[] {
    if (!analysis) {
      return [];
    }

    const categoryMap = new Map<LabelResearchCategory, string[]>();

    for (const item of analysis.labels) {
      const existingLabels = categoryMap.get(item.primary_category) ?? [];
      existingLabels.push(item.label_name);
      categoryMap.set(item.primary_category, existingLabels);
    }

    return [...categoryMap.entries()]
      .map(([category, labels]) => ({
        category,
        labelCount: labels.length,
        labels: [...new Set(labels)],
        name: this.formatCategoryName(category),
      }))
      .sort((left, right) => {
        if (left.category === 'technical_debt') {
          return -1;
        }

        if (right.category === 'technical_debt') {
          return 1;
        }

        return right.labelCount - left.labelCount || left.name.localeCompare(right.name);
      });
  }

  buildSelectedLabelSets(
    filters: IssuesFilters,
    labelOptions: RepositoryLabel[],
  ): SelectedLabelSetView[] {
    return filters.comparisonSets.map((comparisonSet, index) => ({
      id: comparisonSet.id,
      name: this.getComparisonSetName(index, comparisonSet),
      accentColor: this.getComparisonSetColor(index),
      labels: this.mapLabelsForComparisonSet(comparisonSet, labelOptions),
      repositoryName: this.getComparisonRepositoryName(comparisonSet, undefined, filters),
    }));
  }

  buildComparisonSeries(
    comparisonSets: LabelComparisonSet[],
    responses: IssuesTimeseriesResponse[],
    labelOptions: RepositoryLabel[],
  ): ComparisonSeries[] {
    return comparisonSets.map((comparisonSet, index) => ({
      id: comparisonSet.id,
      name: this.getSeriesName(index, comparisonSet, responses[index]),
      color: this.getComparisonSetColor(index).replace('#', ''),
      labels: this.mapLabelsForComparisonSet(comparisonSet, labelOptions),
      months: responses[index]?.months ?? [],
      repositoryName: this.getComparisonRepositoryName(comparisonSet, responses[index]),
    }));
  }

  private mapLabelsForComparisonSet(
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

  private getComparisonSetName(index: number, comparisonSet: LabelComparisonSet): string {
    return comparisonSet.name || `Set ${index + 1}`;
  }

  private getSeriesName(
    index: number,
    comparisonSet: LabelComparisonSet,
    response?: IssuesTimeseriesResponse,
  ): string {
    const repositoryName = this.getComparisonRepositoryName(comparisonSet, response);
    const comparisonSetName = this.getComparisonSetName(index, comparisonSet);

    if (comparisonSetName === 'All issues') {
      return repositoryName;
    }

    return `${repositoryName} · ${comparisonSetName}`;
  }

  private getComparisonRepositoryName(
    comparisonSet: LabelComparisonSet,
    response?: IssuesTimeseriesResponse,
    filters?: IssuesFilters,
  ): string {
    const owner = response?.repository.owner ?? comparisonSet.owner?.trim() ?? filters?.owner;
    const repo = response?.repository.name ?? comparisonSet.repo?.trim() ?? filters?.repo;

    if (owner && repo) {
      return `${owner}/${repo}`;
    }

    return 'Default repository';
  }

  private resolveComparisonRepository(
    filters: IssuesFilters,
    comparisonSet: LabelComparisonSet,
  ): { owner: string; repo: string } {
    return {
      owner: comparisonSet.owner?.trim() || filters.owner,
      repo: comparisonSet.repo?.trim() || filters.repo,
    };
  }

  private getComparisonSetColor(index: number): string {
    return COMPARISON_SET_COLORS[index % COMPARISON_SET_COLORS.length];
  }

  private createComparisonSetId(): string {
    return `set-${Math.random().toString(36).slice(2, 10)}`;
  }

  private formatMonth(date: Date): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private formatCategoryName(category: LabelResearchCategory): string {
    return category
      .split('_')
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ');
  }
}
