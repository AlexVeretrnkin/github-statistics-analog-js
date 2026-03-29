import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { injectLoad } from '@analogjs/router';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';

import {
  type LabelResearchCategory,
  type RepositoryLabelAnalysisItem,
  type RepositoryLabelAnalysisResponse,
} from '../../../core/github-statistics.models';
import { load as serverLoad } from './[repo].server';

interface CategoryGroup {
  category: LabelResearchCategory;
  items: RepositoryLabelAnalysisItem[];
}

@Component({
  standalone: true,
  imports: [CommonModule, MatCardModule, MatExpansionModule, RouterLink],
  templateUrl: './[repo].page.html',
  styleUrl: './[repo].page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class RepositoryAnalysisDetailsPageComponent {
  readonly load = toSignal(injectLoad<typeof serverLoad>());

  protected readonly analysis = computed<RepositoryLabelAnalysisResponse>(
    () => this.load()?.analysis as RepositoryLabelAnalysisResponse,
  );

  protected readonly groupedCategories = computed<CategoryGroup[]>(() => {
    const analysis = this.analysis();

    return groupAnalysisCategories(analysis);
  });
}

function groupAnalysisCategories(
  analysis: RepositoryLabelAnalysisResponse,
): CategoryGroup[] {
  const categoryMap = new Map<LabelResearchCategory, RepositoryLabelAnalysisItem[]>();

  for (const item of analysis.labels) {
    const existingItems = categoryMap.get(item.primary_category) ?? [];
    existingItems.push(item);
    categoryMap.set(item.primary_category, existingItems);
  }

  return [...categoryMap.entries()]
    .map(([category, items]) => ({
      category,
      items: [...items].sort((left, right) => left.label_name.localeCompare(right.label_name)),
    }))
    .sort((left, right) => {
      if (left.category === 'technical_debt') {
        return -1;
      }

      if (right.category === 'technical_debt') {
        return 1;
      }

      return right.items.length - left.items.length || left.category.localeCompare(right.category);
    });
}
